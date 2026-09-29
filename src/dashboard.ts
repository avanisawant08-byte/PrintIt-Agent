import path from 'path';
import fs from 'fs';
import { BrowserWindow, ipcMain, shell, app } from 'electron';
import { ConfigManager } from './config';
import { PrinterService } from './printer';
import { DedupDatabase } from './dedup';
import { PairingManager } from './pairing';
import { getSecureTempDir } from './paths';
import { SupabaseService } from './supabase';

export class DashboardManager {
  private static instance: DashboardManager;
  private dashboardWindow: BrowserWindow | null = null;
  private configManager: ConfigManager;
  private printerService: PrinterService;
  private dedupDb: DedupDatabase;

  private constructor() {
    this.configManager = ConfigManager.getInstance();
    this.printerService = PrinterService.getInstance();
    this.dedupDb = DedupDatabase.getInstance();
    this.registerIpcHandlers();
  }

  public static getInstance(): DashboardManager {
    if (!DashboardManager.instance) {
      DashboardManager.instance = new DashboardManager();
    }
    return DashboardManager.instance;
  }

  public showDashboardWindow(): void {
    console.log('[DashboardManager] showDashboardWindow called');
    try {
      if (this.dashboardWindow && !this.dashboardWindow.isDestroyed()) {
        console.log('[DashboardManager] Restoring existing dashboard window');
        if (this.dashboardWindow.isMinimized()) {
          this.dashboardWindow.restore();
        }
        this.dashboardWindow.show();
        this.dashboardWindow.focus();
        this.dashboardWindow.setAlwaysOnTop(true);
        setTimeout(() => {
          if (this.dashboardWindow && !this.dashboardWindow.isDestroyed()) {
            this.dashboardWindow.setAlwaysOnTop(false);
          }
        }, 1000);
        return;
      }

      const pngPath = path.join(__dirname, '..', 'assets', 'icon.png');
      const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');
      const windowIcon = fs.existsSync(pngPath) ? pngPath : (fs.existsSync(iconPath) ? iconPath : undefined);
      console.log('[DashboardManager] Creating new BrowserWindow, icon:', windowIcon);

      this.dashboardWindow = new BrowserWindow({
        width: 720,
        height: 780,
        minWidth: 600,
        minHeight: 640,
        resizable: true,
        minimizable: true,
        maximizable: true,
        skipTaskbar: false,
        show: true,
        center: true,
        icon: windowIcon,
        backgroundColor: '#0b0f19',
        title: 'PrintIt Agent — Control Center',
        webPreferences: {
          preload: path.join(__dirname, 'ui', 'dashboard_preload.js'),
          contextIsolation: true,
          nodeIntegration: false
        }
      });

      // Security Hardening: Block arbitrary popups and disallow navigation away from local UI
      this.dashboardWindow.webContents.setWindowOpenHandler(() => {
        return { action: 'deny' };
      });

      this.dashboardWindow.webContents.on('will-navigate', (event, navigationUrl) => {
        try {
          const parsed = new URL(navigationUrl);
          if (parsed.protocol !== 'file:') {
            event.preventDefault();
          }
        } catch {
          event.preventDefault();
        }
      });

      const htmlPath = path.join(__dirname, 'ui', 'dashboard.html');
      console.log('[DashboardManager] Loading file:', htmlPath);
      this.dashboardWindow.loadFile(htmlPath).then(() => {
        console.log('[DashboardManager] Dashboard file loaded successfully');
        if (this.dashboardWindow && !this.dashboardWindow.isDestroyed()) {
          this.dashboardWindow.show();
          this.dashboardWindow.focus();
          this.dashboardWindow.setAlwaysOnTop(true);
          setTimeout(() => {
            if (this.dashboardWindow && !this.dashboardWindow.isDestroyed()) {
              this.dashboardWindow.setAlwaysOnTop(false);
            }
          }, 1000);
        }
      }).catch((err) => {
        console.error('[DashboardManager] Error loading HTML file:', err);
      });

      this.dashboardWindow.on('closed', () => {
        console.log('[DashboardManager] Dashboard window closed');
        this.dashboardWindow = null;
      });
    } catch (err) {
      console.error('[DashboardManager] Error creating dashboard window:', err);
    }
  }

  public closeDashboardWindow(): void {
    if (this.dashboardWindow && !this.dashboardWindow.isDestroyed()) {
      this.dashboardWindow.close();
      this.dashboardWindow = null;
    }
  }

  private registerIpcHandlers(): void {
    ipcMain.handle('dashboard:get-status', async () => {
      const config = this.configManager.get();
      let shopName = config.shopName || (config.shopId === '0aada7cf-7b91-4a60-9a31-d520ff5dd02d' ? 'Pr xerox shop' : 'Shop Connected');

      // Fetch in background if missing
      if (!config.shopName && config.shopId) {
        (async () => {
          try {
            const client = SupabaseService.getInstance().getClient();
            if (client) {
              const res = await client.from('shops').select('name').eq('shop_id', config.shopId).maybeSingle();
              if (res?.data?.name) {
                this.configManager.set({ shopName: res.data.name });
              }
            }
          } catch {}
        })();
      }

      return {
        shopId: config.shopId,
        shopName,
        deviceId: config.deviceId,
        deviceName: config.deviceName,
        selectedPrinter: config.selectedPrinter,
        selectedPrinterBw: config.selectedPrinterBw,
        selectedPrinterColor: config.selectedPrinterColor,
        autoStartOnBoot: config.autoStartOnBoot !== false,
        isPaired: this.configManager.isPaired()
      };
    });

    ipcMain.handle('dashboard:get-printers', async () => {
      const printers = await this.printerService.getAvailablePrinters(true);
      return printers.map((p) => ({
        name: p.name,
        isDefault: p.isDefault
      }));
    });

    ipcMain.handle('dashboard:select-printer', async (_event, printerName: string) => {
      this.configManager.set({ selectedPrinter: printerName || undefined });
      return true;
    });

    ipcMain.handle('dashboard:select-printer-bw', async (_event, printerName: string) => {
      this.configManager.set({ selectedPrinterBw: printerName || undefined });
      return true;
    });

    ipcMain.handle('dashboard:select-printer-color', async (_event, printerName: string) => {
      this.configManager.set({ selectedPrinterColor: printerName || undefined });
      return true;
    });



    ipcMain.handle('dashboard:get-recent-jobs', async () => {
      return this.dedupDb.getRecentJobs(10);
    });

    ipcMain.handle('dashboard:open-secure-folder', async () => {
      const dir = getSecureTempDir();
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      await shell.openPath(dir);
      return true;
    });

    
    ipcMain.handle('dashboard:get-autostart', async () => {
      const config = this.configManager.get();
      return config.autoStartOnBoot !== false;
    });

    ipcMain.handle('dashboard:set-autostart', async (_event, enabled: boolean) => {
      this.configManager.set({ autoStartOnBoot: enabled });
      try {
        app.setLoginItemSettings({
          openAtLogin: enabled,
          openAsHidden: true
        });
        console.log(`[DashboardManager] Auto-start updated by shopkeeper to: ${enabled}`);
      } catch (e) {
        console.warn('[DashboardManager] Failed to update login item settings:', e);
      }
      try {
        const { TrayManager } = await import('./tray');
        await TrayManager.getInstance().updateMenu();
      } catch {}
      return true;
    });
    ipcMain.handle('dashboard:repair-device', async () => {
      this.configManager.clearPairing();
      this.closeDashboardWindow();
      PairingManager.getInstance().showPairingWindow();
      return true;
    });
  }
}
