/**
 * Minimalist Universal WebUSB Device Bridge
 * One-click circular pairing and automatic WebSocket streaming.
 */

const VENDOR_FILTERS = [
    { vendorId: 0x05c6 }, // Qualcomm (EDL 9008 / Diag)
    { vendorId: 0x0e8d }, // MediaTek (BROM / Preloader)
    { vendorId: 0x18d1 }, // Google Fastboot
    { vendorId: 0x2717 }, // Xiaomi Fastboot
    { vendorId: 0x2a70 }, // OnePlus Fastboot
    { vendorId: 0x04e8 }, // Samsung Mobile USB
    { vendorId: 0x1782 }, // Spreadtrum / Unisoc
    { vendorId: 0x12d1 }, // Huawei USB COM
    { vendorId: 0x05ac }  // Apple DFU
];

class MinimalDeviceBridge {
    constructor() {
        this.device = null;
        this.ws = null;
        this.interfaceNumber = 0;
        this.endpointIn = null;
        this.endpointOut = null;
        this.isStreaming = false;

        // DOM elements
        this.dom = {
            serverIndicator: document.getElementById('serverIndicator'),
            serverIndicatorText: document.getElementById('serverIndicatorText'),
            btnConnect: document.getElementById('btnCircleConnect'),
            pulseRing: document.getElementById('pulseRing'),
            btnIcon: document.getElementById('btnIcon'),
            btnMainText: document.getElementById('btnMainText'),
            btnSubText: document.getElementById('btnSubText'),
            statusHeading: document.getElementById('statusHeading'),
            statusDesc: document.getElementById('statusDesc'),
            deviceBadge: document.getElementById('deviceBadge'),
            badgeDevName: document.getElementById('badgeDevName'),
            badgeDevSub: document.getElementById('badgeDevSub'),
            serverUrl: document.getElementById('serverUrl'),
            sessionId: document.getElementById('sessionId')
        };

        this.init();
    }

    init() {
        // Auto-detect server WebSocket address
        if (window.location.host) {
            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            this.serverUrl = `${proto}//${window.location.host}`;
        } else {
            this.serverUrl = 'ws://localhost:3000';
        }

        // Auto-connect to relay server
        this.connectServer();

        // Bind single button click
        this.dom.btnConnect.addEventListener('click', () => {
            if (this.device && this.device.opened) {
                this.disconnectDevice();
            } else {
                this.pairDevice();
            }
        });
    }

    connectServer() {
        try {
            this.ws = new WebSocket(this.serverUrl);
            this.ws.binaryType = 'arraybuffer';

            this.ws.onopen = () => {
                this.dom.serverIndicator.className = 'server-indicator online';
                this.dom.serverIndicatorText.textContent = 'Server Online';
                
                // Handshake
                const hs = JSON.stringify({ type: 'HANDSHAKE', sessionId: 'REMOTE-CLIENT-01' });
                this.ws.send(hs);
            };

            this.ws.onmessage = async (event) => {
                if (event.data instanceof ArrayBuffer) {
                    await this.writeToDevice(new Uint8Array(event.data));
                }
            };

            this.ws.onclose = () => {
                this.dom.serverIndicator.className = 'server-indicator';
                this.dom.serverIndicatorText.textContent = 'Server Reconnecting...';
                setTimeout(() => this.connectServer(), 3000);
            };

            this.ws.onerror = () => {
                this.dom.serverIndicator.className = 'server-indicator';
                this.dom.serverIndicatorText.textContent = 'Server Offline';
            };
        } catch (e) {
            console.error(e);
        }
    }

    async pairDevice() {
        if (!('usb' in navigator)) {
            this.dom.statusHeading.textContent = 'Browser Not Supported';
            this.dom.statusDesc.textContent = 'Please open this website in Google Chrome, Microsoft Edge, or Brave to connect USB devices.';
            return;
        }

        try {
            this.dom.statusHeading.textContent = 'Select Phone...';
            this.dom.statusDesc.textContent = 'Choose your connected phone from the browser popup.';

            // Open device picker with no restrictive vendor filter so all devices appear
            this.device = await navigator.usb.requestDevice({ filters: [] });

            await this.device.open();
            if (this.device.configuration === null) {
                await this.device.selectConfiguration(1);
            }

            // Intelligently find and claim available bulk interface (prioritizing ADB/Vendor interfaces)
            let claimed = false;
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
                        try {
                            await this.device.claimInterface(iface.interfaceNumber);
                            this.interfaceNumber = iface.interfaceNumber;
                            this.endpointIn = inEp.endpointNumber;
                            this.endpointOut = outEp.endpointNumber;
                            claimed = true;
                            break;
                        } catch (claimErr) {
                            // If this interface is locked (e.g. MTP), continue to next interface
                            console.warn(`Interface #${iface.interfaceNumber} locked, checking next...`);
                        }
                    }
                }
                if (claimed) break;
            }

            if (!claimed) {
                throw new Error("Unable to claim USB interface. Ensure USB Debugging is ON or phone is in Fastboot mode.");
            }

            // Update UI to Connected State
            this.dom.btnConnect.className = 'circle-btn connected';
            this.dom.pulseRing.className = 'pulse-ring active';
            this.dom.btnIcon.textContent = '⚡';
            this.dom.btnMainText.textContent = 'STREAMING';
            this.dom.btnSubText.textContent = 'Click to disconnect';

            this.dom.statusHeading.textContent = 'Phone Connected & Streaming';
            this.dom.statusDesc.textContent = 'Keep this tab open. The technician is now servicing your phone remotely.';

            // Show Device Badge
            const vidHex = this.device.vendorId.toString(16).padStart(4, '0').toUpperCase();
            const pidHex = this.device.productId.toString(16).padStart(4, '0').toUpperCase();
            this.dom.badgeDevName.textContent = this.device.productName || 'Mobile USB Device';
            this.dom.badgeDevSub.textContent = `VID: 0x${vidHex} | PID: 0x${pidHex}`;
            this.dom.deviceBadge.classList.remove('hidden');

            // Start bulk streaming
            this.startStreaming();

        } catch (err) {
            console.error(err);
            this.dom.statusHeading.textContent = 'Connection Cancelled';
            this.dom.statusDesc.textContent = err.message || 'No device was selected. Plug in your phone and try again.';
        }
    }

    async startStreaming() {
        this.isStreaming = true;
        while (this.isStreaming && this.device && this.device.opened) {
            try {
                const result = await this.device.transferIn(this.endpointIn, 4096);
                if (result.data && result.data.byteLength > 0) {
                    const bytes = new Uint8Array(result.data.buffer);
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send(bytes);
                    }
                }
            } catch (err) {
                if (this.isStreaming) {
                    this.disconnectDevice();
                }
                break;
            }
        }
    }

    async writeToDevice(bytes) {
        if (!this.device || !this.device.opened) return;
        try {
            await this.device.transferOut(this.endpointOut, bytes);
        } catch (err) {
            console.error('Write error:', err);
        }
    }

    async disconnectDevice() {
        this.isStreaming = false;
        if (this.device) {
            try {
                await this.device.releaseInterface(this.interfaceNumber);
                await this.device.close();
            } catch (e) {}
        }

        this.device = null;
        this.dom.btnConnect.className = 'circle-btn';
        this.dom.pulseRing.className = 'pulse-ring';
        this.dom.btnIcon.textContent = '🔌';
        this.dom.btnMainText.textContent = 'CONNECT';
        this.dom.btnSubText.textContent = 'Click to pair phone';

        this.dom.statusHeading.textContent = 'Ready to Connect';
        this.dom.statusDesc.textContent = 'Plug your phone in EDL, BROM, Fastboot or Download mode, then click the button above.';
        this.dom.deviceBadge.classList.add('hidden');
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new MinimalDeviceBridge();
});
