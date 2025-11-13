// 视频播放器检测器
class VideoDetector {
    constructor() {
        this.players = [];
        this.videoElements = [];
        this.intervalId = null;
    }

    // 扫描页面中的视频元素
    scanVideoElements() {
        // 清空之前的视频元素
        this.videoElements = [];

        // 使用更全面的选择器
        const videos = document.querySelectorAll('video');
        this.videoElements = Array.from(videos);

        console.log(`🔍 扫描到 ${this.videoElements.length} 个HTML5视频元素`);

        return this.videoElements.map((video, index) => {
            // 检查视频是否真实可用
            const isUsable = video.readyState > 0 || video.src || video.querySelector('source');

            return {
                id: `video_${Date.now()}_${index}`,  // 🎯 使用时间戳避免ID冲突
                name: this.generateVideoName(video, index),
                element: video,
                type: 'html5',
                currentTime: video.currentTime,
                duration: video.duration,
                paused: video.paused,
                usable: isUsable
            };
        }).filter(player => player.usable);  // 🎯 只返回可用的播放器
    }

    // 生成视频名称
    generateVideoName(video, index) {
        // 尝试从各种属性获取有意义的名称
        const sources = [
            video.getAttribute('title'),
            video.getAttribute('alt'),
            video.parentElement?.querySelector('source')?.getAttribute('title'),
            document.title,
            `视频播放器 ${index + 1}`
        ];

        return sources.find(name => name && name.trim()) || `视频播放器 ${index + 1}`;
    }

    // 检测第三方播放器（如YouTube、B站等）
    detectThirdPartyPlayers() {
        const players = [];

        // 检测YouTube播放器
        const youtubePlayers = this.detectYouTubePlayers();
        players.push(...youtubePlayers);

        // 检测B站播放器
        const bilibiliPlayers = this.detectBilibiliPlayers();
        players.push(...bilibiliPlayers);

        // 可以继续添加其他平台的检测

        return players;
    }

    // 检测YouTube播放器
    detectYouTubePlayers() {
        const players = [];

        // 方法1: 通过iframe检测
        const youtubeIframes = document.querySelectorAll('iframe[src*="youtube.com"], iframe[src*="youtu.be"]');
        youtubeIframes.forEach((iframe, index) => {
            players.push({
                id: `youtube_${index}`,
                name: `YouTube播放器 ${index + 1}`,
                element: iframe,
                type: 'youtube',
                url: iframe.src
            });
        });

        // 方法2: 通过YouTube API检测
        const youtubePlayers = document.querySelectorAll('.html5-video-player');
        youtubePlayers.forEach((player, index) => {
            players.push({
                id: `youtube_api_${index}`,
                name: `YouTube播放器 ${index + 1}`,
                element: player,
                type: 'youtube',
                isApiReady: typeof YT !== 'undefined'
            });
        });

        return players;
    }

    // 检测B站播放器
    detectBilibiliPlayers() {
        const players = [];

        // 检测B站播放器
        const bilibiliPlayers = document.querySelectorAll('.bilibili-player, [class*="bpx-player"]');
        bilibiliPlayers.forEach((player, index) => {
            players.push({
                id: `bilibili_${index}`,
                name: `B站播放器 ${index + 1}`,
                element: player,
                type: 'bilibili'
            });
        });

        return players;
    }
    forceRescan() {
        console.log('🔄 VideoDetector: 强制重新扫描所有播放器');

        // 清空缓存
        this.players = [];
        this.videoElements = [];

        // 重新扫描
        return this.getAllPlayers();
    }
    // 获取所有播放器
    // 修复 getAllPlayers 方法
    getAllPlayers() {
        console.log('🎯 VideoDetector: 开始扫描播放器');

        // 强制重新扫描，不依赖缓存
        const html5Players = this.scanVideoElements();
        const thirdPartyPlayers = this.detectThirdPartyPlayers();

        // 🎯 关键：每次都返回新的扫描结果，不更新内部缓存
        const currentPlayers = [...html5Players, ...thirdPartyPlayers];

        console.log(`📊 扫描完成: ${currentPlayers.length} 个播放器`);

        // 可选：更新缓存用于监控，但返回的是新扫描的结果
        this.players = currentPlayers;

        return currentPlayers;
    }

    // 开始监控播放器状态变化
    startMonitoring(callback) {
        this.stopMonitoring();

        this.intervalId = setInterval(() => {
            this.players.forEach(player => {
                if (player.element && player.type === 'html5') {
                    const newState = {
                        currentTime: player.element.currentTime,
                        duration: player.element.duration,
                        paused: player.element.paused,
                        readyState: player.element.readyState
                    };

                    const oldState = {
                        currentTime: player.currentTime,
                        duration: player.duration,
                        paused: player.paused
                    };

                    // 检查状态变化
                    if (this.hasStateChanged(oldState, newState)) {
                        player.currentTime = newState.currentTime;
                        player.duration = newState.duration;
                        player.paused = newState.paused;

                        if (callback) {
                            callback(player, newState, oldState);
                        }
                    }
                }
            });
        }, 500); // 每500ms检查一次
    }

    // 停止监控
    stopMonitoring() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    // 检查状态是否发生变化
    hasStateChanged(oldState, newState) {
        return (
            Math.abs(oldState.currentTime - newState.currentTime) > 0.1 ||
            oldState.paused !== newState.paused ||
            oldState.duration !== newState.duration
        );
    }

    // 根据ID获取播放器
    getPlayerById(id) {
        return this.players.find(player => player.id === id);
    }

    // 控制播放器
    controlPlayer(playerId, command, data = {}) {
        const player = this.getPlayerById(playerId);
        if (!player || !player.element) return false;

        try {
            switch (command) {
                case 'play':
                    if (player.type === 'html5') {
                        return player.element.play().then(() => true).catch(() => false);
                    }
                    break;

                case 'pause':
                    if (player.type === 'html5') {
                        player.element.pause();
                        return true;
                    }
                    break;

                case 'seek':
                    if (player.type === 'html5' && data.currentTime !== undefined) {
                        player.element.currentTime = data.currentTime;
                        return true;
                    }
                    break;

                case 'setVolume':
                    if (player.type === 'html5' && data.volume !== undefined) {
                        player.element.volume = data.volume;
                        return true;
                    }
                    break;
            }
        } catch (error) {
            console.error('控制播放器失败:', error);
        }

        return false;
    }
}