const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');
const fs = require('fs');

// Configuração
const PORT = 8081;

// Criar aplicação Express
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir arquivos estáticos
app.use(express.static(__dirname));

// Criar servidor HTTP
const server = http.createServer(app);

// Verificar se index.html existe
const indexPath = path.join(__dirname, 'index.html');
console.log(`📁 Arquivo index.html: ${fs.existsSync(indexPath) ? '✅ Encontrado' : '❌ Não encontrado'}`);

// Rota principal - servir o sistema de chat
app.get('/', (req, res) => {
    if (fs.existsSync(indexPath)) {
        console.log(`📄 Servindo: ${indexPath}`);
        res.sendFile(indexPath);
    } else {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Erro - Sistema de Chat</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 40px; text-align: center; }
                    .error { color: red; font-size: 24px; margin: 20px 0; }
                    .info { background: #f0f0f0; padding: 20px; border-radius: 10px; max-width: 600px; margin: 0 auto; }
                    .file-list { text-align: left; background: white; padding: 10px; border-radius: 5px; margin: 10px 0; }
                </style>
            </head>
            <body>
                <h1>⚠️ Sistema de Chat</h1>
                <div class="error">Arquivo index.html não encontrado!</div>
                <div class="info">
                    <p><strong>Diretório atual:</strong> ${__dirname}</p>
                    <p><strong>Arquivos na pasta:</strong></p>
                    <div class="file-list">
                        <pre>${fs.readdirSync(__dirname).join('\n')}</pre>
                    </div>
                </div>
            </body>
            </html>
        `);
    }
});

// Rota para status do servidor
app.get('/status', (req, res) => {
    const clientsList = Array.from(clients.values()).map(user => ({
        id: user.id,
        username: user.username,
        ip: user.ip,
        connectedAt: user.connectedAt.toLocaleTimeString(),
        color: user.color
    }));
    
    res.json({
        status: 'online',
        server: {
            port: PORT,
            uptime: process.uptime(),
            memory: process.memoryUsage()
        },
        connections: {
            totalClients: clients.size,
            clients: clientsList
        },
        timestamp: new Date().toISOString()
    });
});

// Rota para testar
app.get('/test', (req, res) => {
    res.json({
        message: 'Servidor funcionando!',
        endpoints: {
            chat: `http://localhost:${PORT}/`,
            status: `http://localhost:${PORT}/status`,
            websocket: `ws://localhost:${PORT}`
        },
        files: {
            indexHtml: fs.existsSync(indexPath) ? '✅ Presente' : '❌ Ausente',
            size: fs.existsSync(indexPath) ? `${fs.statSync(indexPath).size} bytes` : 'N/A'
        }
    });
});

// Clientes conectados
let clients = new Map();
let userCount = 0;

// Criar servidor WebSocket
const wss = new WebSocket.Server({ server });

console.log(`
╔══════════════════════════════════════════════════════╗
║            SISTEMA DE CHAT - SERVIDOR               ║
╠══════════════════════════════════════════════════════╣
║ 🚀 Servidor HTTP: http://localhost:${PORT}                  ║
║ 📡 WebSocket: ws://localhost:${PORT}                      ║
║ 📱 Sistema de Chat: http://localhost:${PORT}/            ║
║ 📊 Status: http://localhost:${PORT}/status               ║
║ 🧪 Teste: http://localhost:${PORT}/test                  ║
║ 📍 Diretório: ${__dirname}              ║
╚══════════════════════════════════════════════════════╝
`);

// Gerenciamento de conexões WebSocket
wss.on('connection', (ws, req) => {
    userCount++;
    const userId = `user_${Date.now()}_${userCount}`;
    const userIp = req.socket.remoteAddress.replace('::ffff:', '');
    
    console.log(`👤 [${new Date().toLocaleTimeString()}] Nova conexão: ${userId} (${userIp})`);
    
    // Configurar usuário
    const user = {
        id: userId,
        ws: ws,
        username: `Usuário_${userCount}`,
        color: getRandomColor(),
        ip: userIp,
        connectedAt: new Date(),
        lastActivity: new Date(),
        isOnline: true
    };
    
    clients.set(userId, user);
    
    // Enviar confirmação de conexão
    sendToClient(ws, {
        type: 'welcome',
        userId: userId,
        username: user.username,
        color: user.color,
        timestamp: new Date().toISOString(),
        message: '✅ Conectado ao sistema de chat!',
        serverInfo: {
            name: 'Chat Server',
            version: '1.0.0',
            clients: clients.size,
            uptime: process.uptime()
        }
    });
    
    // Enviar lista de usuários online
    broadcastUserList();
    
    // Notificar outros usuários sobre nova conexão (exceto o novo)
    broadcastToOthers(userId, {
        type: 'user_joined',
        userId: userId,
        username: user.username,
        color: user.color,
        timestamp: new Date().toISOString(),
        message: `${user.username} entrou no chat`
    });
    
    // Mensagem de sistema
    broadcastSystemMessage(`${user.username} entrou no chat`);
    
    // Manipular mensagens do cliente
    ws.on('message', (data) => {
        try {
            user.lastActivity = new Date();
            const message = JSON.parse(data.toString());
            
            console.log(`📨 [${new Date().toLocaleTimeString()}] ${user.username}: ${message.type}`);
            
            switch (message.type) {
                case 'register':
                    handleRegister(user, message);
                    break;
                    
                case 'message':
                    handleMessage(user, message);
                    break;
                    
                case 'typing':
                    handleTyping(user, message);
                    break;
                    
                case 'ping':
                    handlePing(user);
                    break;
                    
                case 'get_users':
                    sendUserList(user);
                    break;
                    
                default:
                    console.log(`❓ Tipo desconhecido: ${message.type}`);
                    sendToClient(ws, {
                        type: 'error',
                        message: `Tipo desconhecido: ${message.type}`,
                        timestamp: new Date().toISOString()
                    });
            }
        } catch (error) {
            console.error(`❌ Erro ao processar mensagem:`, error.message);
            sendToClient(ws, {
                type: 'error',
                message: 'Erro ao processar mensagem',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    });
    
    // Manipular desconexão
    ws.on('close', () => {
        console.log(`👋 [${new Date().toLocaleTimeString()}] ${user.username} desconectado`);
        
        // Notificar outros usuários
        broadcastToOthers(userId, {
            type: 'user_left',
            userId: userId,
            username: user.username,
            timestamp: new Date().toISOString(),
            message: `${user.username} saiu do chat`
        });
        
        // Mensagem de sistema
        broadcastSystemMessage(`${user.username} saiu do chat`);
        
        // Remover do mapa
        clients.delete(userId);
        
        // Atualizar lista de usuários
        broadcastUserList();
    });
    
    // Manipular erros
    ws.on('error', (error) => {
        console.error(`💥 Erro na conexão de ${user.username}:`, error.message);
    });
});

// Funções de manipulação
function handleRegister(user, data) {
    const oldUsername = user.username;
    user.username = data.username || user.username;
    user.color = data.color || user.color;
    
    console.log(`📝 ${oldUsername} → ${user.username}`);
    
    // Confirmar registro
    sendToClient(user.ws, {
        type: 'registered',
        userId: user.id,
        username: user.username,
        color: user.color,
        timestamp: new Date().toISOString()
    });
    
    // Notificar mudança de nome
    if (oldUsername !== user.username) {
        broadcastToAll({
            type: 'user_updated',
            userId: user.id,
            oldUsername: oldUsername,
            newUsername: user.username,
            timestamp: new Date().toISOString()
        });
        
        broadcastSystemMessage(`${oldUsername} agora é ${user.username}`);
    }
    
    // Atualizar lista
    broadcastUserList();
}

function handleMessage(user, data) {
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toLocaleTimeString();
    
    console.log(`💬 [${timestamp}] ${user.username}: ${data.text?.substring(0, 50)}${data.text?.length > 50 ? '...' : ''}`);
    
    // Criar objeto de mensagem
    const messageObj = {
        id: messageId,
        sender: user.username,
        senderId: user.id,
        text: data.text,
        time: timestamp,
        chatId: data.chatId || 'group',
        isSystem: false,
        color: user.color,
        timestamp: new Date().toISOString()
    };
    
    // Enviar para todos
    broadcastToAll({
        type: 'new_message',
        message: messageObj,
        chatId: data.chatId || 'group'
    });
    
    // Confirmar entrega
    sendToClient(user.ws, {
        type: 'message_delivered',
        messageId: messageId,
        timestamp: new Date().toISOString()
    });
}

function handleTyping(user, data) {
    broadcastToOthers(user.id, {
        type: 'typing',
        userId: user.id,
        username: user.username,
        chatId: data.chatId || 'group',
        isTyping: data.isTyping || false,
        timestamp: new Date().toISOString()
    });
}

function handlePing(user) {
    sendToClient(user.ws, {
        type: 'pong',
        timestamp: new Date().toISOString(),
        serverTime: Date.now()
    });
}

function sendUserList(user) {
    const userList = Array.from(clients.values()).map(u => ({
        id: u.id,
        name: u.username,
        online: true,
        lastSeen: u.connectedAt.toLocaleTimeString(),
        color: u.color
    }));
    
    sendToClient(user.ws, {
        type: 'user_list',
        users: userList,
        total: userList.length,
        timestamp: new Date().toISOString()
    });
}

// Funções auxiliares
function sendToClient(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(data));
        } catch (error) {
            console.error('❌ Erro ao enviar para cliente:', error.message);
        }
    }
}

function broadcastToAll(data, excludeUserId = null) {
    const message = JSON.stringify(data);
    let sentCount = 0;
    
    clients.forEach((client, clientId) => {
        if (clientId !== excludeUserId && client.ws.readyState === WebSocket.OPEN) {
            try {
                client.ws.send(message);
                sentCount++;
            } catch (error) {
                console.error(`❌ Erro ao enviar para ${client.username}:`, error.message);
            }
        }
    });
    
    return sentCount;
}

function broadcastToOthers(excludeUserId, data) {
    return broadcastToAll(data, excludeUserId);
}

function broadcastUserList() {
    const userList = Array.from(clients.values()).map(user => ({
        id: user.id,
        name: user.username,
        online: true,
        lastSeen: user.connectedAt.toLocaleTimeString(),
        color: user.color,
        ip: user.ip
    }));
    
    broadcastToAll({
        type: 'user_list',
        users: userList,
        total: userList.length,
        timestamp: new Date().toISOString()
    });
}

function broadcastSystemMessage(text) {
    const systemMessage = {
        id: `sys_${Date.now()}`,
        sender: 'Sistema',
        text: text,
        time: new Date().toLocaleTimeString(),
        chatId: 'group',
        isSystem: true,
        color: '#666',
        timestamp: new Date().toISOString()
    };
    
    broadcastToAll({
        type: 'new_message',
        message: systemMessage,
        chatId: 'group'
    });
}

function getRandomColor() {
    const colors = [
        '#e94560', '#4caf50', '#2196f3', '#ff9800', 
        '#9c27b0', '#00bcd4', '#8bc34a', '#ff5722',
        '#607d8b', '#795548'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Iniciar servidor
server.listen(PORT, () => {
    console.log('\n📞 Aguardando conexões...\n');
    console.log('🌐 URLs disponíveis:');
    console.log(`   1. Sistema de Chat: http://localhost:${PORT}`);
    console.log(`   2. Status do Servidor: http://localhost:${PORT}/status`);
    console.log(`   3. Teste: http://localhost:${PORT}/test`);
    console.log('\n📡 Protocolo WebSocket:');
    console.log(`   • Endpoint: ws://localhost:${PORT}`);
    console.log(`   • Tipos de mensagem: register, message, typing, ping, get_users`);
    console.log('\n📊 Monitoramento:');
    console.log(`   • Clientes conectados: ${clients.size}`);
    console.log(`   • Diretório: ${__dirname}`);
    console.log('\n🛑 Pressione Ctrl+C para parar\n');
});

// Heartbeat para manter conexões
setInterval(() => {
    clients.forEach((user) => {
        if (user.ws.readyState === WebSocket.OPEN) {
            sendToClient(user.ws, {
                type: 'heartbeat',
                timestamp: Date.now(),
                serverTime: new Date().toISOString()
            });
        }
    });
}, 30000);

// Limpar usuários inativos (5 minutos)
setInterval(() => {
    const now = new Date();
    clients.forEach((user, userId) => {
        const inactiveTime = (now - user.lastActivity) / 1000;
        if (inactiveTime > 300) {
            console.log(`⏰ Desconectando ${user.username} (inatividade: ${Math.floor(inactiveTime)}s)`);
            user.ws.close(1000, 'Inatividade');
        }
    });
}, 60000);

// Desligamento gracioso
process.on('SIGINT', () => {
    console.log('\n\n🛑 Desligando servidor...');
    console.log(`📤 Desconectando ${clients.size} cliente(s)...`);
    
    // Notificar clientes
    broadcastSystemMessage('⚠️ Servidor está sendo desligado');
    
    // Fechar conexões
    clients.forEach((client) => {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.close(1000, 'Servidor desligando');
        }
    });
    
    // Fechar servidor
    setTimeout(() => {
        wss.close();
        server.close(() => {
            console.log('✅ Servidor desligado com sucesso');
            process.exit(0);
        });
    }, 1000);
});

// Log de erros não tratados
process.on('uncaughtException', (error) => {
    console.error('💥 Erro não tratado:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('💥 Promise rejeitada não tratada:', error);
});