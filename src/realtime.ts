import fs from 'fs';
import path from 'path';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase';
import { ConfigManager } from './config';
import { DedupDatabase } from './dedup';
import { PdfDownloader } from './downloader';
import { PrinterService } from './printer';
import { HeartbeatService } from './heartbeat';
import { LayoutProcessor } from './layoutProcessor';
import { PageSelector } from './pageSelector';
import { SecureTempManager } from './secureTempManager';
import { PrintJob } from './types';
import { logger } from './logger';

export class RealtimeManager {
  private static instance: RealtimeManager;
  private channel: RealtimeChannel | null = null;
  private queue: PrintJob[] = [];
  private isProcessing = false;
  private currentlyProcessingJobId: string | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private currentPollIntervalMs = 10000;

  private supabaseService: SupabaseService;
  private configManager: ConfigManager;
  private dedupDb: DedupDatabase;
  private downloader: PdfDownloader;
  private printerService: PrinterService;
  private heartbeatService: HeartbeatService;

  private constructor() {
    this.supabaseService = SupabaseService.getInstance();
    this.configManager = ConfigManager.getInstance();
    this.dedupDb = DedupDatabase.getInstance();
    this.downloader = new PdfDownloader();
    this.printerService = PrinterService.getInstance();
    this.heartbeatService = HeartbeatService.getInstance();
  }

  public static getInstance(): RealtimeManager {
    if (!RealtimeManager.instance) {
      RealtimeManager.instance = new RealtimeManager();
    }
    return RealtimeManager.instance;
  }

  /**
   * Initializes the Supabase Realtime channel subscription for the configured shop
   */
  public async start(): Promise<void> {
    const config = this.configManager.get();
    if (!config.shopId || !this.configManager.isPaired()) {
      console.log('[RealtimeManager] Shop is not paired yet. Realtime subscription waiting.');
      return;
    }

    const client = this.supabaseService.getClient();
    if (!client) {
      console.error('[RealtimeManager] Supabase client unavailable, cannot subscribe.');
      return;
    }

    // Unsubscribe from any previous channel
    await this.stop();
    this.isRunning = true;

    const channelName = `shop-print-jobs-${config.shopId}`;
    console.log(`[RealtimeManager] Subscribing to Supabase Realtime channel: ${channelName}`);

    this.channel = client
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'print_jobs',
          filter: `shop_id=eq.${config.shopId}`
        },
        (payload) => {
          console.log('[RealtimeManager] Received new job INSERT:', payload.new);
          this.enqueueJob(payload.new as PrintJob);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'print_jobs',
          filter: `shop_id=eq.${config.shopId}`
        },
        (payload) => {
          const updatedJob = payload.new as PrintJob;
          if (updatedJob.status === 'PENDING') {
            console.log('[RealtimeManager] Received job UPDATE to PENDING:', updatedJob);
            this.enqueueJob(updatedJob);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'agent_devices',
          filter: `id=eq.${config.deviceId}`
        },
        async (payload) => {
          const updatedDevice = payload.new as any;
          if (!updatedDevice) return;

          const currentConfig = this.configManager.get();
          const updates: any = {};

          if (
            updatedDevice.selected_printer &&
            updatedDevice.selected_printer !== currentConfig.selectedPrinter
          ) {
            console.log(
              `[RealtimeManager] Remote printer change from Webapp: "${updatedDevice.selected_printer}"`
            );
            updates.selectedPrinter = updatedDevice.selected_printer;
          }

          if (
            updatedDevice.selected_printer_bw !== undefined &&
            updatedDevice.selected_printer_bw !== currentConfig.selectedPrinterBw
          ) {
            console.log(
              `[RealtimeManager] Remote B&W printer change from Webapp: "${updatedDevice.selected_printer_bw}"`
            );
            updates.selectedPrinterBw = updatedDevice.selected_printer_bw || undefined;
          }

          if (
            updatedDevice.selected_printer_color !== undefined &&
            updatedDevice.selected_printer_color !== currentConfig.selectedPrinterColor
          ) {
            console.log(
              `[RealtimeManager] Remote Color printer change from Webapp: "${updatedDevice.selected_printer_color}"`
            );
            updates.selectedPrinterColor = updatedDevice.selected_printer_color || undefined;
          }

          if (Object.keys(updates).length > 0) {
            this.configManager.set(updates);
            try {
              const { TrayManager } = await import('./tray');
              await TrayManager.getInstance().updateMenu();
            } catch {}
          }
        }
      )
      .subscribe(async (status) => {
        console.log(`[RealtimeManager] Realtime subscription status: ${status}`);
        if (!this.isRunning) return;

        if (status === 'SUBSCRIBED') {
          // Reconnect / initial catch-up
          await this.catchUpPendingJobs();
          // WebSocket is live: relax database polling to every 30 seconds
          this.setPollingInterval(30000);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // WebSocket disconnected: accelerate fallback poll to 10 seconds
          this.setPollingInterval(10000);
        }
      });

    // Start initial fallback poll timer (10s) until SUBSCRIBED event confirms WebSocket
    this.setPollingInterval(10000);
  }

  private setPollingInterval(intervalMs: number): void {
    if (!this.isRunning) return;
    if (this.pollTimer && this.currentPollIntervalMs === intervalMs) {
      return;
    }
    this.currentPollIntervalMs = intervalMs;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollTimer = setInterval(() => {
      this.catchUpPendingJobs().catch(() => {});
    }, intervalMs);
    console.log(`[RealtimeManager] Active polling fallback interval adjusted to ${intervalMs / 1000}s`);
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.channel) {
      console.log('[RealtimeManager] Unsubscribing from Realtime channel');
      await this.channel.unsubscribe();
      this.channel = null;
    }
  }

  /**
   * Catch-up mechanism: queries database for any pending jobs that arrived while offline
   */
  private async catchUpPendingJobs(): Promise<void> {
    const config = this.configManager.get();
    if (!config.shopId) return;

    // 1. Sync remote printer choice if configured from webapp
    if (config.deviceId) {
      try {
        const client = this.supabaseService.getClient();
        if (client) {
          const { data: dev } = await client
            .from('agent_devices')
            .select('selected_printer, selected_printer_bw, selected_printer_color')
            .eq('id', config.deviceId)
            .maybeSingle();

          if (dev) {
            const updates: any = {};
            if (dev.selected_printer && dev.selected_printer !== config.selectedPrinter) {
              updates.selectedPrinter = dev.selected_printer;
            }
            if (dev.selected_printer_bw !== undefined && dev.selected_printer_bw !== config.selectedPrinterBw) {
              updates.selectedPrinterBw = dev.selected_printer_bw || undefined;
            }
            if (dev.selected_printer_color !== undefined && dev.selected_printer_color !== config.selectedPrinterColor) {
              updates.selectedPrinterColor = dev.selected_printer_color || undefined;
            }

            if (Object.keys(updates).length > 0) {
              console.log(
                '[RealtimeManager] Synced printer configurations from cloud:',
                updates
              );
              this.configManager.set(updates);
              const { TrayManager } = await import('./tray');
              await TrayManager.getInstance().updateMenu();
            }
          }
        }
      } catch (devErr) {
        console.warn('[RealtimeManager] Could not check remote printer config:', devErr);
      }
    }

    console.log(`[RealtimeManager] Catching up on missed PENDING jobs for shop: ${config.shopId}`);
    const pendingJobs = await this.supabaseService.getPendingJobs(config.shopId);
    console.log(`[RealtimeManager] Found ${pendingJobs.length} pending job(s) in database`);

    for (const job of pendingJobs) {
      if (this.dedupDb.isJobProcessed(job.id)) {
        console.log(`[RealtimeManager] [STARTUP CATCH-UP] Job ${job.id} was already processed/completed. Suppressing duplicate print.`);
        continue;
      }
      this.enqueueJob(job);
    }
  }

  public enqueueJob(job: PrintJob): void {
    if (!job || !job.id) return;

    // Max retries guard (max 5 attempts) to prevent infinite retry loops on corrupt files
    if ((job.retry_count || 0) >= 5) {
      console.warn(`[RealtimeManager] Job ${job.id} has exceeded maximum retries (${job.retry_count}/5). Skipping.`);
      return;
    }

    // Fast-path dedup check against local SQLite.
    // NOTE: isJobProcessed now only returns true for COMPLETED jobs — FAILED jobs are retried.
    if (this.dedupDb.isJobProcessed(job.id)) {
      console.log(`[RealtimeManager] Job ${job.id} already COMPLETED per local SQLite. Skipping.`);
      return;
    }

    // Check if actively executing or already in current queue
    if (this.currentlyProcessingJobId === job.id) {
      console.log(`[RealtimeManager] Job ${job.id} is currently executing in-flight. Skipping duplicate enqueue.`);
      return;
    }

    if (this.queue.some((j) => j.id === job.id)) {
      console.log(`[RealtimeManager] Job ${job.id} is already in the in-memory processing queue.`);
      return;
    }

    this.queue.push(job);
    console.log(`[RealtimeManager] Enqueued job ${job.id} (status: ${job.status}). Queue length: ${this.queue.length}`);
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) break;

      await this.executePrintJob(job);
    }

    this.isProcessing = false;
  }

  private async executePrintJob(job: PrintJob): Promise<void> {
    logger.info('RealtimeManager', `Starting execution of job ${job.id} (Order: ${job.order_id})`);
    this.currentlyProcessingJobId = job.id;

    const config = this.configManager.get();

    // Security & Authorization Guard: Validate job ownership and integrity
    if (!job.shop_id || job.shop_id !== config.shopId) {
      const authErr = `Authorization Failed: Job ${job.id} does not belong to paired shop ${config.shopId}`;
      logger.error('RealtimeManager', authErr);
      await this.supabaseService.updateJobStatus(job.id, 'FAILED', authErr);
      return;
    }

    if (!job.id || !job.order_id || !job.pdf_url) {
      const malformedErr = `Malformed Job: Missing essential fields in job ${job.id}`;
      logger.error('RealtimeManager', malformedErr);
      await this.supabaseService.updateJobStatus(job.id, 'FAILED', malformedErr);
      return;
    }

    // Verify dedup once more before spooling
    if (this.dedupDb.isJobProcessed(job.id)) {
      logger.info('RealtimeManager', `Job ${job.id} was processed earlier per local SQLite. Aborting execution.`);
      await this.supabaseService.updateJobStatus(job.id, 'COMPLETED');
      return;
    }

    // Update status to PRINTING in Supabase and Heartbeat
    await this.supabaseService.updateJobStatus(job.id, 'PRINTING');
    this.heartbeatService.setStatus('PRINTING');

    let downloadedFilePath: string | null = null;
    let subsetFilePath: string | null = null;
    let transformedFilePath: string | null = null;

    try {
      // 1. Download file stream directly to isolated per-job directory & verify checksum
      const downloadResult = await this.downloader.downloadAndVerify(
        job.id,
        job.pdf_url,
        job.checksum,
        true // Privacy-by-default for all orders
      );
      downloadedFilePath = downloadResult.filePath;

      // 2. Resolve Print Options (use job.print_options or fallback to querying orders table)
      let effectiveOptions = job.print_options;
      if (!effectiveOptions || Object.keys(effectiveOptions).length === 0) {
        try {
          const fallbackOpts = await this.supabaseService.getOrderPrintOptions(job.order_id, job.pdf_url);
          if (fallbackOpts) {
            effectiveOptions = { ...fallbackOpts, ...(effectiveOptions || {}) };
          }
        } catch (e) {
          logger.warn('RealtimeManager', `Could not query fallback print options for job ${job.id}: ${e}`);
        }
      }

      logger.info(
        'RealtimeManager',
        `Job ${job.id} effective print options: ${JSON.stringify(effectiveOptions || {})}`
      );

      // 2.5 Extract selective pages if requested (PRD: Selective Page Printing)
      // Must execute BEFORE layoutProcessor so N-up, orientation, and duplex operate on the requested subset.
      const pageSelection = effectiveOptions?.pages || effectiveOptions?.page_range;
      let activePdfPath = downloadedFilePath;
      const jobDir = path.dirname(downloadedFilePath);

      if (pageSelection && config.enableSelectivePagePrinting !== false) {
        const pageSelector = PageSelector.getInstance();
        const selectResult = await pageSelector.extractPageSubset(
          downloadedFilePath,
          pageSelection,
          jobDir
        );
        if (selectResult.isExtracted) {
          subsetFilePath = selectResult.outputPath;
          activePdfPath = selectResult.outputPath;
          SecureTempManager.getInstance().registerActiveFile(subsetFilePath);
          logger.info(
            'RealtimeManager',
            `Selective page extraction successful for job ${job.id}: ${selectResult.pageCount} page(s) extracted -> ${path.basename(subsetFilePath)}`
          );
          // Strip page_range and pages so downstream SumatraPDF/driver does not re-filter the already-extracted subset!
          effectiveOptions = {
            ...effectiveOptions,
            page_range: undefined,
            pages: undefined
          };
        }
      }

      // 3. Format document according to user layout (e.g. 4 pages on a sheet, orientation, repeat)
      const layoutProcessor = LayoutProcessor.getInstance();
      const layoutResult = await layoutProcessor.process(activePdfPath, effectiveOptions, jobDir);

      let printableFilePath = activePdfPath;
      if (layoutResult.isTransformed) {
        transformedFilePath = layoutResult.outputPath;
        printableFilePath = layoutResult.outputPath;
        // Register transformed file with SecureTempManager so crash sweep protects/deletes it
        SecureTempManager.getInstance().registerActiveFile(transformedFilePath);
      }

      // 4. Deterministically resolve target printer (B&W vs Color with physical availability verification)
      const printerName = await this.printerService.resolveTargetPrinter(effectiveOptions, config);
      logger.info(
        'RealtimeManager',
        `Job ${job.id} routing to printer: "${printerName}" (Mode: ${effectiveOptions?.color || 'bw'})`
      );

      // 5. Print silently via SumatraPDF / Spooler or Virtual Test Printer
      const effectiveCopies = Math.min(100, Math.max(1, Number(effectiveOptions?.copies || job.copies || 1)));
      await this.printerService.printPdf(printableFilePath, printerName, effectiveCopies, effectiveOptions);

      // 6. Record success in local SQLite dedup database with order and file index
      const fileIndex = Number(job.file_index ?? (job.print_options as any)?.file_index ?? 0);
      this.dedupDb.markJobProcessed(
        job.id,
        downloadResult.checksum,
        'COMPLETED',
        job.order_id,
        fileIndex
      );

      // 7. Update status in Supabase to COMPLETED
      await this.supabaseService.updateJobStatus(job.id, 'COMPLETED');
      logger.info('RealtimeManager', `Job ${job.id} (Order: ${job.order_id}, File: ${fileIndex + 1}) printed successfully!`);

    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      logger.error('RealtimeManager', `Error executing job ${job.id} (Order: ${job.order_id}): ${errorMessage}`);

      const nextRetryCount = (job.retry_count || 0) + 1;
      const isMaxRetriesReached = nextRetryCount >= 5;
      const finalErrorMessage = isMaxRetriesReached
        ? `[Max Retries 5/5 Exceeded] ${errorMessage}`
        : errorMessage;

      // Record failure locally and remotely with incremented retry count
      const fileIndex = Number(job.file_index ?? (job.print_options as any)?.file_index ?? 0);
      this.dedupDb.markJobProcessed(job.id, job.checksum || '', 'FAILED', job.order_id, fileIndex);
      await this.supabaseService.updateJobStatus(job.id, 'FAILED', finalErrorMessage, nextRetryCount);

      // Check partial-batch failure policy (PRD Section 5.3 & Open Question 2)
      if (config.haltBatchOnFailure) {
        const remainingForOrder = this.queue.filter((j) => j.order_id === job.order_id);
        if (remainingForOrder.length > 0) {
          logger.warn(
            'RealtimeManager',
            `Halting batch for order ${job.order_id} due to failure on job ${job.id}. Purging ${remainingForOrder.length} pending file(s).`
          );
          this.queue = this.queue.filter((j) => j.order_id !== job.order_id);
          for (const rem of remainingForOrder) {
            await this.supabaseService.updateJobStatus(
              rem.id,
              'FAILED',
              `Batch halted: previous file failed (${errorMessage})`
            );
          }
        }
      }
    } finally {
      // Privacy-by-Default: Guaranteed cleanup & existence verification for EVERY job
      if (transformedFilePath && fs.existsSync(transformedFilePath)) {
        try {
          await this.downloader.cleanup(transformedFilePath, true);
        } catch (cleanErr) {
          console.warn(`[RealtimeManager] Could not delete transformed file: ${transformedFilePath}`, cleanErr);
        }
      }
      if (subsetFilePath && fs.existsSync(subsetFilePath)) {
        try {
          await this.downloader.cleanup(subsetFilePath, true);
        } catch (cleanErr) {
          console.warn(`[RealtimeManager] Could not delete subset file: ${subsetFilePath}`, cleanErr);
        }
      }
      if (downloadedFilePath) {
        await this.downloader.cleanup(downloadedFilePath, true);
        await this.supabaseService.markJobFileDeleted(job.id);
        console.log(`[RealtimeManager] [PRIVACY AUDIT] Job ${job.id} file deletion verified and recorded.`);
      }

      // Revert agent status to ONLINE and clear in-flight marker
      this.currentlyProcessingJobId = null;
      this.heartbeatService.setStatus('READY');
    }
  }

  /**
   * Cancels all queued in-flight files for a given order batch (PRD Open Question 4).
   * Returns the count of cancelled jobs purged from queue.
   */
  public cancelOrderBatch(orderId: string): number {
    const matching = this.queue.filter((j) => j.order_id === orderId);
    this.queue = this.queue.filter((j) => j.order_id !== orderId);
    console.log(
      `[RealtimeManager] Cancelled batch for order ${orderId}: purged ${matching.length} pending file(s).`
    );
    return matching.length;
  }
}
