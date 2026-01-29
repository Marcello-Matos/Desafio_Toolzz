const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const fs = require('fs');

// Configuração
const PORT = process.env.PORT || 8081;

// Criar aplicação Express
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir arquivos estáticos
app.use(express.static(__dirname));

// Criar servidor HTTP
const server = http.createServer(app);

// Configuração do banco de dados
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'chat',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

let db;
let isDbConnected = false;

// Função para conectar ao banco
function connectToDatabase() {
    db = mysql.createPool(dbConfig);
    
    // Testar conexão
    db.getConnection((err, connection) => {
        if (err) {
            console.error('❌ Erro ao conectar ao banco de dados:', err.message);
            isDbConnected = false;
            
            // Tentar reconectar após 5 segundos
            setTimeout(connectToDatabase, 5000);
            return;
        }
        
        console.log('✅ Conectado ao banco de dados MySQL');
        isDbConnected = true;
        
        // Criar tabelas se não existirem
        createTables();
        
        connection.release();
    });
    
    db.on('error', (err) => {
        console.error('❌ Erro no banco de dados:', err.message);
        if (err.code === 'PROTOCOL_CONNECTION_LOST') {
            isDbConnected = false;
            connectToDatabase();
        }
    });
}

// Função para criar tabelas
function createTables() {
    const tables = [
        // Tabela usuarios (simplificada)
        `CREATE TABLE IF NOT EXISTS usuarios (
            id VARCHAR(50) PRIMARY KEY,
            nome_usuario VARCHAR(50) NOT NULL,
            esta_online BOOLEAN DEFAULT FALSE,
            ultima_vez_visto DATETIME NULL,
            endereco_ip VARCHAR(45),
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ultima_atividade DATETIME NULL
        )`,
        
        // Tabela conversas (simplificada)
        `CREATE TABLE IF NOT EXISTS conversas (
            id VARCHAR(50) PRIMARY KEY,
            nome VARCHAR(100) NOT NULL,
            tipo ENUM('privada', 'grupo') DEFAULT 'privada',
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // Tabela mensagens (simplificada)
        `CREATE TABLE IF NOT EXISTS mensagens (
            id VARCHAR(50) PRIMARY KEY,
            conversa_id VARCHAR(50) NOT NULL,
            remetente_id VARCHAR(50) NOT NULL,
            conteudo TEXT NOT NULL,
            criada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`
    ];
    
    tables.forEach((sql, index) => {
        db.query(sql, (error) => {
            if (error) {
                console.error(`❌ Erro ao criar tabela ${index + 1}:`, error.message);
            } else {
                console.log(`✅ Tabela ${index + 1} criada/verificada`);
            }
        });
    });
}

// Clientes conectados
let clients = new Map();
let userCount = 0;

// Verificar se o arquivo index.html existe
const indexPath = path.join(__dirname, 'index.html');
const indexHtmlExists = fs.existsSync(indexPath);

// Rota principal - servir o sistema de chat (index.html)
app.get('/', (req, res) => {
    if (indexHtmlExists) {
        console.log(`📄 Servindo arquivo: ${indexPath}`);
        res.sendFile(indexPath);
    } else {
        // Se não existir index.html, mostrar página de status antiga
        const clientList = Array.from(clients.values()).map(user => ({
            id: user.id,
            username: user.username,
            ip: user.ip,
            connectedAt: user.connectedAt
        }));
        
        res.send(generateHtml(PORT, clientList));
    }
});

// Rota para interface antiga (status)
app.get('/status', (req, res) => {
    const clientList = Array.from(clients.values()).map(user => ({
        id: user.id,
        username: user.username,
        ip: user.ip,
        connectedAt: user.connectedAt
    }));
    
    res.send(generateHtml(PORT, clientList));
});

function generateHtml(port, clients) {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Servidor WebSocket WhatsApp</title>
    <style>
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            padding: 20px; 
            max-width: 1200px;
            margin: 0 auto;
            background: #f5f5f5;
        }
        .container {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #128C7E;
            border-bottom: 2px solid #128C7E;
            padding-bottom: 10px;
        }
        .status { 
            padding: 15px; 
            margin: 15px 0; 
            border-radius: 8px;
            border-left: 4px solid;
        }
        .connected { 
            background: #d4edda; 
            color: #155724;
            border-left-color: #28a745;
        }
        .error { 
            background: #f8d7da; 
            color: #721c24;
            border-left-color: #dc3545;
        }
        .info { 
            background: #d1ecf1; 
            color: #0c5460;
            border-left-color: #17a2b8;
        }
        .warning { 
            background: #fff3cd; 
            color: #856404;
            border-left-color: #ffc107;
        }
        .user { 
            background: #f8f9fa; 
            color: #212529; 
            padding: 10px; 
            margin: 5px; 
            border-radius: 5px;
            border: 1px solid #dee2e6;
            display: inline-block;
            min-width: 200px;
        }
        .user strong {
            color: #128C7E;
        }
        .log-entry {
            padding: 8px;
            margin: 5px 0;
            background: #f8f9fa;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            font-size: 14px;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 15px;
            margin: 20px 0;
        }
        .stat-card {
            background: white;
            padding: 15px;
            border-radius: 8px;
            border: 1px solid #dee2e6;
            text-align: center;
        }
        .stat-value {
            font-size: 24px;
            font-weight: bold;
            color: #128C7E;
        }
        .stat-label {
            color: #6c757d;
            font-size: 14px;
        }
        #logs {
            max-height: 400px;
            overflow-y: auto;
            border: 1px solid #dee2e6;
            border-radius: 5px;
            padding: 10px;
            background: white;
        }
        .db-status {
            font-weight: bold;
        }
        .db-connected {
            color: #28a745;
        }
        .db-disconnected {
            color: #dc3545;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔄 Servidor WebSocket WhatsApp</h1>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value" id="port">${port}</div>
                <div class="stat-label">Porta do Servidor</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="count">${clients.length}</div>
                <div class="stat-label">Clientes Conectados</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="uptime">0s</div>
                <div class="stat-label">Tempo de Atividade</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">
                    <span id="dbStatus" class="db-status db-disconnected">❌</span>
                </div>
                <div class="stat-label">Banco de Dados</div>
            </div>
        </div>
        
        <div class="status connected">
            ✅ Servidor rodando na porta ${port}
        </div>
        
        <div class="status ${isDbConnected ? 'connected' : 'error'}" id="dbStatusText">
            ${isDbConnected ? '✅ Banco de dados conectado' : '❌ Banco de dados desconectado'}
        </div>
        
        <div class="status info">
            📞 Endpoint WebSocket: <strong>ws://localhost:${port}</strong><br>
            📍 Endpoint HTTP: <strong>http://localhost:${port}</strong><br>
            📱 Sistema de Chat: <strong><a href="/">Abrir Sistema de Chat</a></strong>
        </div>
        
        <h3>👥 Usuários Online (${clients.length}):</h3>
        <div id="users">
            ${clients.length === 0 ? 
                '<div class="status info">Nenhum usuário conectado</div>' : 
                clients.map(user => `
                    <div class="user">
                        <strong>${user.username}</strong><br>
                        <small>ID: ${user.id}</small><br>
                        <small>IP: ${user.ip}</small><br>
                        <small>Conectado: ${new Date(user.connectedAt).toLocaleTimeString()}</small>
                    </div>
                `).join('')
            }
        </div>
        
        <h3>📋 Logs do Sistema:</h3>
        <div id="logs"></div>
    </div>
    
    <script>
        let serverStartTime = Date.now();
        let ws;
        
        // Atualizar tempo de atividade
        function updateUptime() {
            const uptime = Math.floor((Date.now() - serverStartTime) / 1000);
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const seconds = uptime % 60;
            
            document.getElementById('uptime').textContent = 
                hours > 0 ? \`\${hours}h \${minutes}m \${seconds}s\` :
                minutes > 0 ? \`\${minutes}m \${seconds}s\` : \`\${seconds}s\`;
        }
        setInterval(updateUptime, 1000);
        
        // Conectar ao WebSocket
        function connectWebSocket() {
            ws = new WebSocket(\`ws://localhost:${port}\`);
            
            ws.onopen = () => {
                addLog('✅ Conectado ao servidor de status');
            };
            
            ws.onerror = (error) => {
                addLog('❌ Erro na conexão WebSocket');
                setTimeout(connectWebSocket, 3000);
            };
            
            ws.onclose = () => {
                addLog('🔌 Conexão WebSocket fechada, reconectando...');
                setTimeout(connectWebSocket, 3000);
            };
            
            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    
                    if (data.type === 'server_stats') {
                        // Atualizar contador
                        document.getElementById('count').textContent = data.clientsCount;
                        
                        // Atualizar status do banco
                        if (data.dbStatus !== undefined) {
                            const dbStatusEl = document.getElementById('dbStatus');
                            const dbStatusText = document.getElementById('dbStatusText');
                            
                            if (data.dbStatus) {
                                dbStatusEl.textContent = '✅';
                                dbStatusEl.className = 'db-status db-connected';
                                dbStatusText.className = 'status connected';
                                dbStatusText.textContent = '✅ Banco de dados conectado';
                            } else {
                                dbStatusEl.textContent = '❌';
                                dbStatusEl.className = 'db-status db-disconnected';
                                dbStatusText.className = 'status error';
                                dbStatusText.textContent = '❌ Banco de dados desconectado';
                            }
                        }
                        
                        // Atualizar lista de usuários
                        const usersDiv = document.getElementById('users');
                        if (data.clients.length === 0) {
                            usersDiv.innerHTML = '<div class="status info">Nenhum usuário conectado</div>';
                        } else {
                            usersDiv.innerHTML = data.clients.map(user => \`
                                <div class="user">
                                    <strong>\${user.username}</strong><br>
                                    <small>ID: \${user.id}</small><br>
                                    <small>IP: \${user.ip}</small><br>
                                    <small>Conectado: \${new Date(user.connectedAt).toLocaleTimeString()}</small>
                                </div>
                            \`).join('');
                        }
                        
                        // Adicionar log
                        if (data.message) {
                            addLog(data.message);
                        }
                    }
                } catch (error) {
                    addLog('❌ Erro ao processar mensagem: ' + error.message);
                }
            };
        }
        
        function addLog(message) {
            const logsDiv = document.getElementById('logs');
            const logEntry = document.createElement('div');
            logEntry.className = 'log-entry';
            logEntry.textContent = \`[\${new Date().toLocaleTimeString()}] \${message}\`;
            logsDiv.prepend(logEntry);
            
            // Manter apenas últimos 50 logs
            const logs = logsDiv.children;
            if (logs.length > 50) {
                logsDiv.removeChild(logs[logs.length - 1]);
            }
        }
        
        // Iniciar conexão
        connectWebSocket();
        addLog('🚀 Página de status inicializada');
        addLog('📱 <a href="/">Clique aqui para abrir o Sistema de Chat</a>');
    </script>
</body>
</html>`;
}

// API Routes para o banco de dados
app.get('/api/db-test', async (req, res) => {
    if (!isDbConnected) {
        return res.status(500).json({ 
            error: 'Banco de dados não conectado',
            connected: false 
        });
    }
    
    try {
        db.query('SELECT COUNT(*) as total FROM mensagens', (error, results) => {
            if (error) {
                return res.status(500).json({ 
                    error: error.message,
                    connected: false 
                });
            }
            
            res.json({
                message: 'Banco de dados conectado com sucesso',
                connected: true,
                stats: {
                    total_mensagens: results[0]?.total || 0,
                    last_check: new Date().toISOString()
                }
            });
        });
    } catch (error) {
        res.status(500).json({ 
            error: error.message,
            connected: false 
        });
    }
});

app.get('/api/messages/:conversationId', async (req, res) => {
    if (!isDbConnected) {
        return res.status(500).json({ error: 'Banco de dados não conectado' });
    }
    
    const { conversationId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    try {
        db.query(
            `SELECT * FROM mensagens 
             WHERE conversa_id = ? 
             ORDER BY criada_em DESC 
             LIMIT ? OFFSET ?`,
            [conversationId, limit, offset],
            (error, results) => {
                if (error) {
                    return res.status(500).json({ error: error.message });
                }
                
                res.json({
                    messages: results,
                    total: results.length,
                    conversationId: conversationId
                });
            }
        );
} catch (error) {
    res.status(500).json({ error: error.message });
}
});

app.get('/api/stats', async (req, res) => {
if (!isDbConnected) {
return res.status(500).json({ error: 'Banco de dados não conectado' });
}

try {
const stats = {};

// Contar mensagens
db.query('SELECT COUNT(*) as count FROM mensagens', (error, results) => {
if (error) throw error;
stats.mensagens = results[0].count;

// Contar usuários
db.query('SELECT COUNT(*) as count FROM usuarios', (error, results) => {
if (error) throw error;
stats.usuarios = results[0].count;

// Contar conversas
db.query('SELECT COUNT(*) as count FROM conversas', (error, results) => {
if (error) throw error;
stats.conversas = results[0].count;

res.json({
status: 'success',
stats: stats,
timestamp: new Date().toISOString(),
server_uptime: process.uptime(),
clients_connected: clients.size
});
});
});
});
} catch (error) {
res.status(500).json({ error: error.message });
}
});

// Criar servidor WebSocket
const wss = new WebSocket.Server({
server,
clientTracking: true
});

console.log(`
╔══════════════════════════════════════════════════════╗
║         WHATSAPP WEB SOCKET SERVER v2.0             ║
╠══════════════════════════════════════════════════════╣
║ 🚀 Porta HTTP: ${PORT.toString().padEnd(35)} ║
║ 📍 URL HTTP: http://localhost:${PORT.toString().padEnd(30)} ║
║ 📡 URL WebSocket: ws://localhost:${PORT.toString().padEnd(27)} ║
║ 📱 Sistema de Chat: http://localhost:${PORT.toString().padEnd(23)} ║
║ 📊 Status: http://localhost:${PORT.toString().padEnd(28)}/status ║
║ 🗓️  Data: ${new Date().toLocaleDateString().padEnd(34)} ║
║ ⏰ Hora: ${new Date().toLocaleTimeString().padEnd(33)} ║
╚══════════════════════════════════════════════════════╝
`);

// Conectar ao banco de dados
connectToDatabase();

wss.on('connection', (ws, req) => {
userCount++;
const userId = `user_${Date.now()}_${userCount}`;
const userIp = req.socket.remoteAddress.replace('::ffff:', '');

const timestamp = new Date().toLocaleTimeString();
console.log(`👤 [${timestamp}] Nova conexão: ${userId} (${userIp})`);

// Configurar usuário
const user = {
id: userId,
ws: ws,
username: `Usuário_${userCount}`,
color: '#128C7E',
phone: '',
isOnline: true,
ip: userIp,
connectedAt: new Date(),
lastActivity: new Date()
};

clients.set(userId, user);

// Salvar usuário no banco
saveUserToDatabase(user);

// Atualizar página de status
broadcastServerStats(`👤 Novo usuário conectado: ${user.username}`);

// Enviar confirmação de conexão
sendToClient(ws, {
type: 'registered',
userId: userId,
message: '✅ Conexão estabelecida com o servidor!',
timestamp: new Date().toISOString(),
serverInfo: {
name: 'WhatsApp WebSocket Server',
version: '2.0.0',
clients: clients.size,
uptime: process.uptime()
}
});

// Enviar lista de usuários online
broadcastUserList();

// Notificar entrada do usuário (exceto para ele mesmo)
broadcastToAll({
type: 'user_joined',
userId: userId,
username: user.username,
color: user.color,
timestamp: new Date().toISOString(),
message: `${user.username} entrou no chat`
}, ws);

// Manipular mensagens
ws.on('message', async (message) => {
try {
user.lastActivity = new Date();
const data = JSON.parse(message.toString());

switch (data.type) {
case 'register':
await handleRegister(user, data);
break;
                    
case 'message':
await handleMessage(user, data);
break;
                    
case 'typing':
handleTyping(user, data);
break;
                    
case 'ping':
handlePing(user);
break;
                    
default:
console.log(`❓ [${timestamp}] ${user.username}: tipo desconhecido "${data.type}"`);
}
} catch (error) {
console.error(`❌ [${timestamp}] Erro ao processar mensagem:`, error.message);
}
});

// Manipular desconexão
ws.on('close', (code, reason) => {
const timestamp = new Date().toLocaleTimeString();
console.log(`👋 [${timestamp}] ${user.username} desconectado (${code}: ${reason || 'Sem motivo'})`);

// Atualizar usuário no banco
updateUserStatus(user.id, false);

// Notificar saída do usuário
broadcastToAll({
type: 'user_left',
userId: userId,
username: user.username,
timestamp: new Date().toISOString(),
message: `${user.username} saiu do chat`
});

// Remover da lista
clients.delete(userId);

// Atualizar listas
broadcastUserList();
broadcastServerStats(`👋 ${user.username} desconectado`);
});

// Manipular erros
ws.on('error', (error) => {
console.error(`💥 [${new Date().toLocaleTimeString()}] Erro no WebSocket:`, error.message);
});
});

// Funções do banco de dados
async function saveUserToDatabase(user) {
if (!isDbConnected) return;

const sql = `
INSERT INTO usuarios (id, nome_usuario, esta_online, endereco_ip, criado_em, ultima_atividade)
VALUES (?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
nome_usuario = VALUES(nome_usuario),
esta_online = VALUES(esta_online),
endereco_ip = VALUES(endereco_ip),
ultima_atividade = VALUES(ultima_atividade)
`;

const values = [
user.id,
user.username,
true,
user.ip,
user.connectedAt,
user.lastActivity
];

db.query(sql, values, (error) => {
if (error) {
console.error('❌ Erro ao salvar usuário no banco:', error.message);
} else {
console.log(`✅ Usuário salvo no banco: ${user.username}`);
}
});
}

async function updateUserStatus(userId, isOnline) {
if (!isDbConnected) return;

const sql = `UPDATE usuarios SET esta_online = ?, ultima_atividade = ? WHERE id = ?`;
db.query(sql, [isOnline, new Date(), userId], (error) => {
if (error) {
console.error('❌ Erro ao atualizar status do usuário:', error.message);
} else {
console.log(`✅ Status atualizado para usuário: ${userId} (online: ${isOnline})`);
}
});
}

async function saveMessageToDatabase(messageData) {
if (!isDbConnected) return null;

return new Promise((resolve, reject) => {
const sql = `
INSERT INTO mensagens 
(id, conversa_id, remetente_id, conteudo, criada_em)
VALUES (?, ?, ?, ?, ?)
`;

const values = [
messageData.messageId,
messageData.conversationId || 'general',
messageData.senderId,
messageData.message,
new Date()
];

db.query(sql, values, (error, results) => {
if (error) {
console.error('❌ Erro ao salvar mensagem no banco:', error.message);
reject(error);
} else {
console.log(`💾 Mensagem salva no banco: ${messageData.messageId}`);
resolve(results.insertId);
}
});
});
}

// Funções de manipulação
async function handleRegister(user, data) {
const oldName = user.username;
user.username = data.username || user.username;
user.color = data.color || user.color;
user.phone = data.phone || '';

const timestamp = new Date().toLocaleTimeString();
console.log(`📝 [${timestamp}] ${oldName} → ${user.username} (registrado)`);

// Atualizar usuário no banco
await saveUserToDatabase(user);

// Confirmar registro
sendToClient(user.ws, {
type: 'registered',
userId: user.id,
username: user.username,
color: user.color,
phone: user.phone
});

// Notificar mudança de nome
if (oldName !== user.username) {
broadcastToAll({
type: 'user_updated',
userId: user.id,
oldUsername: oldName,
newUsername: user.username,
timestamp: new Date().toISOString(),
message: `${oldName} agora é ${user.username}`
});
}

// Atualizar listas
broadcastUserList();
broadcastServerStats(`📝 ${oldName} registrou-se como ${user.username}`);
}

async function handleMessage(user, data) {
const timestamp = new Date().toLocaleTimeString();
const messagePreview = data.message.length > 50 ?
data.message.substring(0, 50) + '...' : data.message;

console.log(`💬 [${timestamp}] ${user.username}: ${messagePreview}`);

const messageId = data.messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Salvar mensagem no banco de dados
let dbMessageId = null;
try {
dbMessageId = await saveMessageToDatabase({
messageId: messageId,
conversationId: data.conversationId || 'general',
senderId: user.id,
message: data.message
});
} catch (error) {
console.error('❌ Falha ao salvar mensagem no banco:', error.message);
}

// Retransmitir mensagem para todos
const messageData = {
type: 'new_message',
conversationId: data.conversationId || 'general',
message: data.message,
senderId: user.id,
senderName: user.username,
senderColor: user.color,
timestamp: new Date().toISOString(),
messageId: messageId,
dbId: dbMessageId
};

broadcastToAll(messageData, user.ws);

// Confirmar entrega ao remetente
sendToClient(user.ws, {
type: 'message_delivered',
messageId: data.messageId || messageId,
dbId: dbMessageId,
timestamp: new Date().toISOString()
});
}

function handleTyping(user, data) {
broadcastToAll({
type: 'typing',
conversationId: data.conversationId || 'general',
userId: user.id,
username: user.username,
isTyping: data.isTyping || false,
timestamp: new Date().toISOString()
}, user.ws);
}

function handlePing(user) {
sendToClient(user.ws, {
type: 'pong',
timestamp: new Date().toISOString(),
serverTime: Date.now()
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

function broadcastToAll(data, excludeWs = null) {
const message = JSON.stringify(data);
let sentCount = 0;

clients.forEach((client) => {
if (client.ws !== excludeWs && client.ws.readyState === WebSocket.OPEN) {
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

function broadcastUserList() {
const userList = Array.from(clients.values()).map(user => ({
id: user.id,
username: user.username,
color: user.color,
phone: user.phone,
isOnline: user.isOnline,
ip: user.ip,
connectedAt: user.connectedAt,
lastActivity: user.lastActivity
}));

broadcastToAll({
type: 'userlist',
users: userList,
total: userList.length,
timestamp: new Date().toISOString()
});
}

function broadcastServerStats(message = '') {
const clientList = Array.from(clients.values()).map(user => ({
id: user.id,
username: user.username,
ip: user.ip,
connectedAt: user.connectedAt
}));

// Enviar para página de status (todos os clientes WebSocket)
wss.clients.forEach(client => {
if (client.readyState === WebSocket.OPEN) {
try {
client.send(JSON.stringify({
type: 'server_stats',
clientsCount: clients.size,
clients: clientList,
dbStatus: isDbConnected,
message: message,
timestamp: new Date().toISOString(),
serverUptime: process.uptime()
}));
} catch (error) {
// Ignora erros na página de status
}
}
});
}

// Iniciar servidor
server.listen(PORT, () => {
console.log('📞 Aguardando conexões...\n');
console.log('🌐 URLs disponíveis:');
console.log(`   1. Sistema de Chat: http://localhost:${PORT}`);
console.log(`   2. Status do Servidor: http://localhost:${PORT}/status`);
console.log(`   3. Testar Banco: http://localhost:${PORT}/api/db-test`);
console.log(`   4. Estatísticas: http://localhost:${PORT}/api/stats`);
console.log('\n📡 Protocolo WebSocket:');
console.log('   • ws://localhost:' + PORT);
console.log('   • Tipos de mensagem: register, message, typing, ping');
console.log('\n🛑 Pressione Ctrl+C para parar o servidor\n');
});

// Monitorar inatividade
setInterval(() => {
const now = new Date();
clients.forEach((user, userId) => {
const inactiveTime = (now - user.lastActivity) / 1000;
if (inactiveTime > 300) {
console.log(`⏰ [${now.toLocaleTimeString()}] Desconectando ${user.username} (inatividade: ${Math.floor(inactiveTime)}s)`);
user.ws.close(1000, 'Inatividade');
}
});
}, 60000);

// Heartbeat para manter conexões ativas
setInterval(() => {
clients.forEach((user) => {
if (user.ws.readyState === WebSocket.OPEN) {
sendToClient(user.ws, {
type: 'heartbeat',
timestamp: Date.now()
});
}
});
}, 30000);

// Atualizar status do banco periodicamente
setInterval(() => {
if (db) {
db.query('SELECT 1', (error) => {
if (error) {
console.error('❌ Banco de dados offline:', error.message);
isDbConnected = false;
} else {
isDbConnected = true;
}
});
}
}, 10000);

// Manipular encerramento gracioso
process.on('SIGINT', () => {
console.log('\n\n🛑 Desligando servidor WebSocket...');
console.log(`📤 Desconectando ${clients.size} cliente(s)...`);
console.log(`🗄️  Fechando conexão com banco de dados...`);

// Notificar todos os clientes
broadcastToAll({
type: 'server_shutdown',
message: 'Servidor está sendo desligado',
timestamp: new Date().toISOString()
});

// Fechar todas as conexões
clients.forEach((client) => {
if (client.ws.readyState === WebSocket.OPEN) {
client.ws.close(1000, 'Servidor desligando');
}
});

// Fechar pool do banco
if (db) {
db.end((error) => {
if (error) {
console.error('❌ Erro ao fechar banco:', error.message);
} else {
console.log('✅ Conexão com banco fechada');
}
});
}

// Fechar servidores
setTimeout(() => {
wss.close(() => {
server.close(() => {
console.log('✅ Servidor desligado com sucesso');
process.exit(0);
});
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