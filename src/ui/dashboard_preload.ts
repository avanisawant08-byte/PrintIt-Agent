import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('dashboardApi', {
  getStatus: () => ipcRenderer.invoke('dashboard:get-status'),
  getPrinters: () => ipcRenderer.invoke('dashboard:get-printers'),
  selectPrinter: (printerName: string) => ipcRenderer.invoke('dashboard:select-printer', printerName),
  selectPrinterBw: (printerName: string) => ipcRenderer.invoke('dashboard:select-printer-bw', printerName),
  selectPrinterColor: (printerName: string) => ipcRenderer.invoke('dashboard:select-printer-color', printerName),
  testPrint: () => ipcRenderer.invoke('dashboard:test-print'),
  getRecentJobs: () => ipcRenderer.invoke('dashboard:get-recent-jobs'),
  openSecureFolder: () => ipcRenderer.invoke('dashboard:open-secure-folder'),
  repairDevice: () => ipcRenderer.invoke('dashboard:repair-device'),
  getAutostart: () => ipcRenderer.invoke('dashboard:get-autostart'),
  setAutostart: (enabled: boolean) => ipcRenderer.invoke('dashboard:set-autostart', enabled),
  /** Registers a callback invoked whenever a reprint job completes (or fails). */
  onActivityLog: (callback: (entry: { message: string; timestamp: string }) => void) => {
    ipcRenderer.on('reprint:activity-log', (_event, entry) => callback(entry));
  }
});
