/**
 * Zero-Dependency Standalone Node.js Web & WebSocket Relay Server
 * Runs out of the box with pure native Node.js (No npm install required)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HTTP_PORT = process.env.PORT || 3000;

// 1. Static Web Server (serves index.html, styles.css, app.js)
const server = http.createServer((req, res) => {
    let reqUrl = req.url.split('?')[0];
    let filePath = path.join(__dirname, reqUrl === '/' ? 'index.html' : reqUrl);
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
        // Parse WebSocket Frame
        if (buffer.length < 2) return;
        const firstByte = buffer[0];
        const opcode = firstByte & 0x0f;

        // 8 = Close frame
        if (opcode === 8) {
            socket.end();
            clients.delete(socket);
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

        // Handle Text / JSON
        if (opcode === 1) {
            try {
                const text = payload.toString('utf8');
                console.log(`[CONTROL] ${text}`);
                // Send ACK response
                sendWsFrame(socket, JSON.stringify({ type: 'ACK', message: 'Ready for device streaming' }));
            } catch (e) {}
        } else if (opcode === 2) {
            // Binary USB payload
            console.log(`[USB DATA] Received ${payload.length} bytes from remote device`);
        }
    });

    socket.on('close', () => {
        clients.delete(socket);
        console.log('[-] Client disconnected');
    });

    socket.on('error', (err) => {
        console.error(`[SOCKET ERR] ${err.message}`);
        clients.delete(socket);
    });
});

function sendWsFrame(socket, text) {
    const payload = Buffer.from(text, 'utf8');
    const header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + Text frame
    header[1] = payload.length;
    socket.write(Buffer.concat([header, payload]));
}

server.listen(HTTP_PORT, () => {
    console.log(`\n==================================================`);
    console.log(` 🚀 WebUSB Remote Bridge Server is LIVE!`);
    console.log(` 🌐 Web Portal:    http://localhost:${HTTP_PORT}`);
    console.log(` 🔌 WebSocket:     ws://localhost:${HTTP_PORT}`);
    console.log(`==================================================\n`);
});
