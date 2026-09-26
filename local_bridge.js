/**
 * Local PC Bridge Agent
 * Connects to your Render Server (wss://usb-jd78.onrender.com)
 * Pipes incoming remote phone packets directly into a local Windows COM Port / TCP Bridge for UnlockTool.
 */

const WebSocket = require('ws');
const net = require('net');

const RENDER_SERVER_URL = process.env.SERVER_URL || 'wss://usb-jd78.onrender.com';
const ADMIN_KEY = '23UEIT0051@Shiva';
const LOCAL_TCP_PORT = 9008; // Local TCP socket for virtual COM bridge (e.g. hub4com or com0com)

console.log(`\n======================================================`);
console.log(` 🚀 Local PC Device Bridge Initializing...`);
console.log(` 🌐 Connecting to Remote Relay: ${RENDER_SERVER_URL}`);
console.log(`======================================================\n`);

let ws = null;
let tcpServer = null;
let activeTcpSocket = null;

// 1. Start local TCP server for virtual COM port redirection
tcpServer = net.createServer((socket) => {
    console.log(`[+] UnlockTool / Virtual COM connected on localhost:${LOCAL_TCP_PORT}`);
    activeTcpSocket = socket;

    socket.on('data', (data) => {
        // Outgoing command from UnlockTool -> Send to Remote Phone via Render
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(data);
            console.log(`[TX -> PHONE] Sent ${data.length} bytes from UnlockTool`);
        }
    });

    socket.on('close', () => {
        console.log(`[-] Local Tool disconnected from bridge.`);
        activeTcpSocket = null;
    });

    socket.on('error', (err) => {
        console.error(`[TCP ERR] ${err.message}`);
    });
});

tcpServer.listen(LOCAL_TCP_PORT, '127.0.0.1', () => {
    console.log(`[VIRTUAL PORT] Listening for UnlockTool on 127.0.0.1:${LOCAL_TCP_PORT}`);
});

// 2. Connect to Render Cloud WebSocket
function connectToRender() {
    console.log(`[WS] Connecting to ${RENDER_SERVER_URL}...`);
    ws = new WebSocket(RENDER_SERVER_URL);
    ws.binaryType = 'arraybuffer';

    ws.on('open', () => {
        console.log(`[+] Connected to Render Relay Server!`);
        // Authenticate as Admin Bridge
        ws.send(JSON.stringify({
            type: 'ADMIN_INIT',
            token: ADMIN_KEY,
            role: 'LOCAL_PC_BRIDGE'
        }));
    });

    ws.on('message', (data) => {
        if (typeof data === 'string') {
            try {
                const msg = JSON.parse(data);
                if (msg.type === 'DEVICE_PAIRED') {
                    console.log(`\n📱 >>> [REMOTE PHONE READY] <<<`);
                    console.log(` Device: ${msg.productName}`);
                    console.log(` VID: 0x${msg.vid} | PID: 0x${msg.pid}`);
                    console.log(` Session: ${msg.sessionId}`);
                    console.log(` Status: Streaming Active -> Ready in UnlockTool!\n`);
                } else if (msg.type === 'CLIENT_CONNECTED') {
                    console.log(`[+] New Remote Customer Connected: ${msg.ip}`);
                }
            } catch (e) {}
        } else if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
            // Incoming packet from Remote Phone -> Pipe to UnlockTool
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
            if (activeTcpSocket && !activeTcpSocket.destroyed) {
                activeTcpSocket.write(buf);
            }
            console.log(`[RX <- PHONE] Received ${buf.length} bytes from remote device`);
        }
    });

    ws.on('close', () => {
        console.log(`[-] Disconnected from Render. Reconnecting in 3s...`);
        setTimeout(connectToRender, 3000);
    });

    ws.on('error', (err) => {
        console.error(`[WS ERR] ${err.message}`);
    });
}

connectToRender();
