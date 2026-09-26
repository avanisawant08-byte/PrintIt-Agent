import path from 'path';
import fs from 'fs';
import { app, Tray, Menu, MenuItemConstructorOptions, nativeImage, dialog, shell } from 'electron';
import { ConfigManager } from './config';
import { PrinterService } from './printer';
import { DedupDatabase } from './dedup';
import { PairingManager } from './pairing';
import { HeartbeatService } from './heartbeat';
import { DashboardManager } from './dashboard';

export class TrayManager {
  private static instance: TrayManager;
  private tray: Tray | null = null;
  private configManager: ConfigManager;
  private printerService: PrinterService;
  private dedupDb: DedupDatabase;
  private heartbeatService: HeartbeatService;
  private onSwitchShopCallback: (() => Promise<void>) | null = null;

  private constructor() {
    this.configManager = ConfigManager.getInstance();
    this.printerService = PrinterService.getInstance();
    this.dedupDb = DedupDatabase.getInstance();
    this.heartbeatService = HeartbeatService.getInstance();
  }

  public static getInstance(): TrayManager {
    if (!TrayManager.instance) {
      TrayManager.instance = new TrayManager();
    }
    return TrayManager.instance;
  }

  public setOnSwitchShopCallback(callback: () => Promise<void>): void {
    this.onSwitchShopCallback = callback;
  }

  public async init(): Promise<void> {
    const icon = this.getTrayIcon();
    this.tray = new Tray(icon);
    this.tray.setToolTip('PrintIt Remote Agent');

    await this.updateMenu();

    const openPrimaryWindow = () => {
      if (this.configManager.isPaired()) {
        DashboardManager.getInstance().showDashboardWindow();
      } else {
        PairingManager.getInstance().showPairingWindow();
      }
    };

    this.tray.on('double-click', openPrimaryWindow);
    this.tray.on('click', openPrimaryWindow);
  }

  public async updateMenu(): Promise<void> {
    if (!this.tray) return;

    const config = this.configManager.get();
    const isPaired = this.configManager.isPaired();

    // 1. Fetch available Windows printers dynamically
    const printers = await this.printerService.getAvailablePrinters();
    const currentPrinter = config.selectedPrinter;

    // If no printer selected yet, and printers exist, select default
    if (!currentPrinter && printers.length > 0) {
      const def = printers.find((p) => p.isDefault) || printers[0];
      this.configManager.set({ selectedPrinter: def.name });
    }

    const currentBw = config.selectedPrinterBw || currentPrinter;
    const currentColor = config.selectedPrinterColor || currentPrinter;

    // 2. Helper to build dynamic Printer Selection Submenus
    const buildPrinterSubmenu = (
      currentVal: string | undefined,
      onSelect: (name: string) => void
    ): MenuItemConstructorOptions[] => {
      if (printers.length === 0) {
        return [{ label: 'No printers detected', enabled: false }];
      }
      return printers.map((printer) => ({
        label: `${printer.name}${printer.isDefault ? ' (OS Default)' : ''}`,
        type: 'radio',
        checked: currentVal ? printer.name === currentVal : Boolean(printer.isDefault),
        click: () => {
          onSelect(printer.name);
          this.updateMenu();
        }
      }));
    };

    // 3. Build Tray Menu Items
    const template: MenuItemConstructorOptions[] = [
      {
        label: '🖥️ Open Control Panel',
        click: () => {
          if (isPaired) {
            DashboardManager.getInstance().showDashboardWindow();
          } else {
            PairingManager.getInstance().showPairingWindow();
          }
        }
      },
      { type: 'separator' },
      {
        label: isPaired ? `🟢 READY (Shop: ${config.shopId.slice(0, 8)}...)` : '⚪ Not Paired',
        enabled: false
      },
      {
        label: `Station: ${config.deviceName || 'Counter-Station'}`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: `⚫ Default B&W: ${currentBw ? currentBw.slice(0, 20) : 'Auto'}`,
        submenu: buildPrinterSubmenu(currentBw, (name) => {
          console.log(`[TrayManager] Selected B&W printer: ${name}`);
          this.configManager.set({ selectedPrinterBw: name });
        })
      },
      {
        label: `🎨 Default Color: ${currentColor ? currentColor.slice(0, 20) : 'Auto'}`,
        submenu: buildPrinterSubmenu(currentColor, (name) => {
          console.log(`[TrayManager] Selected Color printer: ${name}`);
          this.configManager.set({ selectedPrinterColor: name });
        })
      },
      {
        label: `🖨️ General Fallback: ${currentPrinter ? currentPrinter.slice(0, 20) : 'Auto'}`,
        submenu: buildPrinterSubmenu(currentPrinter, (name) => {
          console.log(`[TrayManager] Selected fallback printer: ${name}`);
          this.configManager.set({ selectedPrinter: name });
        })
      },
      {
        label: 'Test Print Page',
        enabled: printers.length > 0,
        click: () => this.handleTestPrint()
      },
      {
        label: 'View Recent Prints',
        click: () => this.showRecentPrints()
      },
      { type: 'separator' },
      {
        label: isPaired ? '🏪 Switch Shop / Re-Pair' : '🔗 Pair Station (6-Digit Code)',
        click: async () => {
          if (isPaired) {
            const { response } = await dialog.showMessageBox({
              type: 'question',
              buttons: ['Switch Shop', 'Cancel'],
              defaultId: 0,
              cancelId: 1,
              title: 'Switch Shop',
              message: 'Are you sure you want to disconnect this agent from the current shop and pair with another shop?'
            });
            if (response !== 0) return;
          }

          if (this.onSwitchShopCallback) {
            await this.onSwitchShopCallback();
          } else {
            this.configManager.clearPairing();
            await this.updateMenu();
            PairingManager.getInstance().showPairingWindow();
          }
        }
      },
      {
        label: 'Start with Windows',
        type: 'checkbox',
        checked: this.configManager.get().autoStartOnBoot !== false,
        click: (item) => {
          this.configManager.set({ autoStartOnBoot: item.checked });
          try {
            app.setLoginItemSettings({
              openAtLogin: item.checked,
              openAsHidden: true
            });
            console.log(`[TrayManager] Windows auto-startup set to: ${item.checked}`);
          } catch (e) {
            console.warn('[TrayManager] Failed to set login item settings:', e);
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit Agent',
        click: async () => {
          await this.heartbeatService.stop();
          app.quit();
        }
      }
    ];

    const contextMenu = Menu.buildFromTemplate(template);
    this.tray.setContextMenu(contextMenu);
  }

  private async handleTestPrint(): Promise<void> {
    const config = this.configManager.get();
    const targetPrinter = config.selectedPrinter;

    try {
      // Create a rich diagnostic test PDF
      const testPdfPath = path.join(app.getPath('temp'), 'printit-test-slip.pdf');
      const { generateTestPagePdf } = await import('./testPageGenerator');
      await generateTestPagePdf(testPdfPath, {
        shopName: config.shopName,
        shopId: config.shopId,
        deviceName: config.deviceName,
        printerName: targetPrinter,
        version: app.getVersion()
      });

      const result = await this.printerService.printPdf(testPdfPath, targetPrinter, 1);
      
      if (result && result.savedPath) {
        shell.showItemInFolder(result.savedPath);
        dialog.showMessageBox({
          type: 'info',
          title: 'PrintIt Test Print (Virtual Mode)',
          message: `Virtual test print generated successfully!\n\nFile saved to:\n${result.savedPath}\n\n(Revealed in File Explorer)`
        });
      } else {
        dialog.showMessageBox({
          type: 'info',
          title: 'PrintIt Test Print',
          message: `Test print dispatched successfully to printer:\n${targetPrinter || 'Default Printer'}`
        });
      }
    } catch (err: any) {
      dialog.showErrorBox('Test Print Failed', err?.message || 'Could not print test document.');
    }
  }

  private showRecentPrints(): void {
    const recent = this.dedupDb.getRecentJobs(10);
    if (recent.length === 0) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Recent Print Jobs',
        message: 'No print jobs have been processed yet on this device.'
      });
      return;
    }

    const logText = recent
      .map((r, i) => {
        const time = new Date(r.printed_at).toLocaleTimeString();
        return `${i + 1}. [${time}] Job ID: ${r.job_id.slice(0, 8)}... (${r.status})`;
      })
      .join('\n');

    dialog.showMessageBox({
      type: 'info',
      title: 'Recent Print Jobs (SQLite)',
      message: `Last ${recent.length} processed job(s):\n\n${logText}`
    });
  }

  private getTrayIcon(): Electron.NativeImage {
    const png32Path = path.join(__dirname, '..', 'assets', 'icon32.png');
    const pngPath = path.join(__dirname, '..', 'assets', 'icon.png');
    const icoPath = path.join(__dirname, '..', 'assets', 'icon.ico');

    if (fs.existsSync(png32Path)) {
      const img = nativeImage.createFromPath(png32Path);
      if (!img.isEmpty()) {
        console.log('[TrayManager] Loaded tray icon from icon32.png');
        return img;
      }
    }

    if (fs.existsSync(pngPath)) {
      const img = nativeImage.createFromPath(pngPath);
      if (!img.isEmpty()) {
        console.log('[TrayManager] Loaded tray icon from icon.png');
        return img;
      }
    }

    if (fs.existsSync(icoPath)) {
      const img = nativeImage.createFromPath(icoPath);
      if (!img.isEmpty()) {
        console.log('[TrayManager] Loaded tray icon from icon.ico');
        return img;
      }
    }

    // Fallback: create a 16x16 crisp programmatic tray icon if asset is not found
    const canvas = nativeImage.createFromBuffer(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAZElEQVR4nGNgGFjAiM84VjXEk2CqGf7//8+ATw8TF5sBXQz/B9Dlhv///+fEp4fHAC4GBnSMzYDYMAbZQD4hA6huwE0fQw24aYnSAYM9+f//f4ZRo0bRoBmgxAAo9g40BgA9m3fHlqZqogAAAABJRU5ErkJggg==',
        'base64'
      )
    );
    return canvas;
  }
}
