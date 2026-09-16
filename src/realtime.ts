import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase';
import { ConfigManager } from './config';
import { DedupDatabase } from './dedup';
import { PdfDownloader } from './downloader';
import { PrinterService } from './printer';
import { HeartbeatService } from './heartbeat';
import { PrintJob } from './types';

export class RealtimeManager {
  private static instance: RealtimeManager;
  private channel: RealtimeChannel | null = null;
  private queue: PrintJob[] = [];
  private isProcessing = false;
  private pollTimer: NodeJS.Timeout | null = null;

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
          if (
            updatedDevice &&
            updatedDevice.selected_printer &&
            updatedDevice.selected_printer !== this.configManager.get().selectedPrinter
          ) {
            console.log(
              `[RealtimeManager] Remote printer change from Webapp: "${updatedDevice.selected_printer}"`
            );
            this.configManager.set({ selectedPrinter: updatedDevice.selected_printer });
            try {
              const { TrayManager } = await import('./tray');
              await TrayManager.getInstance().updateMenu();
            } catch {}
          }
        }
      )
      .subscribe(async (status) => {
        console.log(`[RealtimeManager] Realtime subscription status: ${status}`);
        if (status === 'SUBSCRIBED') {
          // Reconnect / initial catch-up
          await this.catchUpPendingJobs();
        }
      });

    // Start robust periodic poll fallback (every 5 seconds) in case of WebSocket delays
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    this.pollTimer = setInterval(() => {
      this.catchUpPendingJobs().catch(() => {});
    }, 5000);
  }

  public async stop(): Promise<void> {
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
            .select('selected_printer')
            .eq('id', config.deviceId)
            .maybeSingle();

          if (
            dev &&
            dev.selected_printer &&
            dev.selected_printer !== config.selectedPrinter
          ) {
            console.log(
              `[RealtimeManager] Synced selected_printer from cloud: "${dev.selected_printer}"`
            );
            this.configManager.set({ selectedPrinter: dev.selected_printer });
            const { TrayManager } = await import('./tray');
            await TrayManager.getInstance().updateMenu();
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

    // Check if already in current queue
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
    console.log(`[RealtimeManager] Starting execution of job ${job.id} (Order: ${job.order_id})`);

    // Verify dedup once more before spooling
    if (this.dedupDb.isJobProcessed(job.id)) {
      console.log(`[RealtimeManager] Job ${job.id} was processed earlier. Aborting execution.`);
      await this.supabaseService.updateJobStatus(job.id, 'COMPLETED');
      return;
    }

    // Update status to PRINTING in Supabase and Heartbeat
    await this.supabaseService.updateJobStatus(job.id, 'PRINTING');
    this.heartbeatService.setStatus('PRINTING');

    let downloadedFilePath: string | null = null;

    try {
      // 1. Download PDF stream directly to isolated per-job directory & verify checksum
      const downloadResult = await this.downloader.downloadAndVerify(
        job.id,
        job.pdf_url,
        job.checksum,
        true // Privacy-by-default for all orders
      );
      downloadedFilePath = downloadResult.filePath;

      // 2. Determine target printer
      const config = this.configManager.get();
      const printerName = config.selectedPrinter;

      // 3. Print silently via SumatraPDF / Spooler
      await this.printerService.printPdf(downloadedFilePath, printerName, job.copies || 1);

      // 4. Record success in local SQLite dedup database
      this.dedupDb.markJobProcessed(job.id, downloadResult.checksum, 'COMPLETED');

      // 5. Update status in Supabase to COMPLETED
      await this.supabaseService.updateJobStatus(job.id, 'COMPLETED');
      console.log(`[RealtimeManager] Job ${job.id} printed successfully!`);

    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      console.error(`[RealtimeManager] Error executing job ${job.id}:`, errorMessage);

      const nextRetryCount = (job.retry_count || 0) + 1;
      const isMaxRetriesReached = nextRetryCount >= 5;
      const finalErrorMessage = isMaxRetriesReached
        ? `[Max Retries 5/5 Exceeded] ${errorMessage}`
        : errorMessage;

      // Record failure locally and remotely with incremented retry count
      this.dedupDb.markJobProcessed(job.id, job.checksum || '', 'FAILED');
      await this.supabaseService.updateJobStatus(job.id, 'FAILED', finalErrorMessage, nextRetryCount);
    } finally {
      // Privacy-by-Default: Guaranteed cleanup & existence verification for EVERY job
      if (downloadedFilePath) {
        await this.downloader.cleanup(downloadedFilePath, true);
        await this.supabaseService.markJobFileDeleted(job.id);
        console.log(`[RealtimeManager] [PRIVACY AUDIT] Job ${job.id} file deletion verified and recorded.`);
      }

      // Revert agent status to ONLINE
      this.heartbeatService.setStatus('ONLINE');
    }
  }
}
