import { app } from 'electron';
import { SupabaseService } from './supabase';
import { ConfigManager } from './config';
import { PrinterService } from './printer';
import { AgentDeviceStatus } from './types';

export class HeartbeatService {
  private static instance: HeartbeatService;
  private timer: NodeJS.Timeout | null = null;
  private currentStatus: AgentDeviceStatus = 'READY';
  private supabaseService: SupabaseService;
  private configManager: ConfigManager;

  private getAgentVersion(): string {
    try {
      if (typeof app !== 'undefined' && typeof app.getVersion === 'function') {
        return app.getVersion();
      }
    } catch {}
    return '1.0.0';
  }

  private constructor() {
    this.supabaseService = SupabaseService.getInstance();
    this.configManager = ConfigManager.getInstance();
  }

  public static getInstance(): HeartbeatService {
    if (!HeartbeatService.instance) {
      HeartbeatService.instance = new HeartbeatService();
    }
    return HeartbeatService.instance;
  }

  public setStatus(status: AgentDeviceStatus): void {
    this.currentStatus = status;
    this.sendHeartbeat();
  }

  public start(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }

    const config = this.configManager.get();
    if (!config.deviceId) {
      console.log('[HeartbeatService] No deviceId configured, heartbeat idle');
      return;
    }

    console.log(`[HeartbeatService] Starting heartbeat loop (every ${config.heartbeatIntervalSec}s)`);
    this.currentStatus = 'READY';
    this.sendHeartbeat();

    this.timer = setInterval(() => {
      this.sendHeartbeat();
    }, config.heartbeatIntervalSec * 1000);
  }

  public async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    const config = this.configManager.get();
    if (config.deviceId) {
      console.log('[HeartbeatService] Sending final OFFLINE status update...');
      await this.supabaseService.updateDeviceHeartbeat(
        config.deviceId,
        'OFFLINE',
        config.selectedPrinter,
        this.getAgentVersion()
      );
    }
  }

  private async sendHeartbeat(): Promise<void> {
    const config = this.configManager.get();
    if (!config.deviceId || !this.configManager.isPaired()) return;

    try {
      const printers = await PrinterService.getInstance().getAvailablePrinters();
      const printerList = printers.map((p) => ({
        name: p.name,
        isDefault: p.isDefault
      }));

      // If no printer selected yet, and printers exist, select default
      let activePrinter = config.selectedPrinter;
      if (!activePrinter && printers.length > 0) {
        const def = printers.find((p) => p.isDefault) || printers[0];
        activePrinter = def.name;
        this.configManager.set({ selectedPrinter: activePrinter });
      }

      await this.supabaseService.updateDeviceHeartbeat(
        config.deviceId,
        this.currentStatus,
        activePrinter,
        this.getAgentVersion(),
        printerList
      );
    } catch (err) {
      console.warn('[HeartbeatService] Error dispatching heartbeat:', err);
    }
  }
}
