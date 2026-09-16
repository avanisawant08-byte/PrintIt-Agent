import fs from 'fs';
import path from 'path';
import os from 'os';
import { BrowserWindow, ipcMain } from 'electron';
import axios from 'axios';
import { ConfigManager } from './config';
import { SupabaseService } from './supabase';

export class PairingManager {
  private static instance: PairingManager;
  private pairingWindow: BrowserWindow | null = null;
  private configManager: ConfigManager;
  private onPairedCallback?: () => void;

  private constructor() {
    this.configManager = ConfigManager.getInstance();
    this.registerIpcHandlers();
  }

  public static getInstance(): PairingManager {
    if (!PairingManager.instance) {
      PairingManager.instance = new PairingManager();
    }
    return PairingManager.instance;
  }

  public setOnPairedCallback(callback: () => void): void {
    this.onPairedCallback = callback;
  }

  public showPairingWindow(): void {
    if (this.pairingWindow) {
      if (this.pairingWindow.isMinimized()) {
        this.pairingWindow.restore();
      }
      this.pairingWindow.show();
      this.pairingWindow.focus();
      return;
    }

    const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');

    this.pairingWindow = new BrowserWindow({
      width: 500,
      height: 620,
      resizable: true,
      minimizable: true,
      maximizable: false,
      skipTaskbar: false,
      show: true,
      center: true,
      icon: fs.existsSync(iconPath) ? iconPath : undefined,
      backgroundColor: '#0f172a',
      title: 'PrintIt Agent Pairing',
      webPreferences: {
        preload: path.join(__dirname, 'ui', 'pairing_preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    this.pairingWindow.setMenuBarVisibility(false);
    this.pairingWindow.loadFile(path.join(__dirname, 'ui', 'pairing.html'));

    this.pairingWindow.show();
    this.pairingWindow.focus();
    this.pairingWindow.setAlwaysOnTop(true);
    setTimeout(() => {
      if (this.pairingWindow && !this.pairingWindow.isDestroyed()) {
        this.pairingWindow.setAlwaysOnTop(false);
      }
    }, 1000);

    console.log('[PairingManager] Pairing window created and shown on screen.');

    this.pairingWindow.on('closed', () => {
      this.pairingWindow = null;
    });
  }

  public closePairingWindow(): void {
    if (this.pairingWindow) {
      this.pairingWindow.close();
      this.pairingWindow = null;
    }
  }

  private registerIpcHandlers(): void {
    ipcMain.handle('agent:get-station-name', () => {
      return os.hostname() || 'Counter-Station';
    });

    ipcMain.handle('agent:pair-device', async (_, { pairingCode, deviceName }) => {
      return await this.verifyAndPair(pairingCode, deviceName);
    });
  }

  private async verifyAndPair(pairingCode: string, deviceName: string): Promise<{ success: boolean; error?: string }> {
    const code = (pairingCode || '').trim().toUpperCase();
    if (code.length !== 6) {
      return { success: false, error: 'Invalid pairing code format.' };
    }

    const config = this.configManager.get();

    // 1. Try Backend API pairing endpoint if available
    if (config.backendApiUrl && !config.backendApiUrl.includes('your-backend')) {
      try {
        const res = await axios.post(`${config.backendApiUrl}/api/agent/pair`, {
          pairingCode: code,
          deviceName
        }, { timeout: 10000 });

        if (res.data && res.data.shopId && res.data.deviceId) {
          this.applyPairing(res.data.shopId, res.data.deviceId, res.data.token || '', deviceName);
          return { success: true };
        }
      } catch (err: any) {
        console.warn('[PairingManager] Backend API pairing failed, falling back to Supabase direct verification:', err?.message);
      }
    }

    // 2. Direct Supabase verification fallback
    const supabase = SupabaseService.getInstance().getClient();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('agent_devices')
          .select('id, shop_id, pairing_code, pairing_code_expires_at')
          .eq('pairing_code', code)
          .gt('pairing_code_expires_at', new Date().toISOString())
          .maybeSingle();

        if (error) {
          return { success: false, error: 'Database error while verifying code.' };
        }

        if (!data) {
          return { success: false, error: 'Code expired or not found. Please generate a new code in Dashboard.' };
        }

        // Generate synthetic device token and update device record
        const token = `agent-jwt-${data.id}-${Date.now()}`;
        await supabase
          .from('agent_devices')
          .update({
            device_name: deviceName,
            status: 'ONLINE',
            pairing_code: null, // Consume code
            auth_token: token,
            last_seen_at: new Date().toISOString()
          })
          .eq('id', data.id);

        this.applyPairing(data.shop_id, data.id, token, deviceName);
        return { success: true };

      } catch (err: any) {
        return { success: false, error: err?.message || 'Error connecting to database.' };
      }
    }

    return { success: false, error: 'Cannot connect to authentication service.' };
  }

  private applyPairing(shopId: string, deviceId: string, token: string, deviceName: string): void {
    console.log(`[PairingManager] Successfully paired with Shop ${shopId}, Device ${deviceId}`);

    this.configManager.set({
      shopId,
      deviceId,
      authToken: token,
      deviceName
    });

    // Re-initialize Supabase client with new token
    SupabaseService.getInstance().initClient();

    // Trigger onPaired callback (starts realtime, heartbeat, updates tray)
    if (this.onPairedCallback) {
      this.onPairedCallback();
    }

    // Close pairing window after a brief moment
    setTimeout(() => {
      this.closePairingWindow();
    }, 1500);
  }
}
