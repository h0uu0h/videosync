// WebSocket客户端封装

class WebSocketClient {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectInterval = 2000;
        this.messageHandlers = new Map();
        this.connectionState = 'disconnected';
    }

    connect(url, roomId, clientId) {
        return new Promise((resolve, reject) => {
            try {
                const wsUrl = `${url}?roomId=${encodeURIComponent(roomId)}&clientId=${clientId}`;
                this.ws = new WebSocket(wsUrl);

                this.ws.onopen = () => {
                    this.connectionState = 'connected';
                    this.reconnectAttempts = 0;
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    this.handleMessage(event);
                };

                this.ws.onclose = (event) => {
                    this.connectionState = 'disconnected';
                    this.handleClose(event);
                };

                this.ws.onerror = (error) => {
                    reject(error);
                };

            } catch (error) {
                reject(error);
            }
        });
    }

    disconnect() {
        if (this.ws) {
            this.ws.close(1000, '正常关闭');
            this.ws = null;
        }
        this.connectionState = 'disconnected';
    }

    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
            return true;
        }
        return false;
    }

    handleMessage(event) {
        try {
            const message = JSON.parse(event.data);
            const handlers = this.messageHandlers.get(message.type) || [];
            handlers.forEach(handler => handler(message));
        } catch (error) {
            console.error('消息处理错误:', error);
        }
    }

    handleClose(event) {
        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            setTimeout(() => {
                this.reconnectAttempts++;
                // 在实际实现中，这里应该尝试重连
            }, this.reconnectInterval * this.reconnectAttempts);
        }
    }

    on(messageType, handler) {
        if (!this.messageHandlers.has(messageType)) {
            this.messageHandlers.set(messageType, []);
        }
        this.messageHandlers.get(messageType).push(handler);
    }

    off(messageType, handler) {
        const handlers = this.messageHandlers.get(messageType);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }

    isConnected() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }
}