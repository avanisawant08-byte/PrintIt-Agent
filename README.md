# PrintIt — Remote Print Agent

The PrintIt Remote Print Agent is a background Windows desktop application built with Electron, TypeScript, and Supabase. It receives print jobs in real-time from PrintIt's cloud platform and executes silent prints directly to physical shop printers without requiring staff intervention.

---

## 🚀 Key Features

- **Silent Windows Printing**: Wraps `pdf-to-printer` and SumatraPDF to print PDF jobs silently without print dialogs or popups.
- **Supabase Realtime**: Subscribes directly to PostgreSQL change events on the `print_jobs` table (`shop_id=eq.{shopId}` & `status=eq.PENDING`), eliminating extraneous message brokers.
- **Dynamic Tray "Select Printer"**: Windows system tray menu automatically enumerates all installed OS printers (`pdf-to-printer.getPrinters()`), enabling one-click printer switching.
- **Zero Duplicate Prints (Local SQLite)**: Idempotency database (`sql.js` SQLite WebAssembly persisted to disk) records all processed `(job_id, checksum, printed_at, status)` tuples. Repetitions across network drops or reconnects are safely suppressed.
- **SHA-256 Checksum Verification**: Every PDF is hashed on-the-fly during download and verified against the backend's expected checksum before spooling to the printer.
- **6-Character Pairing Code Flow**: Clean modern pairing modal allows store staff to link the station in seconds using a one-time 6-character alphanumeric code from their dashboard.
- **Direct Supabase Heartbeat**: Periodically updates `agent_devices.last_seen_at`, `status` (`ONLINE`, `PRINTING`, `OFFLINE`), and `selected_printer` every 30 seconds.
- **Auto-Start on Boot**: Minimizes to the Windows system tray and automatically launches when the operator logs in (`app.setLoginItemSettings`).

---

## 🏗️ Architecture

```
Cloud Backend (Express / PostgreSQL / Supabase)
  │
  ├─► Insert print_jobs row (status: PENDING)
  │
  └─► Supabase Realtime (Postgres Changes Event)
            │
            ▼
Shop Desktop Agent (Windows Electron Shell)
  │
  ├─► 1. Check Local SQLite (dedup.db) ──[Already Printed?]──► Skip & Ack
  │
  ├─► 2. Download PDF stream & calculate SHA-256
  │
  ├─► 3. Send silent print to selected Windows printer (SumatraPDF)
  │
  ├─► 4. Record job completion in local SQLite
  │
  └─► 5. Update Supabase job status -> COMPLETED
```

---

## 📋 Database Setup (Supabase)

Run the SQL migration script located in [`sql/setup.sql`](sql/setup.sql) in your Supabase SQL Editor:

1. Creates `print_jobs` and `agent_devices` tables.
2. Adds `status` enums (`PENDING`, `PRINTING`, `COMPLETED`, `FAILED`).
3. Enables Supabase Realtime publication on `print_jobs`.
4. Creates helper function `generate_pairing_code(shop_id, device_name)` for generating 6-character codes.

---

## ⚙️ Environment Configuration

Copy `.env.example` to `.env` and fill in your Supabase credentials:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
BACKEND_API_URL=https://api.printit.com
AGENT_VERSION=1.0.0
HEARTBEAT_INTERVAL_SEC=30
```

---

## 💻 Development & Testing

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Automated Tests
```bash
npm test
```
Runs unit tests validating:
- Local SQLite deduplication engine.
- Configuration persistence and defaults.
- SHA-256 hash calculation and integrity validation.

### 3. Run Agent in Development
```bash
npm start
```
The agent compiles TypeScript, loads in the system tray, and presents the Pairing Window if unconfigured.

---

## 📦 Building the Windows Installer

Package into a standalone Windows installer (NSIS) and portable executable:

```bash
npm run dist
```

Output installers are generated in the `release/` directory:
- `PrintIt Agent Setup 1.0.0.exe` (NSIS Auto-installer)
- `PrintIt Agent 1.0.0.exe` (Portable executable)
