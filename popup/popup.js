// 插件状态
let isConnected = false;
let isSyncing = false;
let selectedPlayer = null;
let players = [];

// DOM元素
const statusEl = document.getElementById('status');
const roomIdEl = document.getElementById('roomId');
const serverUrlEl = document.getElementById('serverUrl');
const connectBtn = document.getElementById('connectBtn');
const syncBtn = document.getElementById('syncBtn');
const playersListEl = document.getElementById('playersList');

// 初始化
async function init() {
    // 初始化时从后台恢复状态
    chrome.runtime.sendMessage({ action: 'getConnectionStatus' }, (response) => {
        if (response && response.connected) {
            isConnected = response.connected;
            isSyncing = response.syncing;
            roomIdEl.value = response.roomId || roomIdEl.value;

            statusEl.textContent = `已连接到房间: ${response.roomId || ''}`;
            statusEl.className = 'status connected';
            connectBtn.textContent = '断开连接';
        } else {
            statusEl.textContent = '未连接';
            statusEl.className = 'status disconnected';
            connectBtn.textContent = '连接';
        }

        updateSyncButton();
    });
    const rescanBtn = document.getElementById('rescanBtn');

    // 从存储加载设置
    const settings = await chrome.storage.local.get(['serverUrl', 'roomId']);
    if (settings.serverUrl) {
        serverUrlEl.value = settings.serverUrl;
    }
    if (settings.roomId) {
        roomIdEl.value = settings.roomId;
    } else {
        roomIdEl.value = generateRoomId();
    }

    // 事件监听
    connectBtn.addEventListener('click', toggleConnection);
    syncBtn.addEventListener('click', toggleSync);
    rescanBtn.addEventListener('click', rescanPlayers);
    // 扫描播放器
    await scanForPlayers();
}

// 扫描页面中的播放器
async function scanForPlayers() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab) {
            console.log('❌ 没有找到活跃标签页');
            throw new Error('没有找到活跃标签页');
        }

        console.log('🔍 扫描标签页:', tab.url);

        // 检查标签页URL是否支持内容脚本
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
            console.log('⚠️ 系统页面不支持视频检测');
            players = [
                { id: 'default', name: '系统页面不支持视频检测', element: null, disabled: true }
            ];
            renderPlayersList();
            return;
        }

        console.log('📡 尝试与内容脚本通信...');
        let response;
        try {
            response = await chrome.tabs.sendMessage(tab.id, {
                action: 'getVideoPlayers'
            });
            console.log('✅ 内容脚本响应:', response);
        } catch (error) {
            console.log('首次通信失败，尝试注入内容脚本:', error);

            // 如果通信失败，尝试动态注入内容脚本
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: [
                    'scripts/utils.js',
                    'content/video-detector.js',
                    'content/content.js'
                ]
            });

            // 等待内容脚本初始化
            await new Promise(resolve => setTimeout(resolve, 500));

            // 重新尝试通信
            response = await chrome.tabs.sendMessage(tab.id, {
                action: 'getVideoPlayers'
            });
            console.log('✅ 注入后内容脚本响应:', response);
        }

        // 现在 response 已经被定义
        if (response && response.players) {
            players = response.players;
            console.log(`🎮 扫描到 ${players.length} 个播放器`);

            players.forEach((player, index) => {
                console.log(`   ${index + 1}. ${player.name} (${player.type})`);
            });

            if (players.length === 0) {
                console.log('⚠️ 未检测到视频播放器');
                players = [
                    { id: 'no-video', name: '未检测到视频播放器', element: null, disabled: true }
                ];
            }
            renderPlayersList();
        } else {
            console.log('❌ 没有收到播放器数据，响应:', response);
            throw new Error('没有收到播放器数据');
        }

    } catch (error) {
        console.error('❌ 扫描播放器失败:', error);
        players = [
            {
                id: 'error',
                name: `扫描失败: ${error.message}`,
                element: null,
                disabled: true,
                error: true
            }
        ];
        renderPlayersList();
    }
}
// 手动重新检测播放器
// 手动重新检测播放器
async function rescanPlayers() {
    console.log('🔄 === 开始手动重新检测播放器 ===');

    const rescanBtn = document.getElementById('rescanBtn');
    const originalText = rescanBtn.textContent;

    try {
        // 显示加载状态
        rescanBtn.textContent = '检测中...';
        rescanBtn.disabled = true;

        console.log('📝 清空当前播放器列表...');
        players = [];
        selectedPlayer = null;
        renderPlayersList();

        // 调用扫描函数
        await scanForPlayers();

        console.log(`✅ 重新检测完成，找到 ${players.length} 个播放器`);
        if (players.length > 0 && !players[0].disabled) {
            players.forEach((player, index) => {
                console.log(`   ${index + 1}. ${player.name} (${player.id})`);
            });
        } else {
            console.log('   📺 无可用播放器');
        }

    } catch (error) {
        console.error('❌ 重新检测失败:', error);
    } finally {
        // 恢复按钮状态
        rescanBtn.textContent = originalText;
        rescanBtn.disabled = false;
        console.log('🔄 === 手动重新检测结束 ===');
    }
}
// 渲染播放器列表
function renderPlayersList() {
    playersListEl.innerHTML = '';

    players.forEach(player => {
        const playerEl = document.createElement('div');
        playerEl.className = 'player-item';
        playerEl.textContent = player.name;
        playerEl.dataset.id = player.id;

        if (selectedPlayer && selectedPlayer.id === player.id) {
            playerEl.classList.add('selected');
        }

        playerEl.addEventListener('click', () => {
            selectedPlayer = player;
            renderPlayersList();
            updateSyncButton();
        });

        playersListEl.appendChild(playerEl);
    });
}

// 更新同步按钮状态
function updateSyncButton() {
    syncBtn.disabled = !isConnected || !selectedPlayer;
    syncBtn.textContent = isSyncing ? '停止同步' : '开始同步';
}

// 切换连接状态
async function toggleConnection() {
    if (isConnected) {
        await disconnect();
    } else {
        await connect();
    }
}

// 连接到同步服务器
async function connect() {
    const roomId = roomIdEl.value.trim();
    const serverUrl = serverUrlEl.value.trim();

    if (!roomId) {
        alert('请输入房间ID');
        return;
    }

    if (!serverUrl) {
        alert('请输入服务器地址');
        return;
    }

    try {
        // 通过background script建立连接
        await chrome.runtime.sendMessage({
            action: 'connect',
            serverUrl: serverUrl,
            roomId: roomId
        });

        isConnected = true;
        statusEl.textContent = `已连接到房间: ${roomId}`;
        statusEl.className = 'status connected';
        connectBtn.textContent = '断开连接';

        // 保存设置
        await chrome.storage.local.set({
            serverUrl: serverUrl,
            roomId: roomId
        });

        updateSyncButton();
    } catch (error) {
        console.error('连接失败:', error);
        alert('连接失败: ' + error.message);
    }
}

// 断开连接
async function disconnect() {
    try {
        await chrome.runtime.sendMessage({
            action: 'disconnect'
        });

        isConnected = false;
        isSyncing = false;
        statusEl.textContent = '未连接';
        statusEl.className = 'status disconnected';
        connectBtn.textContent = '连接';
        syncBtn.textContent = '开始同步';
        syncBtn.disabled = true;
    } catch (error) {
        console.error('断开连接失败:', error);
    }
}

// 切换同步状态
async function toggleSync() {
    if (!isSyncing) {
        await startSync();
    } else {
        await stopSync();
    }
}

// 开始同步
async function startSync() {
    if (!isConnected || !selectedPlayer) return;

    try {
        await chrome.runtime.sendMessage({
            action: 'startSync',
            playerId: selectedPlayer.id
        });

        isSyncing = true;
        updateSyncButton();
    } catch (error) {
        console.error('开始同步失败:', error);
    }
}

// 停止同步
async function stopSync() {
    try {
        await chrome.runtime.sendMessage({
            action: 'stopSync'
        });

        isSyncing = false;
        updateSyncButton();
    } catch (error) {
        console.error('停止同步失败:', error);
    }
}

// 监听来自background的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
        case 'connectionStatusChanged':
            isConnected = message.connected;
            if (!isConnected) {
                isSyncing = false;
                statusEl.textContent = '连接已断开';
                statusEl.className = 'status disconnected';
                connectBtn.textContent = '连接';
                syncBtn.disabled = true;
            }
            break;

        case 'syncStatusChanged':
            isSyncing = message.syncing;
            updateSyncButton();
            break;
    }
});

// 工具函数
function generateRoomId() {
    return Math.random().toString(36).substring(2, 8);
}

// 初始化插件
init();