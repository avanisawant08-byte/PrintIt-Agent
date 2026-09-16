import { app } from 'electron';
import { ConfigManager } from './config';
import { DedupDatabase } from './dedup';
import { TrayManager } from './tray';
import { PairingManager } from './pairing';
import { RealtimeManager } from './realtime';
import { HeartbeatService } from './heartbeat';
import { SecureTempManager } from './secureTempManager';
import { DashboardManager } from './dashboard';

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

    // Ensure agent automatically starts with Windows in the background (packaged production only)
    try {
      if (app.isPackaged && !app.getLoginItemSettings().openAtLogin) {
        app.setLoginItemSettings({
          openAtLogin: true,
          openAsHidden: true
        });
      }
    } catch {}

    // Setup pairing callback
    pairingManager.setOnPairedCallback(async () => {
      console.log('[PrintIt Agent] Device newly paired! Activating listeners...');
      await trayManager.updateMenu();
      await realtimeManager.start();
      heartbeatService.start();
      
      // Auto-enable launch on Windows startup (packaged production only)
      try {
        if (app.isPackaged) {
          app.setLoginItemSettings({
            openAtLogin: true,
            openAsHidden: true
          });
        }
      } catch {}

      console.log('[PrintIt Agent] Agent is running silently in the background.');
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

    // 5. Check if already paired
    if (configManager.isPaired()) {
      console.log('[PrintIt Agent] Device already paired. Connecting silently to shop realtime queue...');
      await realtimeManager.start();
      heartbeatService.start();
      // Runs 100% silently in background tray — no popup window!
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

app.whenReady().then(() => {
  Application.init().catch((err) => {
    console.error('[PrintIt Agent] Fatal initialization error:', err);
  });
});
