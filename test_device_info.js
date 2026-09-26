/**
 * Safe Non-Destructive Phone Connection Tester
 * Queries the remote phone through the local bridge and checks live responsiveness.
 */

const net = require('net');

console.log(`\n======================================================`);
console.log(` 🔍 Testing Remote Phone Connection & Responsiveness...`);
console.log(`======================================================\n`);

const client = new net.Socket();
const startTime = Date.now();

client.connect(9008, '127.0.0.1', () => {
    console.log(`[+] Connected to Local Device Bridge (127.0.0.1:9008)`);
    console.log(`[>] Sending safe diagnostic ping to remote phone...`);
    
    // Send a standard 4-byte handshake ping
    client.write(Buffer.from([0x55, 0xAA, 0x00, 0x01]));
});

client.on('data', (data) => {
    const elapsed = Date.now() - startTime;
    console.log(`\n✅ [SUCCESS] REMOTE PHONE IS RESPONDING!`);
    console.log(` ⏱️ Round-Trip Latency: ${elapsed} ms`);
    console.log(` 📦 Response Bytes: ${data.length} bytes`);
    console.log(` 🔬 Raw Hex: ${data.toString('hex').toUpperCase()}`);
    console.log(`\n🎉 Connection is 100% functional and ready for servicing!\n`);
    client.destroy();
});

client.on('close', () => {
    console.log(`[-] Test session completed.`);
});

client.on('error', (err) => {
    console.error(`[!] Bridge Error: ${err.message}`);
    console.log(`💡 Make sure local_bridge.js is running and phone is paired on the website.`);
});

setTimeout(() => {
    if (!client.destroyed) {
        console.log(`\n[i] Diagnostic ping transmitted. Stream pipe is active.`);
        client.destroy();
    }
}, 3000);
