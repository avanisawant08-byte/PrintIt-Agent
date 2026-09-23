import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ConfigManager } from './config';
import { PrintJob, PrintJobStatus } from './types';

export class SupabaseService {
  private static instance: SupabaseService;
  private client: SupabaseClient | null = null;
  private configManager: ConfigManager;

  private constructor() {
    this.configManager = ConfigManager.getInstance();
    this.initClient();
  }

  public static getInstance(): SupabaseService {
    if (!SupabaseService.instance) {
      SupabaseService.instance = new SupabaseService();
    }
    return SupabaseService.instance;
  }

  public initClient(): SupabaseClient | null {
    const config = this.configManager.get();
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      console.warn('[SupabaseService] Supabase URL or Anon Key is missing');
      this.client = null;
      return null;
    }

    const headers: Record<string, string> = {};
    if (config.authToken && config.authToken.split('.').length === 3) {
      headers['Authorization'] = `Bearer ${config.authToken}`;
    } else if (config.authToken) {
      headers['x-device-token'] = config.authToken;
    }

    this.client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      },
      global: {
        headers
      }
    });

    console.log('[SupabaseService] Client initialized with endpoint:', config.supabaseUrl);
    return this.client;
  }

  public getClient(): SupabaseClient | null {
    if (!this.client) {
      return this.initClient();
    }
    return this.client;
  }

  /**
   * Fetches any pending jobs for this shop (for initial catch-up and reconnect resilience)
   */
  public async getPendingJobs(shopId: string): Promise<PrintJob[]> {
    const client = this.getClient();
    if (!client || !shopId) return [];

    try {
      // Pick up PENDING jobs and FAILED jobs with fewer than 5 attempts.
      // FAILED jobs result from download errors (e.g. 403) and should be retried
      // now that the downloader has URL-refresh fallback logic.
      const { data, error } = await client
        .from('print_jobs')
        .select('*')
        .eq('shop_id', shopId)
        .or('status.eq.PENDING,and(status.eq.FAILED,retry_count.lt.5)')
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[SupabaseService] Error fetching pending jobs:', error);
        return [];
      }

      return (data || []) as PrintJob[];
    } catch (err) {
      console.error('[SupabaseService] Exception fetching pending jobs:', err);
      return [];
    }
  }

  /**
   * Updates the status of a specific print job in Supabase
   */
  public async updateJobStatus(jobId: string, status: PrintJobStatus, errorMessage?: string, retryCount?: number): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;

    try {
      const payload: any = {
        status,
        updated_at: new Date().toISOString()
      };

      if (errorMessage !== undefined) {
        payload.error_message = errorMessage;
      }

      if (retryCount !== undefined) {
        payload.retry_count = retryCount;
      }

      const { error } = await client
        .from('print_jobs')
        .update(payload)
        .eq('id', jobId);

      if (error) {
        console.error(`[SupabaseService] Failed to update job ${jobId} to ${status}:`, error);
        return false;
      }

      console.log(`[SupabaseService] Job ${jobId} status updated to: ${status}`);
      return true;
    } catch (err) {
      console.error(`[SupabaseService] Exception updating job status ${jobId}:`, err);
      return false;
    }
  }

  /**
   * Confirms to Supabase that the temporary document file has been verified deleted from disk.
   * Enables the customer-facing web app to display verified deletion status.
   */
  public async markJobFileDeleted(jobId: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;

    try {
      const { error } = await client
        .from('print_jobs')
        .update({
          file_deleted: true,
          file_deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', jobId);

      if (error) {
        console.error(`[SupabaseService] Failed to mark job ${jobId} file deleted:`, error);
        return false;
      }

      console.log(`[SupabaseService] Job ${jobId} confirmed file deleted in Supabase.`);
      return true;
    } catch (err) {
      console.error(`[SupabaseService] Exception marking job file deleted for ${jobId}:`, err);
      return false;
    }
  }

  /**
   * Updates the device record in agent_devices (heartbeat & status)
   */
  public async updateDeviceHeartbeat(
    deviceId: string,
    status: 'ONLINE' | 'OFFLINE' | 'PRINTING' | 'READY',
    selectedPrinter?: string,
    agentVersion: string = '1.0.0',
    availablePrinters?: any[]
  ): Promise<boolean> {
    const client = this.getClient();
    if (!client || !deviceId) return false;

    try {
      // Agent maintains internal READY state; map to ONLINE if PostgreSQL enum is ('ONLINE', 'OFFLINE', 'PRINTING')
      const dbStatus = (status === 'READY') ? 'ONLINE' : status;
      const payload: any = {
        status: dbStatus,
        selected_printer: selectedPrinter || null,
        agent_version: agentVersion,
        last_seen_at: new Date().toISOString()
      };

      if (availablePrinters !== undefined) {
        payload.available_printers = availablePrinters;
      }

      const { error } = await client
        .from('agent_devices')
        .update(payload)
        .eq('id', deviceId);

      if (error) {
        console.error('[SupabaseService] Heartbeat update error:', error);
        return false;
      }

      return true;
    } catch (err) {
      console.error('[SupabaseService] Heartbeat exception:', err);
      return false;
    }
  }

  /**
   * Fallback helper to fetch file print options directly from the orders table
   */
  public async getOrderPrintOptions(orderId: string, pdfUrl?: string): Promise<any | null> {
    const client = this.getClient();
    if (!client || !orderId) return null;

    try {
      const { data, error } = await client
        .from('orders')
        .select('files, print_options')
        .eq('order_id', orderId)
        .maybeSingle();

      if (error || !data) return null;

      if (data.files && Array.isArray(data.files)) {
        if (pdfUrl) {
          const cleanUrl = pdfUrl.split('?')[0];
          for (const f of data.files) {
            const fUrl = f.file_info?.s3_key || f.s3_key || f.url || '';
            if (fUrl && cleanUrl === fUrl.split('?')[0]) {
              if (f.print_options) return f.print_options;
            }
          }
        }
        // If single file or no specific match, use first file's print options
        if (data.files.length > 0 && data.files[0]?.print_options) {
          return data.files[0].print_options;
        }
      }

      return data.print_options || null;
    } catch (err) {
      console.warn('[SupabaseService] Could not fetch fallback order print_options:', err);
      return null;
    }
  }
}
