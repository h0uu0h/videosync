const WebSocket = require('ws');
const http = require('http');
const url = require('url');

class VideoSyncServer {
    constructor(port = 8080) {
        this.port = port;
        this.rooms = new Map(); // roomId -> Set<clients>
        this.server = null;
        this.wss = null;
        this.stats = {
            totalConnections: 0,
            currentConnections: 0,
            roomsCreated: 0,
            messagesProcessed: 0
        };

        this.init();
    }

    init() {
        // 创建HTTP服务器
        const server = http.createServer((req, res) => {
            this.handleHttpRequest(req, res);
        });

        // 创建WebSocket服务器
        this.wss = new WebSocket.Server({
            server,
            perMessageDeflate: false
        });

        // WebSocket连接处理
        this.wss.on('connection', (ws, request) => {
            this.handleWebSocketConnection(ws, request);
        });

        // 启动服务器
        server.listen(this.port, () => {
            console.log(`🎬 视频同步服务器运行在端口 ${this.port}`);
            console.log(`📊 服务器状态: http://localhost:${this.port}/status`);
        });

        this.server = server;

        // 定期清理空房间
        setInterval(() => this.cleanupEmptyRooms(), 60000); // 每分钟清理一次
    }

    handleHttpRequest(req, res) {
        const parsedUrl = url.parse(req.url, true);
        const pathname = parsedUrl.pathname;

        // 设置CORS头
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        if (pathname === '/status') {
            this.handleStatusRequest(req, res);
        } else if (pathname === '/rooms') {
            this.handleRoomsRequest(req, res);
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '接口不存在' }));
        }
    }

    handleStatusRequest(req, res) {
        const status = {
            status: 'running',
            port: this.port,
            uptime: process.uptime(),
            stats: this.stats,
            timestamp: new Date().toISOString()
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status, null, 2));
    }

    handleRoomsRequest(req, res) {
        const roomsInfo = {};

        this.rooms.forEach((clients, roomId) => {
            roomsInfo[roomId] = {
                clientCount: clients.size,
                clientIds: Array.from(clients).map(client => client.clientId),
                createdAt: clients.createdAt || '未知'
            };
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(roomsInfo, null, 2));
    }

    handleWebSocketConnection(ws, request) {
        const { query } = url.parse(request.url, true);
        const roomId = query.roomId;
        const clientId = query.clientId || this.generateClientId();

        // 验证参数
        if (!roomId) {
            ws.close(1008, '房间ID不能为空');
            return;
        }

        if (roomId.length > 50) {
            ws.close(1008, '房间ID过长');
            return;
        }

        // 设置客户端信息
        ws.clientId = clientId;
        ws.roomId = roomId;
        ws.isAlive = true;
        ws.joinTime = new Date();

        // 加入房间
        this.joinRoom(ws, roomId, clientId);

        // 设置心跳检测
        ws.on('pong', () => {
            ws.isAlive = true;
        });

        // 处理消息
        ws.on('message', (data) => {
            this.handleMessage(ws, data);
        });

        // 处理连接关闭
        ws.on('close', (code, reason) => {
            this.handleDisconnection(ws, code, reason.toString());
        });

        // 处理错误
        ws.on('error', (error) => {
            console.error(`WebSocket错误 [${clientId}]:`, error);
            this.handleDisconnection(ws, 1006, error.message);
        });

        this.stats.totalConnections++;
        this.stats.currentConnections++;

        console.log(`🔗 客户端 ${clientId} 加入房间 ${roomId}, 当前连接数: ${this.stats.currentConnections}`);
    }

    joinRoom(ws, roomId, clientId) {
        // 创建或获取房间
        if (!this.rooms.has(roomId)) {
            this.rooms.set(roomId, new Set());
            this.rooms.get(roomId).createdAt = new Date();
            this.stats.roomsCreated++;
            console.log(`🆕 创建新房间: ${roomId}`);
        }

        const room = this.rooms.get(roomId);
        room.add(ws);

        // 发送连接成功消息
        ws.send(JSON.stringify({
            type: 'connected',
            clientId: clientId,
            roomId: roomId,
            roomSize: room.size,
            timestamp: Date.now()
        }));

        // 通知房间内其他用户有新用户加入
        this.broadcastToRoom(roomId, ws, {
            type: 'user_joined',
            clientId: clientId,
            roomSize: room.size,
            timestamp: Date.now()
        });

        // 发送当前房间状态给新用户
        const roomClients = Array.from(room)
            .filter(client => client !== ws && client.readyState === WebSocket.OPEN)
            .map(client => client.clientId);

        ws.send(JSON.stringify({
            type: 'room_info',
            clients: roomClients,
            roomSize: room.size,
            timestamp: Date.now()
        }));
    }

    handleMessage(ws, data) {
        try {
            const message = JSON.parse(data);
            this.stats.messagesProcessed++;

            // 验证消息格式
            if (!this.validateMessage(message)) {
                ws.send(JSON.stringify({
                    type: 'error',
                    error: '无效的消息格式',
                    timestamp: Date.now()
                }));
                return;
            }

            const { roomId, clientId } = ws;

            console.log(`📨 收到消息 [${clientId}@${roomId}]:`, message.type);

            // 处理不同类型的消息
            switch (message.type) {
                case 'ping':
                    this.handlePing(ws, message);
                    break;

                case 'sync_start':
                    this.handleSyncStart(ws, message);
                    break;

                case 'sync_stop':
                    this.handleSyncStop(ws, message);
                    break;

                case 'play':
                case 'pause':
                case 'seek':
                case 'volume_change':
                    this.handleControlMessage(ws, message);
                    break;

                case 'player_state':
                    this.handlePlayerState(ws, message);
                    break;

                case 'sync_request':
                    this.handleSyncRequest(ws, message);
                    break;

                case 'sync_response':
                    this.handleSyncResponse(ws, message);
                    break;

                case 'chat_message':
                    this.handleChatMessage(ws, message);
                    break;

                default:
                    console.warn(`未知消息类型: ${message.type}`);
                    ws.send(JSON.stringify({
                        type: 'error',
                        error: `未知的消息类型: ${message.type}`,
                        timestamp: Date.now()
                    }));
            }

        } catch (error) {
            console.error('消息处理错误:', error);
            ws.send(JSON.stringify({
                type: 'error',
                error: '消息解析失败',
                timestamp: Date.now()
            }));
        }
    }

    validateMessage(message) {
        return message &&
            typeof message === 'object' &&
            typeof message.type === 'string' &&
            message.type.length > 0;
    }

    handlePing(ws, message) {
        ws.send(JSON.stringify({
            type: 'pong',
            timestamp: Date.now(),
            original: message.timestamp
        }));
    }

    handleSyncStart(ws, message) {
        const { roomId, clientId } = ws;

        // 广播同步开始消息
        this.broadcastToRoom(roomId, ws, {
            type: 'sync_started',
            clientId: clientId,
            playerId: message.playerId,
            timestamp: Date.now()
        });

        console.log(`▶️ 客户端 ${clientId} 开始同步播放器: ${message.playerId}`);
    }

    handleSyncStop(ws, message) {
        const { roomId, clientId } = ws;

        // 广播同步停止消息
        this.broadcastToRoom(roomId, ws, {
            type: 'sync_stopped',
            clientId: clientId,
            timestamp: Date.now()
        });

        console.log(`⏹️ 客户端 ${clientId} 停止同步`);
    }

    handleControlMessage(ws, message) {
        const { roomId, clientId } = ws;

        // 广播控制消息给房间内其他用户
        this.broadcastToRoom(roomId, ws, {
            type: message.type,
            clientId: clientId,
            timestamp: Date.now(),
            data: message.data
        });

        console.log(`🎛️ 客户端 ${clientId} 发送控制: ${message.type}`, message.data);
    }

    handlePlayerState(ws, message) {
        const { roomId, clientId } = ws;

        // 广播播放器状态给房间内其他用户
        this.broadcastToRoom(roomId, ws, {
            type: 'player_state_update',
            clientId: clientId,
            timestamp: Date.now(),
            state: message.state,
            changes: message.changes
        });
    }

    handleSyncRequest(ws, message) {
        const { roomId, clientId } = ws;

        // 广播同步请求给房间内其他用户
        this.broadcastToRoom(roomId, ws, {
            type: 'sync_request',
            clientId: clientId,
            timestamp: Date.now()
        });

        console.log(`🔄 客户端 ${clientId} 请求同步`);
    }

    handleSyncResponse(ws, message) {
        const { roomId, clientId } = ws;

        // 广播同步响应给房间内其他用户
        this.broadcastToRoom(roomId, ws, {
            type: 'sync_response',
            clientId: clientId,
            timestamp: Date.now(),
            state: message.state
        });
    }

    handleChatMessage(ws, message) {
        const { roomId, clientId } = ws;

        // 广播聊天消息
        this.broadcastToRoom(roomId, null, {
            type: 'chat_message',
            clientId: clientId,
            timestamp: Date.now(),
            message: message.message,
            username: message.username || clientId
        });
    }

    handleDisconnection(ws, code, reason) {
        const { roomId, clientId } = ws;

        if (roomId && this.rooms.has(roomId)) {
            const room = this.rooms.get(roomId);
            room.delete(ws);

            console.log(`🔌 客户端 ${clientId} 离开房间 ${roomId}, 原因: ${reason} (代码: ${code})`);

            // 通知房间内其他用户
            this.broadcastToRoom(roomId, null, {
                type: 'user_left',
                clientId: clientId,
                roomSize: room.size,
                timestamp: Date.now()
            });

            // 如果房间为空，标记为可清理
            if (room.size === 0) {
                room.emptySince = new Date();
            }
        }

        this.stats.currentConnections--;
    }

    broadcastToRoom(roomId, excludeWs, message) {
        const room = this.rooms.get(roomId);
        if (!room) return;

        let delivered = 0;
        room.forEach(client => {
            if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(message));
                delivered++;
            }
        });

        return delivered;
    }

    cleanupEmptyRooms() {
        let cleaned = 0;
        const now = new Date();

        this.rooms.forEach((room, roomId) => {
            if (room.size === 0 && room.emptySince) {
                // 如果房间空置超过5分钟，则清理
                const emptyTime = now - room.emptySince;
                if (emptyTime > 5 * 60 * 1000) {
                    this.rooms.delete(roomId);
                    cleaned++;
                    console.log(`🧹 清理空房间: ${roomId}`);
                }
            }
        });

        if (cleaned > 0) {
            console.log(`🗑️ 清理了 ${cleaned} 个空房间`);
        }
    }

    // 心跳检测
    startHeartbeat() {
        setInterval(() => {
            this.wss.clients.forEach((ws) => {
                if (ws.isAlive === false) {
                    console.log(`💔 客户端 ${ws.clientId} 心跳检测失败，关闭连接`);
                    return ws.terminate();
                }

                ws.isAlive = false;
                ws.ping();
            });
        }, 30000); // 每30秒检测一次
    }

    generateClientId() {
        return 'client_' + Math.random().toString(36).substring(2, 8) + '_' + Date.now().toString(36);
    }

    // 优雅关闭
    shutdown() {
        console.log('正在关闭服务器...');

        // 通知所有客户端
        this.rooms.forEach((room, roomId) => {
            this.broadcastToRoom(roomId, null, {
                type: 'server_shutdown',
                message: '服务器正在关闭',
                timestamp: Date.now()
            });
        });

        // 关闭所有连接
        this.wss.clients.forEach(client => {
            client.close(1001, '服务器关闭');
        });

        // 关闭服务器
        if (this.server) {
            this.server.close(() => {
                console.log('服务器已关闭');
                process.exit(0);
            });
        }
    }

    // 获取服务器状态
    getStatus() {
        return {
            ...this.stats,
            roomCount: this.rooms.size,
            activeRooms: Array.from(this.rooms.entries())
                .filter(([_, room]) => room.size > 0)
                .length
        };
    }
}

// 创建并启动服务器
const server = new VideoSyncServer(process.env.PORT || 8080);

// 启动心跳检测
server.startHeartbeat();

// 优雅关闭处理
process.on('SIGINT', () => {
    console.log('\n收到关闭信号...');
    server.shutdown();
});

process.on('SIGTERM', () => {
    console.log('收到终止信号...');
    server.shutdown();
});

// 未捕获异常处理
process.on('uncaughtException', (error) => {
    console.error('未捕获异常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('未处理的Promise拒绝:', reason);
});

module.exports = VideoSyncServer;