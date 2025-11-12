// 后台脚本 - 管理WebSocket连接和消息路由
class BackgroundManager {
    constructor() {
        this.wsClient = null;
        this.isConnected = false;
        this.isSyncing = false;
        this.currentRoom = null;
        this.currentPlayerId = null;
        this.clientId = this.generateClientId();

        this.init();
    }

    init() {
        console.log('视频同步插件后台脚本已加载');

        // 监听来自popup的消息
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
        });

        // 恢复连接状态
        this.restoreConnection();
    }
    //处理消息
    async handleMessage(message, sender, sendResponse) {
        try {
            switch (message.action) {
                case 'connect':
                    await this.connect(message.serverUrl, message.roomId);
                    sendResponse({ success: true });
                    break;

                case 'disconnect':
                    this.disconnect();
                    sendResponse({ success: true });
                    break;

                case 'startSync':
                    this.startSync(message.playerId);
                    sendResponse({ success: true });
                    break;

                case 'stopSync':
                    this.stopSync();
                    sendResponse({ success: true });
                    break;

                case 'playerStateChanged':
                    this.handlePlayerStateChange(message);
                    sendResponse({ success: true });
                    break;

                // ✅ 新增：让 popup 可以主动查询连接状态
                case 'getConnectionStatus':
                    sendResponse({
                        connected: this.isConnected,
                        syncing: this.isSyncing,
                        roomId: this.currentRoom,
                        playerId: this.currentPlayerId
                    });
                    break;

                default:
                    sendResponse({ error: '未知操作' });
            }
        } catch (error) {
            console.error('处理消息失败:', error);
            sendResponse({ error: error.message });
        }

        return true;
    }

    // 连接到同步服务器
    async connect(serverUrl, roomId) {
        try {
            if (!roomId) throw new Error('房间ID不能为空');

            // ✅ 确保URL中带上参数
            const wsUrl = `${serverUrl}?roomId=${encodeURIComponent(roomId)}&clientId=${this.clientId}`;
            console.log('连接 WebSocket 地址:', wsUrl);

            this.wsClient = new WebSocket(wsUrl);

            this.wsClient.onopen = () => {
                console.log('✅ WebSocket连接成功:', {
                    服务器: serverUrl,
                    房间: roomId,
                    客户端ID: this.clientId,
                    时间: new Date().toLocaleTimeString()
                });
                this.isConnected = true;
                this.broadcastToPopups({
                    action: 'connectionStatusChanged',
                    connected: true,
                    roomId
                });
            };

            this.wsClient.onmessage = (event) => {
                console.log('收到服务器消息:', event.data);
                this.handleServerMessage(JSON.parse(event.data));
            };

            this.wsClient.onclose = (event) => {
                console.log(`🔌 连接已关闭 (代码: ${event.code}, 原因: ${event.reason})`);
                this.isConnected = false;
                this.broadcastToPopups({
                    action: 'connectionStatusChanged',
                    connected: false
                });
            };

            this.wsClient.onerror = (error) => {
                console.error('WebSocket 错误:', error);
            };

        } catch (error) {
            console.error('连接失败:', error);
        }
    }


    // 断开连接
    disconnect() {
        if (this.wsClient) {
            this.wsClient.close();
            this.wsClient = null;
        }

        this.isConnected = false;
        this.isSyncing = false;
        this.currentRoom = null;
        this.currentPlayerId = null;

        // 通知所有popup页面
        this.broadcastToPopups({
            action: 'connectionStatusChanged',
            connected: false
        });

        console.log('已断开连接');
    }

    // 开始同步
    startSync(playerId) {
        if (!this.isConnected) {
            throw new Error('未连接到服务器');
        }

        this.isSyncing = true;
        this.currentPlayerId = playerId;

        // 发送开始同步消息
        this.sendToServer({
            type: 'sync_start',
            playerId: playerId,
            timestamp: Date.now()
        });

        // 通知popup页面
        this.broadcastToPopups({
            action: 'syncStatusChanged',
            syncing: true
        });

        console.log('开始同步播放器:', playerId);
    }

    // 停止同步
    stopSync() {
        this.isSyncing = false;
        this.currentPlayerId = null;

        // 发送停止同步消息
        this.sendToServer({
            type: 'sync_stop',
            timestamp: Date.now()
        });

        // 通知popup页面
        this.broadcastToPopups({
            action: 'syncStatusChanged',
            syncing: false
        });

        console.log('停止同步');
    }

    // 处理播放器状态变化
    handlePlayerStateChange(message) {
        if (!this.isConnected || !this.isSyncing) {
            return;
        }
        // 🟢 添加调试信息
        console.log('📤 发送到服务器的状态:', {
            类型: 'player_state',
            播放器ID: message.playerId,
            变化: message.changes,
            当前时间: message.state.currentTime?.toFixed(1),
            播放状态: message.state.paused ? '暂停' : '播放',
            时间戳: new Date(message.timestamp).toLocaleTimeString()
        });
        // 发送状态变化到服务器
        this.sendToServer({
            type: 'player_state',
            playerId: message.playerId,
            state: message.state,
            changes: message.changes,
            timestamp: message.timestamp
        });
    }

    // 处理来自服务器的消息
    handleServerMessage(message) {
        // 🟢 添加调试信息
        console.log('📥 收到服务器消息:', {
            消息类型: message.type,
            数据: message.data,
            来源客户端: message.clientId,
            时间戳: new Date(message.timestamp).toLocaleTimeString()
        });
        switch (message.type) {
            case 'play':
            case 'pause':
            case 'seek':
                // 转发到内容脚本控制播放器
                console.log(`🎛️ 执行控制命令: ${message.type}`, message.data);
                this.controlActiveTabPlayer(message.type, message.data);
                break;

            case 'sync_request':
                // 处理同步请求
                this.handleSyncRequest(message);
                break;

            case 'user_joined':
            case 'user_left':
                // 通知popup页面用户变化
                this.broadcastToPopups(message);
                break;
        }
    }

    // 控制活跃标签页的播放器
    async controlActiveTabPlayer(command, data) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (tab && this.currentPlayerId) {
                await chrome.tabs.sendMessage(tab.id, {
                    action: 'controlPlayer',
                    playerId: this.currentPlayerId,
                    command: command,
                    data: data
                });
            }
        } catch (error) {
            console.error('控制播放器失败:', error);
        }
    }

    // 处理同步请求
    async handleSyncRequest(message) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (tab && this.currentPlayerId) {
                const response = await chrome.tabs.sendMessage(tab.id, {
                    action: 'getPlayerState',
                    playerId: this.currentPlayerId
                });

                if (response && response.state) {
                    this.sendToServer({
                        type: 'sync_response',
                        playerId: this.currentPlayerId,
                        state: response.state,
                        timestamp: Date.now()
                    });
                }
            }
        } catch (error) {
            console.error('处理同步请求失败:', error);
        }
    }

    // 发送消息到服务器
    sendToServer(message) {
        if (this.wsClient && this.isConnected) {
            this.wsClient.send(JSON.stringify(message));
        }
    }

    // 广播消息到所有popup页面
    broadcastToPopups(message) {
        chrome.runtime.sendMessage(message).catch(error => {
            // 忽略没有popup页面的错误
        });
    }

    // 恢复连接
    async restoreConnection() {
        try {
            const settings = await chrome.storage.local.get(['serverUrl', 'roomId', 'autoConnect']);

            if (settings.autoConnect && settings.serverUrl && settings.roomId) {
                await this.connect(settings.serverUrl, settings.roomId);
            }
        } catch (error) {
            console.error('恢复连接失败:', error);
        }
    }

    // 生成客户端ID
    generateClientId() {
        return 'client_' + Math.random().toString(36).substring(2, 15);
    }
}

// 初始化后台管理器
const backgroundManager = new BackgroundManager();