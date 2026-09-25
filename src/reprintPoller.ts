/**
 * ReprintPoller — polls the backend for dispatched reprint jobs and prints them.
 *
 * Flow per poll tick:
 *   GET /api/agent/jobs           → list of pending reprint jobs
 *   PUT /api/agent/jobs/:id/ack   → claim the job (marks it "printing")
 *   GET /api/agent/download-url   → get a 1-hour signed Firebase URL
 *   Download file → temp dir
 *   PrinterService.printPdf()     → spool to physical/virtual printer
 *   Delete temp file
 *   Push "✅ Reprinted …" to dashboard activity log via IPC
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';
import { BrowserWindow } from 'electron';
import { ConfigManager } from './config';
import { PrinterService } from './printer';
import { logger } from './logger';
import { ReprintJob, ReprintPrintOptions } from './types';
import { PdfDownloader } from './downloader';
import { LayoutProcessor } from './layoutProcessor';

const POLL_INTERVAL_MS = 5_000;

export class ReprintPoller {
  private static instance: ReprintPoller;
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  /** Tracks job IDs currently being processed to prevent concurrent duplicate execution */
  private inFlight = new Set<number>();

  private configManager: ConfigManager;
  private printerService: PrinterService;
  private downloader: PdfDownloader;

  private constructor() {
    this.configManager = ConfigManager.getInstance();
    this.printerService = PrinterService.getInstance();
    this.downloader = new PdfDownloader();
  }

  public static getInstance(): ReprintPoller {
    if (!ReprintPoller.instance) {
      ReprintPoller.instance = new ReprintPoller();
    }
    return ReprintPoller.instance;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('ReprintPoller', `Starting reprint job poll (every ${POLL_INTERVAL_MS / 1000}s)`);
    // Fire immediately on start, then on interval
    this.tick();
    this.timer = setInterval(() => {
      this.tick();
    }, POLL_INTERVAL_MS);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('ReprintPoller', 'Reprint poll stopped.');
  }

  // ── Poll tick ──────────────────────────────────────────────────────────────

  private tick(): void {
    if (!this.configManager.isPaired()) return;
    this.pollAndProcess().catch((err) => {
      logger.warn('ReprintPoller', `Unhandled error in poll tick: ${err?.message || err}`);
    });
  }

  private async pollAndProcess(): Promise<void> {
    const config = this.configManager.get();
    const backendUrl = (config.backendApiUrl || 'http://localhost:3000').replace(/\/$/, '');
    const authToken = config.authToken || '';

    let jobs: ReprintJob[];
    try {
      const res = await axios.get<{ jobs: ReprintJob[] }>(`${backendUrl}/api/agent/jobs`, {
        headers: { Authorization: `Bearer ${authToken}` },
        timeout: 8_000
      });
      jobs = res.data?.jobs ?? [];
    } catch (err: any) {
      logger.warn('ReprintPoller', `GET /api/agent/jobs failed: ${err?.message || err}`);
      return; // retry on next tick
    }

    if (jobs.length === 0) return;
    logger.info('ReprintPoller', `Received ${jobs.length} pending reprint job(s)`);

    for (const job of jobs) {
      if (this.inFlight.has(job.id)) {
        logger.info('ReprintPoller', `Job #${job.id} already in-flight, skipping`);
        continue;
      }
      // Process each job concurrently; errors are self-contained per job
      this.processJob(job, backendUrl, authToken).catch((err) => {
        logger.error('ReprintPoller', `Unexpected error processing job #${job.id}: ${err?.message || err}`);
        this.inFlight.delete(job.id);
      });
    }
  }

  // ── Per-job logic ──────────────────────────────────────────────────────────

  private async processJob(
    job: ReprintJob,
    backendUrl: string,
    authToken: string
  ): Promise<void> {
    this.inFlight.add(job.id);

    // 1. Ack the job immediately to prevent duplicate processing
    const ackOk = await this.ackJob(job.id, backendUrl, authToken);
    if (!ackOk) {
      logger.warn('ReprintPoller', `Ack failed for job #${job.id} — skipping to avoid duplicate print`);
      this.inFlight.delete(job.id);
      return;
    }

    // 2. Get signed download URL from backend
    let downloadUrl: string;
    try {
      downloadUrl = await this.fetchDownloadUrl(job.storage_path, backendUrl, authToken);
    } catch (err: any) {
      logger.error('ReprintPoller', `Could not get download URL for job #${job.id}: ${err?.message || err}`);
      this.pushActivityLog(`⚠️ Reprint job #${job.id} failed — could not get download URL`);
      this.inFlight.delete(job.id);
      return;
    }

    // 3. Download file to %TEMP%\printit_reprint_<jobId>.<ext>
    const ext = path.extname(job.storage_path) || '.pdf';
    const tempFilePath = path.join(os.tmpdir(), `printit_reprint_${job.id}${ext}`);
    const filename = path.basename(job.storage_path);

    try {
      await this.downloadToTemp(downloadUrl, tempFilePath);
    } catch (err: any) {
      logger.error('ReprintPoller', `Download failed for job #${job.id}: ${err?.message || err}`);
      this.pushActivityLog(`⚠️ Reprint job #${job.id} failed — download error`);
      this.inFlight.delete(job.id);
      return;
    }

    // 4. Validate file signature (PDF / PNG / JPG) — security hardening
    if (!this.downloader.validateFileSignature(tempFilePath)) {
      logger.error('ReprintPoller', `Security: invalid file type for job #${job.id}`);
      this.safeDelete(tempFilePath);
      this.pushActivityLog(`⚠️ Reprint job #${job.id} rejected — invalid file type`);
      this.inFlight.delete(job.id);
      return;
    }

    // 5. Resolve target printer & build print options
    const config = this.configManager.get();
    const opts = job.print_options || {};
    const printOptions = this.normalizePrintOptions(opts);
    let printerName: string;
    try {
      printerName = await this.printerService.resolveTargetPrinter(printOptions, config);
    } catch (err: any) {
      logger.error('ReprintPoller', `Printer unavailable for job #${job.id}: ${err?.message || err}`);
      this.safeDelete(tempFilePath);
      this.pushActivityLog(`⚠️ Reprint job #${job.id} failed — printer unavailable`);
      this.inFlight.delete(job.id);
      return;
    }

    // 6. Format document according to user layout (e.g. N-up, image to PDF) & Print silently
    const copies = Math.min(100, Math.max(1, Number(opts.copies ?? 1)));
    const shortOrderId = String(job.order_id).slice(0, 8);

    let printableFilePath = tempFilePath;
    let transformedFilePath: string | null = null;

    try {
      const layoutProcessor = LayoutProcessor.getInstance();
      const layoutResult = await layoutProcessor.process(tempFilePath, printOptions, path.dirname(tempFilePath));
      if (layoutResult.isTransformed) {
        transformedFilePath = layoutResult.outputPath;
        printableFilePath = layoutResult.outputPath;
      }

      await this.printerService.printPdf(printableFilePath, printerName, copies, printOptions);
      logger.info('ReprintPoller', `Job #${job.id} reprinted successfully (order ${job.order_id})`);
      this.pushActivityLog(`✅ Reprinted order #${shortOrderId} — ${filename}`);
    } catch (err: any) {
      logger.error('ReprintPoller', `SumatraPDF/spooler error for job #${job.id}: ${err?.message || err}`);
      this.pushActivityLog(`⚠️ Print spooling may have failed for job #${job.id}`);
    } finally {
      // 7. Always delete temp file after spooling (privacy-by-default)
      this.safeDelete(tempFilePath);
      if (transformedFilePath) {
        this.safeDelete(transformedFilePath);
      }
      this.inFlight.delete(job.id);
    }
  }

  // ── API helpers ────────────────────────────────────────────────────────────

  /**
   * PUT /api/agent/jobs/:jobId/ack
   * Returns true only if the server responds { success: true }.
   */
  private async ackJob(
    jobId: number,
    backendUrl: string,
    authToken: string
  ): Promise<boolean> {
    try {
      const res = await axios.put<{ success: boolean }>(
        `${backendUrl}/api/agent/jobs/${jobId}/ack`,
        {},
        {
          headers: { Authorization: `Bearer ${authToken}` },
          timeout: 6_000
        }
      );
      return res.data?.success === true;
    } catch (err: any) {
      logger.warn('ReprintPoller', `Ack request failed for job #${jobId}: ${err?.message || err}`);
      return false;
    }
  }

  /**
   * GET /api/agent/download-url?path=<storagePath>
   * Returns the signed download URL string.
   */
  private async fetchDownloadUrl(
    storagePath: string,
    backendUrl: string,
    authToken: string
  ): Promise<string> {
    const res = await axios.get<{ url: string }>(`${backendUrl}/api/agent/download-url`, {
      params: { path: storagePath },
      headers: { Authorization: `Bearer ${authToken}` },
      timeout: 8_000
    });
    const url = res.data?.url;
    if (!url) {
      throw new Error('Backend returned no URL');
    }
    // Validate before use (SSRF guard)
    this.downloader.validateDownloadUrl(url);
    return url;
  }

  // ── Download ───────────────────────────────────────────────────────────────

  /** Streams a URL directly to a local temp path via axios. */
  private async downloadToTemp(url: string, destPath: string): Promise<void> {
    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      timeout: 45_000,
      validateStatus: null // we inspect status manually
    });

    if (response.status < 200 || response.status >= 300) {
      response.data.resume();
      throw new Error(`HTTP ${response.status} downloading reprint file`);
    }

    const fileStream = fs.createWriteStream(destPath);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      response.data.pipe(fileStream);
      fileStream.on('finish', () => {
        if (!settled) { settled = true; resolve(); }
      });
      fileStream.on('error', (err) => {
        if (!settled) { settled = true; fileStream.destroy(); reject(err); }
      });
      (response.data as NodeJS.EventEmitter).on('error', (err: unknown) => {
        if (!settled) { settled = true; fileStream.destroy(); reject(err); }
      });
    });
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  /**
   * Maps the JSONB print_options from the backend to the shape PrinterService expects.
   * The backend uses { color, sides, copies, size, binding } — which already aligns
   * with our PrintOptions interface.
   */
  private normalizePrintOptions(opts: ReprintPrintOptions) {
    return {
      color: opts.color,
      sides: opts.sides,
      copies: opts.copies,
      size: opts.size,
      binding: opts.binding
    };
  }

  /** Silently deletes a file; swallows errors so cleanup never throws. */
  private safeDelete(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      logger.warn('ReprintPoller', `Could not delete temp file: ${filePath}`);
    }
  }

  /**
   * Pushes an activity log entry to every open BrowserWindow (dashboard UI).
   * The renderer listens for the 'reprint:activity-log' channel via the contextBridge.
   */
  private pushActivityLog(message: string): void {
    try {
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send('reprint:activity-log', {
            message,
            timestamp: new Date().toISOString()
          });
        }
      }
    } catch (err) {
      logger.warn('ReprintPoller', `Could not push activity log to UI: ${err}`);
    }
  }
}
