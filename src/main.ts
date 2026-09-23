import { app } from 'electron';
import { ConfigManager } from './config';
import { DedupDatabase } from './dedup';
import { TrayManager } from './tray';
import { PairingManager } from './pairing';
import { RealtimeManager } from './realtime';
import { HeartbeatService } from './heartbeat';
import { SecureTempManager } from './secureTempManager';
import { DashboardManager } from './dashboard';

import { PrinterService } from './printer';

app.setName('PrintIt Remote Agent');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.printit.agent');
}

// Ensure single instance lock for background print agent
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log('[PrintIt Agent] Another instance is already running. Quitting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    console.log('[PrintIt Agent] Second instance launched. Bringing primary window to front.');
    if (ConfigManager.getInstance().isPaired()) {
      DashboardManager.getInstance().showDashboardWindow();
    } else {
      PairingManager.getInstance().showPairingWindow();
    }
  });
}

class Application {
  public static async init(): Promise<void> {
    console.log('[PrintIt Agent] Starting application...');

    // Prevent app from quitting when windows close (agent runs in tray)
    app.on('window-all-closed', () => {
      // Keep running in tray
    });

    // 0. Crash Recovery Sweep & OS Thumbnail Cache Suppression
    const secureTempManager = SecureTempManager.getInstance();
    await secureTempManager.initAndSweep();

    // 1. Initialize local SQLite dedup database
    const dedupDb = DedupDatabase.getInstance();
    await dedupDb.init();

    // 2. Initialize configuration
    const configManager = ConfigManager.getInstance();

    // 3. Initialize Tray
    const trayManager = TrayManager.getInstance();
    await trayManager.init();

    // 4. Initialize Services
    const realtimeManager = RealtimeManager.getInstance();
    const heartbeatService = HeartbeatService.getInstance();
    const pairingManager = PairingManager.getInstance();

    // Ensure agent automatically starts with Windows in the background (enabled by default, configurable by shopkeeper)
    try {
      const config = configManager.get();
      const shouldAutoStart = config.autoStartOnBoot !== false;
      if (app.isPackaged) {
        const currentSettings = app.getLoginItemSettings();
        if (currentSettings.openAtLogin !== shouldAutoStart) {
          app.setLoginItemSettings({
            openAtLogin: shouldAutoStart,
            openAsHidden: true
          });
        }
      }
    } catch (e) {
      console.warn('[PrintIt Agent] Could not update login item settings:', e);
    }

    // Setup pairing callback
    pairingManager.setOnPairedCallback(async () => {
      console.log('[PrintIt Agent] Device newly paired! Activating listeners...');
      await trayManager.updateMenu();
      await realtimeManager.start();
      heartbeatService.start();
      heartbeatService.setStatus('READY');
      
      // Auto-enable launch on Windows startup (enabled by default, configurable by shopkeeper)
      try {
        if (app.isPackaged && configManager.get().autoStartOnBoot !== false) {
          app.setLoginItemSettings({
            openAtLogin: true,
            openAsHidden: true
          });
        }
      } catch {}

      console.log('[PrintIt Agent] Agent is running silently in the background in READY state.');
    });

    // Setup switch shop callback from tray
    trayManager.setOnSwitchShopCallback(async () => {
      console.log('[PrintIt Agent] Switching shop requested. Stopping services and unpairing...');
      await realtimeManager.stop();
      await heartbeatService.stop();
      configManager.clearPairing();
      await trayManager.updateMenu();
      pairingManager.showPairingWindow();
    });

    // 5. Authenticate and initialize on boot if already paired
    if (configManager.isPaired()) {
      console.log('[PrintIt Agent] Authenticating device credentials...');

      // Verify printer hardware availability
      try {
        const printers = await PrinterService.getInstance().getAvailablePrinters(true);
        console.log(`[PrintIt Agent] Verified printer availability: ${printers.length} printer(s) detected.`);
      } catch (printerErr) {
        console.warn('[PrintIt Agent] Warning checking printer availability on startup:', printerErr);
      }

      // Establish backend connection
      console.log('[PrintIt Agent] Establishing backend connection...');
      await realtimeManager.start();
      heartbeatService.start();
      heartbeatService.setStatus('READY');
      await trayManager.updateMenu();
      console.log('[PrintIt Agent] Backend connection established. Device entered READY state.');

      DashboardManager.getInstance().showDashboardWindow();
    } else {
      console.log('[PrintIt Agent] Device unconfigured. Prompting for 6-character pairing code...');
      pairingManager.showPairingWindow();
    }

    // Graceful shutdown
    app.on('before-quit', async () => {
      console.log('[PrintIt Agent] Shutting down agent...');
      await heartbeatService.stop();
      await realtimeManager.stop();
    });
  }
}

// Global process-level safety guards to ensure the background tray daemon never silently crashes
process.on('uncaughtException', (error: Error) => {
  console.error('[PrintIt Agent] [FATAL UNCAUGHT EXCEPTION]:', error?.stack || error?.message || error);
});

process.on('unhandledRejection', (reason: any) => {
  console.error('[PrintIt Agent] [UNHANDLED PROMISE REJECTION]:', reason?.stack || reason?.message || reason);
});

app.whenReady().then(() => {
  Application.init().catch((err) => {
    console.error('[PrintIt Agent] Fatal initialization error:', err);
  });
});
