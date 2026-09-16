export type PrintJobStatus = 'PENDING' | 'PRINTING' | 'COMPLETED' | 'FAILED';

export type AgentDeviceStatus = 'ONLINE' | 'OFFLINE' | 'PRINTING';

export interface PrintJob {
  id: string;
  order_id: string;
  shop_id: string;
  pdf_url: string;
  checksum: string;
  copies: number;
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
