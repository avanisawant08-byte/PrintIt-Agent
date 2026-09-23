# PrintIt Agent — Windows Installation & Operations Guide

This document describes how to deploy, configure, run, and uninstall the **PrintIt Agent** on a clean Windows PC.

---

## 1. System Requirements

- **Operating System:** Windows 10 (64-bit) or Windows 11 (64-bit)
- **Architecture:** x64
- **Memory (RAM):** 4 GB minimum (8 GB recommended)
- **Disk Space:** ~200 MB free disk space for application and secure spool buffer
- **Network:** Stable broadband Internet connection with outbound HTTPS/WSS (Port 443)
- **Printers:** Any Windows-compatible printer with manufacturer drivers installed

---

## 2. Clean Machine Installation

### Option A: Standard Windows Installer (Recommended)

1. Obtain the official signed installer: `PrintIt Agent Setup 1.0.0.exe`.
2. Double-click the installer to launch the NSIS setup wizard.
3. Choose the destination directory (Default: `C:\Users\<Username>\AppData\Local\Programs\PrintIt Agent`).
4. Click **Install**.
5. Once completed, leave **"Run PrintIt Agent"** checked and click **Finish**.
6. The PrintIt Agent icon will appear in the Windows System Notification Tray (near the clock).

### Option B: Portable Executable

1. Download `PrintIt Agent 1.0.0.exe` (Portable).
2. Place the executable in a dedicated folder (e.g., `C:\PrintItAgent\`).
3. Double-click to run. All local state will be maintained under `%LOCALAPPDATA%\PrintItAgent`.

---

## 3. Initial Setup & Pairing Workflow

1. Upon first launch, the **Device Pairing** window will open automatically.
2. In your web browser, log in to your **PrintIt Partner Portal**.
3. Navigate to **Settings > Agent Devices** and click **"Generate Pairing Code"** (a 6-digit numeric code).
4. Enter the 6-digit code into the PrintIt Agent window and click **"Connect Agent"**.
5. Upon successful pairing:
   - The agent securely saves authentication tokens.
   - The device status switches to **Online** (Green indicator).
   - The Pairing window closes and the agent minimizes to the system tray.

---

## 4. Printer Selection (Per-Print Choice by Shopkeeper)

1. **Per-Print Choice in Shop Portal (Recommended Workflow):**
   - For each incoming order, the shopkeeper reviews the document and options in the **PrintIt Shop Portal** (`Print Review Modal`).
   - The shopkeeper directly selects the destination printer for that specific print (e.g. choosing between available inkjet, laser, or photo printers on the fly).
   - When approved, the PrintIt Agent receives the job with the chosen `printer_name` and sends it directly to that printer.
2. **Default Fallback Printer in Agent:**
   - In the PrintIt Agent Control Center / Tray menu, select your primary **Default Printer**.
   - This printer serves as a fallback if an order is dispatched without an explicit printer selection.
   - Dedicated B&W vs Color printer assignments are **completely optional**; the shopkeeper has full control to choose the printer for each print.

---

## 5. Startup, Boot Lifecycle & Security Context

### 5.1 Automatic Startup (Enabled by Default, Configurable)
- **Automatic User Login Launch:** The PrintIt Agent automatically launches when the configured Windows user logs in.
- **Default Behavior:** Automatic startup is enabled by default (`autoStartOnBoot: true`) upon initial setup and pairing.
- **Shopkeeper Configurable:** The shopkeeper can toggle automatic startup at any time:
  - **System Tray:** Right-click the PrintIt Agent tray icon and check/uncheck **"Start with Windows"**.
  - **Control Center Dashboard:** Toggle the **"Windows Auto-Launch"** switch in the Control Center window.
  - **Configuration File:** Set `"autoStartOnBoot": false` in `%LOCALAPPDATA%\PrintItAgent\agent-config.json`.
- **User-Level Registry:** Auto-launch registers under the current user's registry hive (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`), requiring zero administrator privileges or UAC elevation.

### 5.2 Boot Lifecycle & READY State
Upon launching with Windows, the agent executes an automated startup sequence:
1. **Authentication:** Loads stored credentials (`shopId`, `deviceId`, `authToken`) and validates pairing authorization.
2. **Printer Availability Verification:** Queries the Windows print subsystem (`winspool`) to verify connected hardware and update available printer devices.
3. **Backend Connection:** Connects to the PrintIt cloud via encrypted Supabase Realtime WebSockets (WSS) and activates adaptive fallback polling.
4. **READY State Transition:** Enters the `READY` state, sending an active heartbeat to the PrintIt backend and switching the tray indicator to green.
5. **No Duplicate Reprinting:** Any pending jobs retrieved during startup catch-up are validated against the local embedded SQLite deduplication database (`dedupDb`). Jobs already marked `COMPLETED` are automatically skipped, guaranteeing previously processed jobs are never re-printed.

### 5.3 Minimum Windows Privileges (Least Privilege)
- The PrintIt Agent operates with the **minimum Windows user privileges required**.
- **No Administrator Rights Required:** The agent runs entirely in standard user space without requiring UAC elevation or administrative privileges during normal operation or installation (`perMachine: false`).
- **User Directory Isolation:** All configurations, SQLite state databases, and temporary print caches reside strictly in the current user's profile directory (`%LOCALAPPDATA%\PrintItAgent`).

---

## 6. Uninstallation & Data Cleanup

To completely remove the agent and purge all cached credentials:

1. Right-click the agent tray icon and click **"Unpair Agent"** (or exit the agent).
2. Open Windows **Settings > Apps > Installed Apps**.
3. Locate **PrintIt Agent** and click **Uninstall**.
4. To remove lingering logs and configuration data:
   - Delete `%LOCALAPPDATA%\PrintItAgent`
   - Delete `%USERPROFILE%\.printit` (if present)
