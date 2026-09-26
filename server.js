/**
 * Zero-Dependency Standalone Node.js Web & WebSocket Relay Server
 * Supports Customer Portal (/) and Master Admin Terminal (/admin)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HTTP_PORT = process.env.PORT || 3000;

// 1. Static Web Server (serves index.html, admin.html, styles.css, app.js)
const server = http.createServer((req, res) => {
    let reqUrl = req.url.split('?')[0];
    let fileName = 'index.html';
    
    if (reqUrl === '/admin' || reqUrl === '/admin.html') {
        fileName = 'admin.html';
    } else if (reqUrl !== '/') {
        fileName = reqUrl.replace(/^\//, '');
    }

    let filePath = path.join(__dirname, fileName);
    const ext = path.extname(filePath);
    
    let contentType = 'text/html';
    if (ext === '.css') contentType = 'text/css';
    if (ext === '.js') contentType = 'application/javascript';
    if (ext === '.json') contentType = 'application/json';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

// 2. Zero-Dependency Native WebSocket Server
const clients = new Set();
const adminSockets = new Set();
const sessions = new Map();

server.on('upgrade', (req, socket, head) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
        socket.destroy();
        return;
    }

    const acceptKey = crypto
        .createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');

    const headers = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`
    ];

    socket.write(headers.join('\r\n') + '\r\n\r\n');
    clients.add(socket);

    const clientIp = req.socket.remoteAddress;
    console.log(`[+] Client connected from ${clientIp}`);

    socket.on('data', (buffer) => {
        if (buffer.length < 2) return;
        const firstByte = buffer[0];
        const opcode = firstByte & 0x0f;

        // 8 = Close frame
        if (opcode === 8) {
            handleDisconnect(socket);
            return;
        }

        const isMasked = (buffer[1] & 0x80) !== 0;
        let payloadLen = buffer[1] & 0x7f;
        let offset = 2;

        if (payloadLen === 126) {
            payloadLen = buffer.readUInt16BE(2);
            offset = 4;
        } else if (payloadLen === 127) {
            payloadLen = Number(buffer.readBigUInt64BE(2));
            offset = 10;
        }

        let maskingKey = null;
        if (isMasked) {
            maskingKey = buffer.slice(offset, offset + 4);
            offset += 4;
        }

        let payload = buffer.slice(offset, offset + payloadLen);
        if (isMasked && maskingKey) {
            for (let i = 0; i < payload.length; i++) {
                payload[i] ^= maskingKey[i % 4];
            }
        }

        // Opcode 1: Text / Control Messages
        if (opcode === 1) {
            try {
                const text = payload.toString('utf8');
                const json = JSON.parse(text);
                
                if (json.type === 'ADMIN_INIT') {
                    if (json.token === '23UEIT0051@Shiva') {
                        adminSockets.add(socket);
                        console.log(`[ADMIN AUTH] Master Admin Terminal Authenticated & Connected`);
                        sendWsFrame(socket, JSON.stringify({ type: 'ACK', message: 'Admin Terminal Authenticated' }));
                    } else {
                        console.warn(`[ADMIN AUTH] Unauthorized access attempt blocked from ${clientIp}`);
                        sendWsFrame(socket, JSON.stringify({ type: 'AUTH_FAILED', message: 'Invalid Admin Token' }));
                        socket.end();
                    }
                    return;
                }

                if (json.type === 'HANDSHAKE') {
                    sessions.set(socket, { sessionId: json.sessionId, ip: clientIp });
                    console.log(`[SESSION] Client ${json.sessionId} Active`);
                    sendWsFrame(socket, JSON.stringify({ type: 'ACK', message: 'Connected to Relay' }));
                    
                    // Notify Admin Terminals
                    broadcastToAdmins(JSON.stringify({
                        type: 'CLIENT_CONNECTED',
                        sessionId: json.sessionId,
                        ip: clientIp
                    }));
                }

                if (json.type === 'DEVICE_INFO') {
                    console.log(`[DEVICE] ${json.productName} (VID: 0x${json.vid})`);
                    broadcastToAdmins(JSON.stringify({
                        type: 'DEVICE_PAIRED',
                        sessionId: json.sessionId || 'CLIENT',
                        productName: json.productName,
                        vid: json.vid,
                        pid: json.pid
                    }));
                }
            } catch (e) {}
        } else if (opcode === 2) {
            // Opcode 2: Binary USB Data (Forward to Admin Terminals)
            console.log(`[USB DATA] Received ${payload.length} bytes`);
            broadcastBinaryToAdmins(payload);
        }
    });

    socket.on('close', () => {
        handleDisconnect(socket);
    });

    socket.on('error', () => {
        handleDisconnect(socket);
    });
});

function handleDisconnect(socket) {
    const s = sessions.get(socket);
    if (s) {
        broadcastToAdmins(JSON.stringify({ type: 'CLIENT_DISCONNECTED', sessionId: s.sessionId }));
        sessions.delete(socket);
    }
    clients.delete(socket);
    adminSockets.delete(socket);
    try { socket.end(); } catch (e) {}
    console.log('[-] Client disconnected');
}

function sendWsFrame(socket, text) {
    const payload = Buffer.from(text, 'utf8');
    const header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + Text frame
    header[1] = payload.length;
    socket.write(Buffer.concat([header, payload]));
}

function broadcastToAdmins(text) {
    const payload = Buffer.from(text, 'utf8');
    const header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = payload.length;
    const frame = Buffer.concat([header, payload]);
    
    for (const admin of adminSockets) {
        try { admin.write(frame); } catch (e) {}
    }
}

function broadcastBinaryToAdmins(binaryBuffer) {
    let header;
    if (binaryBuffer.length < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x82; // Binary frame
        header[1] = binaryBuffer.length;
    } else if (binaryBuffer.length < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x82;
        header[1] = 126;
        header.writeUInt16BE(binaryBuffer.length, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x82;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(binaryBuffer.length), 2);
    }
    const frame = Buffer.concat([header, binaryBuffer]);
    for (const admin of adminSockets) {
        try { admin.write(frame); } catch (e) {}
    }
}

server.listen(HTTP_PORT, () => {
    console.log(`\n==================================================`);
    console.log(` 🚀 WebUSB Remote Bridge Server is LIVE!`);
    console.log(` 🌐 Client Portal:    http://localhost:${HTTP_PORT}`);
    console.log(` 💻 Admin Terminal:   http://localhost:${HTTP_PORT}/admin`);
    console.log(`==================================================\n`);
});
