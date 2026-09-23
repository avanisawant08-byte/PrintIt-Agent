import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { AgentConfig } from './types';
import { getUserDataDir } from './paths';

dotenv.config();

const DEFAULT_CONFIG: AgentConfig = {
  shopId: process.env.DEFAULT_SHOP_ID || '',
  deviceId: process.env.DEFAULT_DEVICE_ID || '',
  deviceName: process.env.COMPUTERNAME || 'Windows-Shop-Agent',
  authToken: process.env.DEFAULT_AUTH_TOKEN || '',
  selectedPrinter: undefined,
  selectedPrinterBw: undefined,
  selectedPrinterColor: undefined,
  supabaseUrl: process.env.SUPABASE_URL || 'https://your-project.supabase.co',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || 'your-supabase-anon-key',
  backendApiUrl: process.env.BACKEND_API_URL || 'https://api.printit.com',
  autoStartOnBoot: true,
  heartbeatIntervalSec: Number(process.env.HEARTBEAT_INTERVAL_SEC) || 30
};

export class ConfigManager {
  private static instance: ConfigManager;
  private configPath: string;
  private config: AgentConfig;

  private constructor() {
    const userDataDir = getUserDataDir();
    this.configPath = path.join(userDataDir, 'agent-config.json');
    this.config = this.loadConfig();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private getSafeStorage(): any {
    try {
      // Dynamic require so node scripts/tests outside Electron don't fail
      const electron = require('electron');
      return electron?.safeStorage || null;
    } catch {
      return null;
    }
  }

  private loadConfig(): AgentConfig {
    let resolvedConfig: AgentConfig = { ...DEFAULT_CONFIG };
    let foundConfig = false;

    // Potential candidate configuration paths across Electron and Node CLI environments
    const candidatePaths = [
      this.configPath,
      process.env.APPDATA ? path.join(process.env.APPDATA, 'PrintIt Remote Agent', 'agent-config.json') : '',
      process.env.APPDATA ? path.join(process.env.APPDATA, 'printit-remote-agent', 'agent-config.json') : '',
      process.env.APPDATA ? path.join(process.env.APPDATA, 'PrintIt Agent', 'agent-config.json') : '',
      path.join(process.cwd(), '.agent-data', 'agent-config.json')
    ].filter(Boolean);

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        try {
          const raw = fs.readFileSync(p, 'utf8');
          const parsed = JSON.parse(raw);
          let resolvedAuthToken = parsed.authToken || '';

          const ss = this.getSafeStorage();
          if (parsed.encryptedAuthToken && ss && typeof ss.isEncryptionAvailable === 'function' && ss.isEncryptionAvailable()) {
            try {
              const buf = Buffer.from(parsed.encryptedAuthToken, 'base64');
              resolvedAuthToken = ss.decryptString(buf);
            } catch (decErr) {
              console.warn(`[ConfigManager] Failed to decrypt encryptedAuthToken from ${p}:`, decErr);
            }
          }

          resolvedConfig = {
            ...resolvedConfig,
            ...parsed,
            authToken: resolvedAuthToken || resolvedConfig.authToken
          };
          foundConfig = true;

          // If we found a fully paired config with authToken, we can stop searching
          if (resolvedConfig.shopId && resolvedConfig.deviceId && resolvedConfig.authToken) {
            break;
          }
        } catch (err) {
          console.warn(`[ConfigManager] Could not parse config candidate: ${p}`, err);
        }
      }
    }

    if (!foundConfig) {
      console.log('[ConfigManager] No existing configuration file found; initializing with defaults.');
    }

    return resolvedConfig;
  }

  public get(): AgentConfig {
    return { ...this.config };
  }

  public set(updates: Partial<AgentConfig>): AgentConfig {
    this.config = { ...this.config, ...updates };
    this.save();
    return this.get();
  }

  public isPaired(): boolean {
    return Boolean(this.config.shopId && this.config.deviceId);
  }

  public clearPairing(): void {
    this.set({
      shopId: '',
      deviceId: '',
      authToken: '',
      selectedPrinter: undefined,
      selectedPrinterBw: undefined,
      selectedPrinterColor: undefined
    });
  }

  private save(): void {
    try {
      const toSave: any = { ...this.config };
      const ss = this.getSafeStorage();

      if (this.config.authToken && ss && typeof ss.isEncryptionAvailable === 'function' && ss.isEncryptionAvailable()) {
        try {
          const encBuf = ss.encryptString(this.config.authToken);
          toSave.encryptedAuthToken = encBuf.toString('base64');
          delete toSave.authToken; // Do not store plaintext auth token when encrypted
        } catch (encErr) {
          console.warn('[ConfigManager] safeStorage encryption failed, saving plaintext token:', encErr);
        }
      } else if (!this.config.authToken) {
        delete toSave.encryptedAuthToken;
      }

      fs.writeFileSync(this.configPath, JSON.stringify(toSave, null, 2), 'utf8');
    } catch (err) {
      console.error('[ConfigManager] Error writing config:', err);
    }
  }
}

