# PrintIt Agent — Production Configuration Guide

This guide details the configuration architecture, environment variables, credentials management, printer routing, and fallback mechanisms for the **PrintIt Agent** in production.

---

## 1. Configuration Storage Locations

The PrintIt Agent discovers and loads its configuration in order of precedence:

1. **Production AppData Directory (Primary):**  
   `%LOCALAPPDATA%\PrintItAgent\config.json`  
   *(e.g., `C:\Users\<Username>\AppData\Local\PrintItAgent\config.json`)*
2. **Local Fallback (Development/Portable):**  
   `%USERPROFILE%\.printit\config.json` or `<AppRoot>\.agent-data\config.json`

---

## 2. Configuration Schema (`config.json`)

```json
{
  "shopId": "00000000-0000-0000-0000-000000000000",
  "agentToken": "secure-shop-agent-token",
  "supabaseUrl": "https://<your-project-ref>.supabase.co",
  "supabaseKey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "backendUrl": "https://api.printit.com",
  "selectedPrinter": "HP LaserJet Pro MFP M428fdw",
  "selectedPrinterBw": "HP LaserJet Pro MFP M428fdw",
  "selectedPrinterColor": "Canon PIXMA G6020",
  "autoPrint": true,
  "autoStartOnBoot": true,
  "pollIntervalMs": 10000,
  "pairingCode": "123456"
}
```

### Field Descriptions

| Field | Type | Required | Description |
|---|---|---|---|
| `shopId` | UUID string | Yes | The unique identifier of the partner print shop. |
| `agentToken` | string | Yes | Authentication bearer token used by the agent to authorize with the PrintIt backend. |
| `supabaseUrl` | string | Yes | HTTPS endpoint of the Supabase Realtime instance. |
| `supabaseKey` | string | Yes | Supabase anonymous / public API key. |
| `backendUrl` | string | Yes | Production backend URL for token refresh and health telemetry. |
| `selectedPrinter` | string | Optional | Default fallback printer name. |
| `selectedPrinterBw` | string | Optional | Dedicated printer for Black & White jobs. |
| `selectedPrinterColor` | string | Optional | Dedicated printer for Color jobs. |
| `autoPrint` | boolean | Yes | When `true`, queued jobs print silently without prompt. |
| `autoStartOnBoot` | boolean | Optional | Automatically launch when Windows user logs in (default: `true`). |
| `pollIntervalMs` | number | Optional | Fallback HTTP polling interval in milliseconds (default: `10000`). |
| `pairingCode` | string | Optional | Temporary 6-digit code used during initial device pairing. |

---

## 3. Printer Routing Architecture

The agent resolves the target printer using the following deterministic hierarchy:

1. **Per-Print Choice by Shopkeeper (Highest Priority):**
   - When the shopkeeper accepts and reviews an order in the **PrintIt Shop Portal** (`PrintReviewModal`), they choose the target printer for that individual print.
   - The job is dispatched with `print_options.printer_name` set to that specific printer.
   - The Agent directly honors `print_options.printer_name`, spooling the document to the printer selected by the shopkeeper for that print.

2. **Optional Color / B&W Auto-Routing (Fallback):**
   - If a job does not specify an explicit `printer_name`:
     - **Color Jobs (`options.color === 'color'`):** Routes to `config.selectedPrinterColor` (if configured), then `config.selectedPrinter`, then Windows default.
     - **B&W Jobs (`options.color === 'bw'`):** Routes to `config.selectedPrinterBw` (if configured), then `config.selectedPrinter`, then Windows default.

3. **Hardware Availability Validation:**
   - Before submitting to the Windows spooler, the agent checks if the target printer is actively detected by the operating system.
   - If the chosen printer is offline or disconnected, the agent falls back to the default printer and logs a warning with the structured logger.

---

## 4. Pairing & Credential Security

- **Initial Pairing:**
  - On first boot, if no `shopId` or `agentToken` is present, the agent launches the **Pairing Window**.
  - The shopkeeper generates a 6-digit pairing code from the PrintIt Partner Web Dashboard.
  - The shopkeeper enters the pairing code into the Agent UI.
  - The agent contacts `POST /api/agent/pair` with the code and retrieves the shop credentials.
- **Credential Storage:**
  - In production, sensitive values (`agentToken`, `supabaseKey`) can be encrypted using Electron's `safeStorage` API backed by Windows DPAPI (Data Protection API).
- **Session Reset / Unpairing:**
  - Right-clicking the system tray icon and selecting **"Unpair Agent"** triggers `clearPairing()`, safely deleting credentials and re-prompting the pairing screen.

---

## 5. Network & Firewall Requirements

The shop PC must have outbound access over port 443 (HTTPS and WSS):

| Domain / Endpoint | Protocol | Port | Purpose |
|---|---|---|---|
| `https://*.supabase.co` | HTTPS / WSS | 443 | Realtime WebSocket job broadcasts & fallback REST polling |
| `https://api.printit.com` | HTTPS | 443 | Agent pairing, token refresh, and print telemetry |
| `https://*.supabase.co/storage/v1/*` | HTTPS | 443 | Secure document streaming and download |

*Note: The PrintIt Agent does NOT require any inbound open ports or router port forwarding.*

---

## 6. Windows Boot Lifecycle & Privilege Model

### 6.1 Boot Lifecycle Sequence
Upon automatic launch on Windows user login, the PrintIt Agent executes an automated sequential boot flow:
1. **Authentication:** Validates stored station credentials (`shopId`, `deviceId`, `authToken`).
2. **Printer Hardware Verification:** Queries the Windows print spooler subsystem (`winspool`) to discover and verify physical and virtual printers.
3. **Backend Connection:** Connects to Supabase Realtime via WSS WebSocket and starts adaptive fallback polling sweeps.
4. **READY State Transition:** Transitions agent device status to `READY` and emits initial heartbeat telemetry.
5. **Zero-Reprint Deduplication Guarantee:** Catch-up queries for `PENDING` jobs validate every candidate against local SQLite (`dedupDb`). Any job previously recorded with status `COMPLETED` is safely suppressed and never spooled to the printer.

### 6.2 Least-Privilege Windows Execution
- **Standard User Execution (`asInvoker`):** The agent binary declares `requestedExecutionLevel: "asInvoker"`, explicitly telling Windows UAC that no administrative elevation is required.
- **Single-User Installation:** NSIS package is configured with `perMachine: false` and `allowElevation: false`, installing into the current user's profile directory.
- **No Inbound Ports or Driver Modding:** Standard Windows spooler APIs (`winspool.drv` via `pdf-to-printer`) handle all print spooling within user privileges.
