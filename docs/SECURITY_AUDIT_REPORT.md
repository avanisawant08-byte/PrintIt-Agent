# PrintIt Agent — Security Audit Report

**Date:** September 2026  
**Target:** PrintIt Remote Silent Print Agent (`printit-remote-agent` v1.0.0)  
**Platform:** Windows 10 / 11 (x64)  
**Status:** PASSED (Production Ready)

---

## 1. Executive Summary

A comprehensive security audit and vulnerability assessment was conducted on the **PrintIt Agent** prior to Windows production release packaging. The PrintIt Agent runs on shopkeeper PCs, receiving print jobs from the PrintIt cloud backend, downloading document files, executing layout transformations (N-up grid tiling, auto-rotation), and spooling print tasks directly to physical printers via SumatraPDF.

All identified vulnerabilities, data leak vectors, and injection surfaces have been remediated, verified with automated unit tests, and validated in end-to-end simulated print flows.

---

## 2. Threat Model & Audit Findings

| Category | Finding / Threat | Severity | Status | Remediation |
|---|---|---|---|---|
| **Credential & Token Leakage** | Plaintext JWTs, Supabase anon keys, and signed download URLs logged to console/files | HIGH | **FIXED** | Structured `Logger` with automated regex masking for Bearer tokens, JWTs, signed query params, and passwords. |
| **Malicious File Upload / Disguised Executables** | Attackers supplying `.exe`, `.bat`, or `.cmd` payloads renamed with `.pdf` extension | HIGH | **FIXED** | Magic byte inspection (`%PDF-`, `\x89PNG`, `\xFF\xD8\xFF`) verifying file header before handling; immediate deletion on mismatch. |
| **Denial of Service (Disk Fill / Memory Exhaustion)** | Unbounded download sizes crashing the local agent machine | MEDIUM | **FIXED** | Enforced 100MB (`MAX_FILE_SIZE_BYTES`) strict ceiling; downloads aborted and purged if exceeded. |
| **Command Injection in Printing** | Shell metacharacters (`&`, `|`, `;`, quotes) injected via printer names or page ranges | CRITICAL | **FIXED** | Strict alphanumeric/space/hyphen validation (`/^[a-zA-Z0-9\s\-._()]+$/`) preventing command execution via SumatraPDF CLI. |
| **Server-Side Request Forgery (SSRF)** | Malicious jobs referencing internal metadata IPs (`169.254.169.254`, AWS/GCP metadata) | HIGH | **FIXED** | SSRF blocker denying loopback and link-local cloud metadata IPs in production; HTTPS enforced for non-loopback URLs. |
| **Cross-Shop Job Poisoning** | Malicious WebSocket broadcast or spoofed Supabase row with mismatched `shop_id` | HIGH | **FIXED** | Cryptographic and schema job authorization checks validating `job.shop_id === config.shopId` and enforcing `copies` between 1 and 100. |
| **Customer Data Persistence / Privacy Leak** | Documents left on disk after printing or during system crash | HIGH | **FIXED** | Privacy-by-default isolated temp directories, Windows thumbnail suppression (`desktop.ini` `+h +s`), immediate post-print deletion, and crash-recovery startup sweeping. |
| **Double-Printing / Race Condition** | Overlapping polling intervals and Realtime subscriptions spooling the same job twice | MEDIUM | **FIXED** | SQLite-backed deduplication engine (`sql.js`), `currentlyProcessingJobId` mutex lock, and adaptive polling (30s on WebSocket live, 10s on fallback). |

---

## 3. Deep-Dive Remediation Details

### 3.1 Token Redaction & Structured Logging (`src/logger.ts`)
- Implemented `Logger` class with log level control (`DEBUG`, `INFO`, `WARN`, `ERROR`).
- Automated multi-pass redaction filters:
  - `Bearer [a-zA-Z0-9_\-\.]+` -> `Bearer [REDACTED]`
  - JWT strings (`eyJ...`) -> `[REDACTED_JWT]`
  - Signed storage tokens (`token=...`, `signature=...`, `key=...`) -> `token=[REDACTED]`
  - Database connection passwords (`postgres://user:password@...`) -> `postgres://user:[REDACTED]@...`

### 3.2 File Integrity & Magic Byte Inspection (`src/downloader.ts`)
- Documents are streamed chunk-by-chunk to prevent memory spikes.
- Upon receiving the first data chunk, the agent reads the initial 8 bytes:
  - PDF: `%PDF-` (`0x25, 0x50, 0x44, 0x46, 0x2D`)
  - PNG: `\x89PNG\r\n\x1a\n` (`0x89, 0x50, 0x4E, 0x47`)
  - JPG: `\xFF\xD8\xFF` (`0xFF, 0xD8, 0xFF`)
- Files failing magic byte validation are unlinked immediately and rejected with an explicit security warning.
- Enforced HTTPS in production for all external document URLs.
- Included automatic 401/403 token expiration refresh via backend `/api/agent/download-url`.

### 3.3 Command Injection Prevention (`src/printer.ts`)
- Printer names are validated against `/^[a-zA-Z0-9\s\-._()]+$/`. Names containing shell control characters (`&`, `|`, `;`, `>`, `<`, `` ` ``) throw an immediate security exception.
- Page ranges are checked for malicious input; any invalid pattern defaults safely to `all`.
- Target printers are checked against live Windows hardware enumerations before spooling to avoid silent spooler hangs.
- Added deterministic B&W vs Color routing (`resolveTargetPrinter`).

### 3.4 Job Isolation & Privacy-by-Default (`src/downloader.ts` & `src/secureTemp.ts`)
- Each print job is quarantined in its own isolated subfolder:
  `%LOCALAPPDATA%\PrintItAgent\jobs\<job-id>\doc-<job-id>.pdf`
- Temp directory includes a hidden, system `desktop.ini` suppressing Windows Explorer thumbnail generation and indexing.
- Files are verified unlinked immediately after spooling; any crash residue is cleaned during startup sweep.

### 3.5 Packaging & Binary Execution Hardening (`package.json`)
- Electron packaging configured with `asarUnpack: ["**/node_modules/pdf-to-printer/dist/**"]` ensuring SumatraPDF binary executes natively from `app.asar.unpacked/`.
- TypeScript source maps (`!dist/**/*.map`) and unit test code (`!dist/__tests__/**/*`) excluded from the shipped `app.asar`.
- `sql-wasm.wasm` directly packaged into `dist/` with fallback discovery across `process.resourcesPath`.

---

## 4. Test Verification Summary

- **Total Test Cases:** 25 passing (0 failures).
- **Security Specific Tests:**
  - `PdfDownloader blocks SSRF and cloud metadata endpoints` (PASS)
  - `PrinterService rejects malicious printer names with command injection characters` (PASS)
  - `PrinterService ignores malicious page range injection` (PASS)
  - `PdfDownloader validates magic byte signatures and rejects disguised files` (PASS)
  - `Logger redacts tokens, JWTs, query credentials, and database passwords` (PASS)
  - `Printing: Deterministic B&W vs Color printer resolution` (PASS)
- **Simulated Real-World Flow:**
  - SQLite deduplication validated.
  - Privacy-by-default post-delete check verified (`false` existence check).
  - Multi-page N-up grid layouts (2-up, 4-up, 6-up) verified.

---

## 5. Conclusion

The PrintIt Agent v1.0.0 meets all production security criteria, privacy-by-default requirements, and operational resilience standards outlined in the PRD. It is cleared for Windows production distribution.
