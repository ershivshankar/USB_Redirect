# WebUSB Remote Device Portal & Bridge

A browser-based remote USB streaming bridge. Allows remote customers anywhere in the world to connect mobile devices (Qualcomm EDL 9008, MediaTek BROM/Preloader, Android Fastboot, Samsung, Unisoc) via standard web browsers (Chrome, Edge, Brave, Opera) without downloading any client executable application.

---

## 1. Architecture

```
[ Remote Customer Browser ]
     │ (WebUSB / WebSerial API)
     ├── Pairs Physical USB Device (VID:PID)
     ├── Reads Bulk IN / Writes Bulk OUT
     ▼ (Secure WebSocket Stream)
[ Central Relay Server (server.js) ]
     │
     ▼ (Virtual COM / Local Driver Bridge)
[ Your Centralized Servicing Engine ]
```

---

## 2. Directory Structure

- `index.html`: Responsive dark-mode customer portal with live connection controls, device hardware inspector, and real-time terminal logger.
- `styles.css`: Glassmorphic styling with status badges, custom input fields, and monospace terminal console.
- `app.js`: WebUSB engine with automatic endpoint negotiation, Bulk IN/OUT streaming pipeline, WebSerial fallback, and WebSocket telemetry.
- `server.js`: Node.js HTTP static server & WebSocket packet bridge.

---

## 3. How to Run Locally

1. Open terminal in `F:\PU\web_remote_bridge`:
   ```bash
   npm install
   node server.js
   ```
2. Open your browser at:
   ```
   http://localhost:3000
   ```
3. Connect the phone, select the chipset filter, and click **Pair & Connect Device**.
