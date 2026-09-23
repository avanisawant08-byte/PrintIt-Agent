# PrintIt Agent v1.0.0 — Release Notes

**Release Date:** September 23, 2026  
**Target Platform:** Windows 10 / Windows 11 (x64)  
**Binary Type:** NSIS Installer + Portable Windows Executable  

---

## 🚀 Highlights & Features

The **PrintIt Agent v1.0.0** is the first production-hardened release of the silent remote print bridge for PrintIt partner shops. It connects local shop PC printers directly with cloud print jobs submitted by customers.

### Key Capabilities

1. **Per-Print Printer Selection & Dynamic Routing**
   - Directly honors the printer chosen by the shopkeeper for each individual job in the Shop Portal (`PrintReviewModal`).
   - Supports optional fallback routing for B&W and Color jobs if no specific printer was selected.
   - Verifies physical printer availability before spooling, falling back gracefully to the default printer if the target is offline.

2. **Full N-Up Grid Transformation Engine**
   - Built-in multi-page sheet layout engine (`LayoutProcessor` with `pdf-lib`).
   - Supports 2-up, 4-up, and 6-up layouts, auto-rotation for optimal aspect ratios, and custom paper sizes (A4, A3, Letter).

3. **Privacy-by-Default File Lifecycle**
   - Documents are held in job-isolated temporary directories with Windows thumbnail generation and search indexing suppressed (`desktop.ini` with `+h +s`).
   - Post-spool unlinking with explicit existence verification.
   - Crash-recovery sweep on startup automatically purges any orphaned files left behind by unexpected shutdowns or power loss.

4. **Zero-Duplicate Spooling**
   - SQLite-backed state tracking via embedded WebAssembly (`sql.js`).
   - Prevents double-printing even across rapid network reconnects or duplicate webhook notifications.
   - Synchronous in-memory mutex (`currentlyProcessingJobId`) prevents race conditions between WebSocket events and fallback polling sweeps.

5. **Adaptive Network Resilience**
   - Primary: Low-latency Supabase Realtime WebSocket connection.
   - Adaptive fallback: 30-second heartbeats when subscribed, scaling to 10-second active sweeps when offline.
   - Token refresh recovery: Transparently re-authenticates expired signed download URLs without failing the customer order.

---

## 🔒 Security Hardening

- **Automated Credential Masking:** Custom structured `Logger` automatically strips Bearer tokens, JWT signatures, database passwords, and signed storage tokens from all log outputs.
- **Magic Byte Validation:** Validates file magic headers (`%PDF-`, `\x89PNG`, `\xFF\xD8\xFF`) before processing, instantly deleting disguised scripts or executables.
- **Strict File Size Ceiling:** Enforced 100MB limit per download to prevent disk exhaustion.
- **Command Injection Guard:** All printer names and page ranges are sanitized against shell metacharacters before invocation.
- **SSRF Blocker:** Prohibits requests to loopback and cloud metadata endpoints (`169.254.169.254`).

---

## 📦 Distribution Artifacts & SHA-256 Checksums

| Package | Format | File Size | SHA-256 Checksum |
|---|---|---|---|
| **PrintIt Agent Setup 1.0.0.exe** | NSIS Installer (x64) | ~97.6 MB | `445FF048EC8AB931E21DD6F8B993C7C8289DA4A7B3FD1BABCDABDA063BDB289B` |
| **PrintIt Agent 1.0.0.exe** | Portable Executable (x64) | ~97.3 MB | `9E12CE6B459947DA6A9D0C748E710D4AB877E79E2EE43F77B90934ED1937B4B2` |

### Integrity Verification (PowerShell)

```powershell
Get-FileHash "PrintIt Agent Setup 1.0.0.exe" -Algorithm SHA256
Get-FileHash "PrintIt Agent 1.0.0.exe" -Algorithm SHA256
```
