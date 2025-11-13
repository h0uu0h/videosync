// 内容脚本主文件
class VideoSyncContent {
    constructor() {
        this.detector = new VideoDetector();
        this.isMonitoring = false;
        this.currentPlayerId = null;
        this.syncEnabled = false;
        this.lastSyncTime = 0;
        this.syncThreshold = 1000;
        this.isInitialized = false;

        this.init();
    }

    init() {
        console.log('视频同步插件内容脚本已加载');

        // 立即扫描一次播放器
        this.scanPlayers();

        // 监听来自popup和background的消息
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            return this.handleMessage(message, sender, sendResponse);
        });

        // 监听页面动态加载的内容
        this.observeDOMChanges();

        this.isInitialized = true;

        // 通知background脚本已就绪
        chrome.runtime.sendMessage({
            action: 'contentScriptReady',
            url: window.location.href
        }).catch(() => {
            // 忽略错误，background可能未就绪
        });
    }

    // 处理消息 - 返回true保持消息通道开放
    handleMessage(message, sender, sendResponse) {
        let response;

        try {
            switch (message.action) {
                case 'rescanPlayers':
                    console.log('🔄 收到强制重新扫描命令');
                    // 🎯 使用强制重新扫描，而不是普通的getAllPlayers
                    const players = this.detector.forceRescan();
                    console.log(`✅ 重新扫描完成: ${players.length} 个播放器`);
                    response = { players: players };
                    break;

                case 'getVideoPlayers':
                    console.log('📋 获取当前播放器列表');
                    // 普通获取使用现有缓存
                    const currentPlayers = this.detector.getAllPlayers();
                    response = { players: currentPlayers };
                    break;

                case 'startSync':
                    this.startSync(message.playerId);
                    response = { success: true };
                    break;

                case 'stopSync':
                    this.stopSync();
                    response = { success: true };
                    break;

                case 'controlPlayer':
                    const result = this.controlPlayer(message.playerId, message.command, message.data);
                    response = { success: result };
                    break;

                case 'getPlayerState':
                    const state = this.getPlayerState(message.playerId);
                    response = { state: state };
                    break;

                case 'ping':
                    response = { pong: true, initialized: this.isInitialized };
                    break;

                default:
                    response = { error: '未知操作' };
            }
        } catch (error) {
            console.error('处理消息时出错:', error);
            response = { error: error.message };
        }

        // 立即发送响应
        if (sendResponse) {
            sendResponse(response);
        }

        // 返回true表示会异步发送响应
        return true;
    }

    // 扫描播放器
    scanPlayers() {
        return this.detector.getAllPlayers();
    }

    // 开始同步
    startSync(playerId) {
        this.currentPlayerId = playerId;
        this.syncEnabled = true;

        const player = this.detector.getPlayerById(playerId);
        if (!player) {
            console.error('播放器未找到:', playerId);
            return;
        }

        console.log('开始同步播放器:', player.name);

        // 开始监控播放器状态
        this.detector.startMonitoring((player, newState, oldState) => {
            this.onPlayerStateChange(player, newState, oldState);
        });

        this.isMonitoring = true;
    }

    // 停止同步
    stopSync() {
        this.syncEnabled = false;
        this.currentPlayerId = null;
        this.detector.stopMonitoring();
        this.isMonitoring = false;

        console.log('停止同步播放器');
    }

    // 播放器状态变化回调
    onPlayerStateChange(player, newState, oldState) {
        if (!this.syncEnabled || player.id !== this.currentPlayerId) {
            return;
        }

        const now = Date.now();

        // 防止过于频繁的同步
        if (now - this.lastSyncTime < this.syncThreshold) {
            return;
        }
        // 🟢 添加调试信息
        console.log('🎬 播放器状态变化:', {
            播放器: player.name,
            变化: this.detectChanges(oldState, newState),
            旧状态: {
                时间: oldState.currentTime.toFixed(1),
                播放状态: oldState.paused ? '暂停' : '播放'
            },
            新状态: {
                时间: newState.currentTime.toFixed(1),
                播放状态: newState.paused ? '暂停' : '播放'
            },
            时间戳: new Date().toLocaleTimeString()
        });
        // 构建状态变化消息
        const message = {
            action: 'playerStateChanged',
            playerId: player.id,
            state: newState,
            timestamp: now,
            changes: this.detectChanges(oldState, newState)
        };

        // 发送到background script
        chrome.runtime.sendMessage(message).catch(error => {
            console.error('发送状态变化失败:', error);
        });

        this.lastSyncTime = now;
    }

    // 检测具体的变化
    detectChanges(oldState, newState) {
        const changes = [];

        if (Math.abs(oldState.currentTime - newState.currentTime) > 0.5) {
            changes.push('timeupdate');
        }

        if (oldState.paused !== newState.paused) {
            changes.push(newState.paused ? 'pause' : 'play');
        }

        return changes;
    }

    // 控制播放器
    controlPlayer(playerId, command, data) {
        return this.detector.controlPlayer(playerId, command, data);
    }

    // 获取播放器状态
    getPlayerState(playerId) {
        const player = this.detector.getPlayerById(playerId);
        if (!player || !player.element) return null;

        return {
            currentTime: player.element.currentTime,
            duration: player.element.duration,
            paused: player.element.paused,
            volume: player.element.volume,
            muted: player.element.muted,
            readyState: player.element.readyState
        };
    }

    // 监听DOM变化以检测新出现的播放器
    observeDOMChanges() {
        // 先清理现有的观察器
        if (this.domObserver) {
            this.domObserver.disconnect();
        }

        this.domObserver = new MutationObserver((mutations) => {
            let shouldRescan = false;

            mutations.forEach((mutation) => {
                // 检查新增的节点
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // 🎯 更全面的视频元素检测
                        if (node.tagName === 'VIDEO' ||
                            node.querySelector('video') ||
                            node.querySelector('iframe[src*="youtube"]') ||
                            node.querySelector('iframe[src*="youtu.be"]') ||
                            node.querySelector('[class*="video"]') ||
                            node.querySelector('[class*="player"]')) {
                            console.log('🆕 检测到新的视频元素');
                            shouldRescan = true;
                        }
                    }
                });
            });

            if (shouldRescan) {
                console.log('🔄 DOM变化触发重新扫描');
                setTimeout(() => {
                    this.detector.forceRescan();
                }, 500);
            }
        });

        // 🎯 更全面的监听配置
        this.domObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'class']  // 监听src和class变化
        });
    }
}

// 初始化内容脚本
const videoSyncContent = new VideoSyncContent();