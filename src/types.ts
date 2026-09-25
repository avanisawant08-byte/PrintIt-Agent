export type PrintJobStatus = 'PENDING' | 'PRINTING' | 'COMPLETED' | 'FAILED';

export type AgentDeviceStatus = 'ONLINE' | 'OFFLINE' | 'PRINTING' | 'READY';

export interface PrintOptions {
  size?: string;
  color?: 'bw' | 'color' | string;
  sides?: 'single' | 'double' | string;
  copies?: number;
  binding?: string;
  orientation?: 'portrait' | 'landscape' | string;
  pages_per_paper?: number;
  repeat_image_on_grid?: boolean;
  page_range?: string;
  [key: string]: any;
}

export interface PrintJob {
  id: string;
  order_id: string;
  shop_id: string;
  pdf_url: string;
  checksum: string;
  copies: number;
  printer_name?: string | null;
  print_options?: PrintOptions | null;
  status: PrintJobStatus;
  error_message?: string | null;
  retry_count: number;
  is_secure?: boolean;
  file_deleted?: boolean;
  file_deleted_at?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface SecureCleanupResult {
  purgedFiles: string[];
  errors: string[];
}

export interface AgentConfig {
  shopId: string;
  shopName?: string;
  deviceId: string;
  deviceName: string;
  authToken: string;
  selectedPrinter?: string;
  selectedPrinterBw?: string;
  selectedPrinterColor?: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  backendApiUrl?: string;
  autoStartOnBoot: boolean;
  heartbeatIntervalSec: number;
}

export interface PrinterDevice {
  deviceId: string;
  name: string;
  isDefault?: boolean;
}

export interface ProcessedJobRecord {
  job_id: string;
  checksum: string;
  printed_at: number;
  status: PrintJobStatus;
}

// ── Reprint Jobs (agent_print_jobs table) ────────────────────────────────────

export interface ReprintPrintOptions {
  color?: 'bw' | 'color' | string;
  sides?: 'single' | 'double' | string;
  copies?: number;
  size?: string;
  binding?: string;
  [key: string]: any;
}

/** Shape returned by GET /api/agent/jobs */
export interface ReprintJob {
  id: number;
  order_id: string;
  file_index: number;
  storage_path: string;
  print_options: ReprintPrintOptions;
}
