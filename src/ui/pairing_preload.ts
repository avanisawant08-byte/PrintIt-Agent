import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('agentApi', {
  pairDevice: (pairingCode: string, deviceName: string) =>
    ipcRenderer.invoke('agent:pair-device', { pairingCode, deviceName }),
  getDefaultStationName: () => ipcRenderer.invoke('agent:get-station-name')
});
