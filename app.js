/**
 * Universal WebUSB & WebSerial Remote Device Bridge
 * Bridges local USB / COM endpoints to a centralized backend server via WebSockets.
 */

// Known Vendor & Chipset Filters
const VENDOR_FILTERS = {
    qualcomm: [{ vendorId: 0x05c6 }],                  // Qualcomm HS-USB QDLoader 9008
    mediatek: [{ vendorId: 0x0e8d }],                  // MediaTek Preloader / BROM
    fastboot: [{ vendorId: 0x18d1 }, { vendorId: 0x2717 }, { vendorId: 0x2a70 }], // Google, Xiaomi, OnePlus Fastboot
    samsung:  [{ vendorId: 0x04e8 }],                  // Samsung Mobile USB
    unisoc:   [{ vendorId: 0x1782 }, { vendorId: 0x05c6 }], // Spreadtrum / Unisoc Diag
    all: [
        { vendorId: 0x05c6 }, // Qualcomm / Unisoc
        { vendorId: 0x0e8d }, // MediaTek
        { vendorId: 0x18d1 }, // Google Fastboot
        { vendorId: 0x04e8 }, // Samsung
        { vendorId: 0x1782 }, // Spreadtrum
        { vendorId: 0x12d1 }, // Huawei
        { vendorId: 0x05ac }  // Apple DFU
    ]
};

class RemoteUsbBridge {
    constructor() {
        this.device = null;
        this.serialPort = null;
        this.ws = null;
        this.interfaceNumber = 0;
        this.endpointIn = null;
        this.endpointOut = null;
        this.isStreaming = false;

        // Counters
        this.txBytes = 0;
        this.rxBytes = 0;
        this.pktCount = 0;

        // DOM elements
        this.dom = {
            webusbStatus: document.getElementById('webusb-status'),
            serverStatus: document.getElementById('server-status'),
            serverUrl: document.getElementById('serverUrl'),
            sessionId: document.getElementById('sessionId'),
            btnConnectServer: document.getElementById('btnConnectServer'),
            btnDisconnectServer: document.getElementById('btnDisconnectServer'),
            chipsetFilter: document.getElementById('chipsetFilter'),
            btnPairDevice: document.getElementById('btnPairDevice'),
            btnReleaseDevice: document.getElementById('btnReleaseDevice'),
            devName: document.getElementById('devName'),
            devVidPid: document.getElementById('devVidPid'),
            devEndpoints: document.getElementById('devEndpoints'),
            devTransferMode: document.getElementById('devTransferMode'),
            consoleOutput: document.getElementById('consoleOutput'),
            btnClearLogs: document.getElementById('btnClearLogs'),
            txBytes: document.getElementById('txBytes'),
            rxBytes: document.getElementById('rxBytes'),
            pktCount: document.getElementById('pktCount')
        };

        this.initUI();
        this.checkBrowserSupport();
    }

    log(message, type = 'info') {
        const time = new Date().toLocaleTimeString();
        const line = document.createElement('div');
        line.className = `log-line ${type}`;
        line.textContent = `[${time}] ${message}`;
        this.dom.consoleOutput.appendChild(line);
        this.dom.consoleOutput.scrollTop = this.dom.consoleOutput.scrollHeight;
    }

    initUI() {
        if (window.location.host) {
            const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            this.dom.serverUrl.value = `${wsProto}//${window.location.host}`;
        }

        this.dom.btnConnectServer.addEventListener('click', () => this.connectRelayServer());
        this.dom.btnDisconnectServer.addEventListener('click', () => this.disconnectRelayServer());
        this.dom.btnPairDevice.addEventListener('click', () => this.pairDevice());
        this.dom.btnReleaseDevice.addEventListener('click', () => this.releaseDevice());
        this.dom.btnClearLogs.addEventListener('click', () => {
            this.dom.consoleOutput.innerHTML = '';
            this.log('Console cleared.', 'system');
        });

        // Automatically connect to the relay server on page load
        setTimeout(() => this.connectRelayServer(), 300);
    }

    checkBrowserSupport() {
        if ('usb' in navigator) {
            this.dom.webusbStatus.className = 'status-pill active';
            this.dom.webusbStatus.querySelector('.label').textContent = 'WebUSB: Supported';
            this.log('WebUSB API detected and available.', 'success');
        } else {
            this.dom.webusbStatus.className = 'status-pill error';
            this.dom.webusbStatus.querySelector('.label').textContent = 'WebUSB: Unsupported';
            this.log('WebUSB is not supported in this browser. Please use Chrome, Edge, or Brave.', 'error');
        }
    }

    // ==========================================
    // Relay Server (WebSocket) Communication
    // ==========================================
    connectRelayServer() {
        const url = this.dom.serverUrl.value.trim();
        const session = this.dom.sessionId.value.trim();

        if (!url) {
            this.log('Invalid WebSocket server URL.', 'error');
            return;
        }

        this.log(`Connecting to Relay Server: ${url}...`, 'system');
        try {
            this.ws = new WebSocket(url);
            this.ws.binaryType = 'arraybuffer';

            this.ws.onopen = () => {
                this.dom.serverStatus.className = 'status-pill active';
                this.dom.serverStatus.querySelector('.label').textContent = 'Relay: Connected';
                this.dom.btnConnectServer.disabled = true;
                this.dom.btnDisconnectServer.disabled = false;

                // Send session authentication packet
                const handshake = JSON.stringify({ type: 'HANDSHAKE', sessionId: session, client: 'WebUSB-Portal-v1.0' });
                this.ws.send(handshake);
                this.log(`Relay connection established. Session: ${session}`, 'success');
            };

            this.ws.onmessage = async (event) => {
                if (typeof event.data === 'string') {
                    const msg = JSON.parse(event.data);
                    this.log(`[SERVER CTRL] ${msg.type}: ${msg.message || ''}`, 'system');
                } else if (event.data instanceof ArrayBuffer) {
                    // Outbound payload received from server to be sent to device
                    await this.sendToDevice(new Uint8Array(event.data));
                }
            };

            this.ws.onerror = (err) => {
                this.log(`WebSocket Error: ${err.message || 'Connection failed'}`, 'error');
            };

            this.ws.onclose = () => {
                this.dom.serverStatus.className = 'status-pill error';
                this.dom.serverStatus.querySelector('.label').textContent = 'Relay: Disconnected';
                this.dom.btnConnectServer.disabled = false;
                this.dom.btnDisconnectServer.disabled = true;
                this.log('Relay server connection closed.', 'warning');
            };
        } catch (e) {
            this.log(`Failed to initiate WebSocket: ${e.message}`, 'error');
        }
    }

    disconnectRelayServer() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    // ==========================================
    // Hardware USB Pairing & Streaming
    // ==========================================
    async pairDevice() {
        const filterKey = this.dom.chipsetFilter.value;

        if (filterKey === 'serial') {
            await this.pairSerialDevice();
            return;
        }

        if (!('usb' in navigator)) {
            this.log('WebUSB is not supported. Use Google Chrome or Microsoft Edge.', 'error');
            return;
        }

        const filters = VENDOR_FILTERS[filterKey] || VENDOR_FILTERS.all;

        try {
            this.log('Requesting USB device selection from user...', 'system');
            this.device = await navigator.usb.requestDevice({ filters: filters });

            this.log(`Device chosen: ${this.device.productName || 'USB Device'} (VID: 0x${this.device.vendorId.toString(16).padStart(4, '0')}, PID: 0x${this.device.productId.toString(16).padStart(4, '0')})`, 'success');

            await this.device.open();
            if (this.device.configuration === null) {
                await this.device.selectConfiguration(1);
            }

            // Find bulk IN and OUT endpoints
            let foundInterface = false;
            for (const iface of this.device.configuration.interfaces) {
                for (const alt of iface.alternates) {
                    let inEp = null;
                    let outEp = null;

                    for (const ep of alt.endpoints) {
                        if (ep.type === 'bulk') {
                            if (ep.direction === 'in') inEp = ep;
                            if (ep.direction === 'out') outEp = ep;
                        }
                    }

                    if (inEp && outEp) {
                        this.interfaceNumber = iface.interfaceNumber;
                        this.endpointIn = inEp.endpointNumber;
                        this.endpointOut = outEp.endpointNumber;
                        foundInterface = true;
                        break;
                    }
                }
                if (foundInterface) break;
            }

            await this.device.claimInterface(this.interfaceNumber);
            this.log(`Claimed Interface #${this.interfaceNumber} (Bulk IN: EP${this.endpointIn}, Bulk OUT: EP${this.endpointOut})`, 'success');

            // Update UI card
            this.dom.devName.textContent = this.device.productName || 'Generic Mobile Device';
            this.dom.devVidPid.textContent = `0x${this.device.vendorId.toString(16).toUpperCase()} : 0x${this.device.productId.toString(16).toUpperCase()}`;
            this.dom.devEndpoints.textContent = `IN: EP${this.endpointIn} / OUT: EP${this.endpointOut}`;
            this.dom.devTransferMode.textContent = 'Active (WebUSB Bulk Streaming)';

            this.dom.btnPairDevice.disabled = true;
            this.dom.btnReleaseDevice.disabled = false;

            // Start continuous packet reader loop
            this.startReadLoop();

        } catch (err) {
            this.log(`USB Connection Failed: ${err.message}`, 'error');
        }
    }

    async startReadLoop() {
        this.isStreaming = true;
        this.log('Streaming pipeline active. Forwarding USB IN packets to server...', 'system');

        while (this.isStreaming && this.device && this.device.opened) {
            try {
                const result = await this.device.transferIn(this.endpointIn, 4096);
                if (result.data && result.data.byteLength > 0) {
                    const dataArray = new Uint8Array(result.data.buffer);
                    this.rxBytes += dataArray.length;
                    this.pktCount++;
                    this.updateCounters();

                    // Forward packet to WebSocket backend
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send(dataArray);
                    }

                    if (dataArray.length <= 64) {
                        this.log(`[USB RX ${dataArray.length}B] ${this.bytesToHex(dataArray)}`, 'data-rx');
                    }
                }
            } catch (err) {
                if (this.isStreaming) {
                    this.log(`USB Stream Read Error: ${err.message}`, 'error');
                }
                break;
            }
        }
    }

    async sendToDevice(data) {
        if (!this.device || !this.device.opened) {
            this.log('Cannot send data: USB device not open.', 'error');
            return;
        }

        try {
            await this.device.transferOut(this.endpointOut, data);
            this.txBytes += data.length;
            this.pktCount++;
            this.updateCounters();

            if (data.length <= 64) {
                this.log(`[USB TX ${data.length}B] ${this.bytesToHex(data)}`, 'data-tx');
            }
        } catch (err) {
            this.log(`USB TransferOut Error: ${err.message}`, 'error');
        }
    }

    async releaseDevice() {
        this.isStreaming = false;
        if (this.device) {
            try {
                await this.device.releaseInterface(this.interfaceNumber);
                await this.device.close();
                this.log('USB Device released.', 'warning');
            } catch (e) {
                this.log(`Error releasing USB: ${e.message}`, 'error');
            }
        }

        this.device = null;
        this.dom.devName.textContent = 'No device paired';
        this.dom.devVidPid.textContent = '-- : --';
        this.dom.devEndpoints.textContent = 'None';
        this.dom.devTransferMode.textContent = 'Idle';
        this.dom.btnPairDevice.disabled = false;
        this.dom.btnReleaseDevice.disabled = true;
    }

    // ==========================================
    // WebSerial Fallback (COM Port Mode)
    // ==========================================
    async pairSerialDevice() {
        if (!('serial' in navigator)) {
            this.log('Web Serial is not supported in this browser.', 'error');
            return;
        }

        try {
            this.serialPort = await navigator.serial.requestPort();
            await this.serialPort.open({ baudRate: 115200 });
            this.log('Web Serial Port opened at 115200 baud.', 'success');

            this.dom.devName.textContent = 'Serial COM Device';
            this.dom.devVidPid.textContent = 'COM Port (Serial)';
            this.dom.devEndpoints.textContent = 'TX / RX Stream';
            this.dom.devTransferMode.textContent = 'Active (WebSerial Stream)';
            this.dom.btnPairDevice.disabled = true;
            this.dom.btnReleaseDevice.disabled = false;

            // Pipe serial stream
            const reader = this.serialPort.readable.getReader();
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) {
                    this.rxBytes += value.length;
                    this.updateCounters();
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send(value);
                    }
                }
            }
        } catch (err) {
            this.log(`Web Serial Error: ${err.message}`, 'error');
        }
    }

    updateCounters() {
        this.dom.txBytes.textContent = this.formatBytes(this.txBytes);
        this.dom.rxBytes.textContent = this.formatBytes(this.rxBytes);
        this.dom.pktCount.textContent = this.pktCount.toString();
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    bytesToHex(bytes) {
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    }
}

// Instantiate on page load
window.addEventListener('DOMContentLoaded', () => {
    window.bridge = new RemoteUsbBridge();
});
