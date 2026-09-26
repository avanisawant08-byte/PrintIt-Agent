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
  pages?: string;
  pad_odd_duplex?: boolean;
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
  file_index?: number;
  total_files?: number;
  batch_id?: string;
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
  enableBatchJobIsolation?: boolean;
  padOddDuplexFiles?: boolean;
  haltBatchOnFailure?: boolean;
  spoolerInterJobDelayMs?: number;
  enableSelectivePagePrinting?: boolean;
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
