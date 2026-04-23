const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const HISTORY_FILE = path.join(__dirname, 'push_history.json');

// ==================== Express 静态文件 ====================
const app = express();
const server = http.createServer(app);

app.use(express.static(path.join(__dirname, 'public')));

// 路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'frontend.html'));
});
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'backend.html'));
});

// ==================== WebSocket 服务器 ====================
const wss = new WebSocketServer({ server, path: '/ws' });

// 状态管理
const frontendClients = new Map();  // clientId -> { ws, name, online, registeredAt, currentContent }
const adminSockets = new Set();     // 管理端 WebSocket 连接

// 推送历史 - 从文件加载已完成的记录
let pushHistory = [];
try {
    if (fs.existsSync(HISTORY_FILE)) {
        const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
        pushHistory = JSON.parse(data);
    }
} catch (e) {
    console.warn('[历史] 读取历史文件失败，使用空列表', e.message);
    pushHistory = [];
}

// 保存已完成的记录到文件
function saveCompletedHistory() {
    try {
        const completed = pushHistory.filter(h => h.status === 'completed');
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(completed, null, 2), 'utf-8');
    } catch (e) {
        console.warn('[历史] 保存历史文件失败', e.message);
    }
}

// 生成记录ID
function generateHistoryId() {
    return 'h_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
}

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.role = null;       // 'frontend' | 'admin'
    ws.clientId = null;

    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch (e) { return; }
        if (!msg || !msg.type) return;

        switch (msg.type) {
            // ============ 前端注册 ============
            case 'register': {
                ws.role = 'frontend';
                ws.clientId = msg.clientId || generateId();
                const clientInfo = {
                    ws: ws,
                    name: msg.phone || msg.clientName || ws.clientId,
                    phone: msg.phone || '',
                    online: true,
                    registeredAt: Date.now(),
                    currentContent: '',
                };
                frontendClients.set(ws.clientId, clientInfo);

                // 回复注册成功
                ws.send(JSON.stringify({
                    type: 'register_ack',
                    clientId: ws.clientId,
                }));

                // 通知所有管理端
                broadcastToAdmins({
                    type: 'client_joined',
                    clientId: ws.clientId,
                    name: clientInfo.name,
                    phone: clientInfo.phone,
                    registeredAt: clientInfo.registeredAt,
                    currentContent: '',
                });
                console.log(`[前端注册] ${clientInfo.name} (${ws.clientId.slice(-8)})`);
                break;
            }

            // ============ 管理端注册 ============
            case 'admin_register': {
                ws.role = 'admin';
                adminSockets.add(ws);

                // 回复当前所有在线前端客户端
                const clientList = [];
                for (const [id, info] of frontendClients) {
                    if (info.online) {
                        clientList.push({
                            clientId: id,
                            name: info.name,
                            phone: info.phone || '',
                            registeredAt: info.registeredAt,
                            currentContent: info.currentContent || '',
                        });
                    }
                }
                ws.send(JSON.stringify({
                    type: 'client_list',
                    clients: clientList,
                }));
                // 同时发送推送历史
                ws.send(JSON.stringify({
                    type: 'push_history_update',
                    history: pushHistory,
                }));
                console.log('[管理端] 已连接，发送客户端列表');
                break;
            }

            // ============ 推送 ============
            case 'push': {
                const targetId = msg.targetClient;
                const payload = msg.payload;
                if (!payload) break;

                // 记录推送历史
                if (targetId === 'all') {
                    // 推送到所有前端
                    for (const [id, info] of frontendClients) {
                        if (info.online && info.ws && info.ws.readyState === 1) {
                            info.ws.send(JSON.stringify({
                                type: 'push',
                                payload: payload,
                            }));
                        }
                        info.currentContent = payload.content || '';
                        // 每个客户端记录一条
                        if (info.phone) {
                            pushHistory.push({
                                id: generateHistoryId(),
                                phone: info.phone,
                                content: payload.content || '',
                                time: Date.now(),
                                targetId: id,
                                status: 'pending',
                            });
                        }
                    }
                } else {
                    // 推送到指定前端
                    const target = frontendClients.get(targetId);
                    if (target && target.online && target.ws && target.ws.readyState === 1) {
                        target.ws.send(JSON.stringify({
                            type: 'push',
                            payload: payload,
                        }));
                        target.currentContent = payload.content || '';
                    }
                    if (target && target.phone) {
                        pushHistory.push({
                            id: generateHistoryId(),
                            phone: target.phone,
                            content: payload.content || '',
                            time: Date.now(),
                            targetId: targetId,
                            status: 'pending',
                        });
                    }
                }

                // 通知管理端更新状态
                broadcastToAdmins({
                    type: 'client_updated',
                    clientId: targetId,
                    currentContent: payload.content || '',
                });
                // 通知管理端推送历史更新
                broadcastToAdmins({
                    type: 'push_history_update',
                    history: pushHistory,
                });
                console.log(`[推送] → ${targetId === 'all' ? '全部' : targetId.slice(-8)}: ${(payload.content || '').substring(0, 30)}`);
                break;
            }

            // ============ 清空 ============
            case 'clear': {
                const clearId = msg.targetClient;
                if (clearId === 'all') {
                    for (const [id, info] of frontendClients) {
                        if (info.online && info.ws && info.ws.readyState === 1) {
                            info.ws.send(JSON.stringify({ type: 'clear' }));
                        }
                        info.currentContent = '';
                    }
                } else {
                    const target = frontendClients.get(clearId);
                    if (target && target.online && target.ws && target.ws.readyState === 1) {
                        target.ws.send(JSON.stringify({ type: 'clear' }));
                    }
                    if (target) target.currentContent = '';
                }

                broadcastToAdmins({
                    type: 'client_updated',
                    clientId: clearId,
                    currentContent: '',
                });
                console.log(`[清空] → ${clearId === 'all' ? '全部' : clearId.slice(-8)}`);
                break;
            }

            // ============ 历史记录：标记已完成 ============
            case 'history_complete': {
                const hid = msg.historyId;
                const item = pushHistory.find(h => h.id === hid);
                if (item) {
                    item.status = 'completed';
                    item.completedAt = Date.now();
                    saveCompletedHistory();
                    broadcastToAdmins({
                        type: 'push_history_update',
                        history: pushHistory,
                    });
                    console.log(`[历史] 已完成: ${item.phone}`);
                }
                break;
            }

            // ============ 历史记录：删除 ============
            case 'history_delete': {
                const delId = msg.historyId;
                const delIdx = pushHistory.findIndex(h => h.id === delId);
                if (delIdx !== -1) {
                    const removed = pushHistory.splice(delIdx, 1)[0];
                    saveCompletedHistory();
                    broadcastToAdmins({
                        type: 'push_history_update',
                        history: pushHistory,
                    });
                    console.log(`[历史] 已删除: ${removed.phone}`);
                }
                break;
            }
        }
    });

    ws.on('close', () => {
        if (ws.role === 'frontend' && ws.clientId) {
            const info = frontendClients.get(ws.clientId);
            if (info) {
                info.online = false;
                // 通知管理端
                broadcastToAdmins({
                    type: 'client_left',
                    clientId: ws.clientId,
                });
                console.log(`[前端离线] ${info.name} (${ws.clientId.slice(-8)})`);
            }
            // 30秒后彻底移除
            setTimeout(() => {
                const still = frontendClients.get(ws.clientId);
                if (still && !still.online) {
                    frontendClients.delete(ws.clientId);
                }
            }, 30000);
        }
        if (ws.role === 'admin') {
            adminSockets.delete(ws);
            console.log('[管理端] 已断开');
        }
    });
});

// ==================== 心跳检测 ====================
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
            ws.terminate();
            return;
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 15000);

wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

// ==================== 工具函数 ====================
function broadcastToAdmins(msg) {
    const data = JSON.stringify(msg);
    for (const adminWs of adminSockets) {
        if (adminWs.readyState === 1) {
            adminWs.send(data);
        }
    }
}

function generateId() {
    return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
}

// ==================== 启动 ====================
server.listen(PORT, () => {
    console.log('========================================');
    console.log('  📡 二维码推送服务器已启动');
    console.log(`  前端页面: http://localhost:${PORT}`);
    console.log(`  后台管理: http://localhost:${PORT}/admin`);
    console.log('========================================');
});
