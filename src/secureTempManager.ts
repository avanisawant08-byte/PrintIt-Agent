import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getSecureTempDir } from './paths';
import { SecureCleanupResult } from './types';

const execFileAsync = promisify(execFile);

/**
 * SecureTempManager
 * 
 * Manages the isolated local directory used exclusively for Secure Print documents.
 * 
 * Architecture & Security Decisions:
 * 
 * 1. WINDOWS THUMBNAIL CACHE & INDEXING SUPPRESSION:
 *    Windows Explorer and Windows Search Indexer aggressively cache previews of PDFs 
 *    and images into `thumbcache_*.db` / `thumbs.db`. This creates a persistent forensic
 *    leak vector even after a document file is deleted.
 *    To eliminate this vector, SecureTempManager configures the secure directory with:
 *    - `desktop.ini` declaring FolderType=Generic and NoThumbnailCache=1
 *    - Windows attributes: System (+s) and Hidden (+h) flags.
 * 
 * 2. CRASH RECOVERY (STARTUP SWEEP):
 *    If the agent machine crashes, experiences power failure, or is terminated mid-job,
 *    temporary decrypted PDFs could remain on disk.
 *    On every application startup, `initAndSweep()` scans the secure temp folder and purges
 *    any orphaned files not associated with an active in-flight job.
 * 
 * 3. DELETION METHOD & EXPLICIT SCOPING RATIONALE:
 *    Multi-pass secure overwrite (e.g. DoD 5220.22-M 7-pass shredding / Gutmann 35-pass) 
 *    is explicitly scoped out. The PrintIt threat model defends against local shop PC access 
 *    (store clerks, shared PC operators, or unauthorized terminal browsing via Windows Explorer),
 *    NOT forensic laboratory drive reconstruction.
 *    Modern print station PCs run SSDs and NVMe drives where flash translation layers (FTL) 
 *    and wear-leveling algorithms prevent deterministic sector overwrites while unnecessarily 
 *    accelerating flash memory wear. Standard OS delete (`fs.unlink`) paired with an immediate 
 *    post-deletion existence check (`!fs.existsSync`) completely satisfies the threat model.
 */
export class SecureTempManager {
  private static instance: SecureTempManager;
  private secureDir: string;
  private activeJobs: Set<string> = new Set(); // Stores absolute file paths currently in flight

  private constructor() {
    this.secureDir = getSecureTempDir();
  }

  public static getInstance(): SecureTempManager {
    if (!SecureTempManager.instance) {
      SecureTempManager.instance = new SecureTempManager();
    }
    return SecureTempManager.instance;
  }

  public getDirectory(): string {
    return this.secureDir;
  }

  /**
   * Initializes the secure folder, enforces OS thumbnail suppression,
   * and runs the mandatory startup sweep.
   */
  public async initAndSweep(): Promise<SecureCleanupResult> {
    console.log(`[SecureTempManager] Initializing secure temp directory: ${this.secureDir}`);

    if (!fs.existsSync(this.secureDir)) {
      fs.mkdirSync(this.secureDir, { recursive: true });
    }

    await this.applyWindowsCacheSuppression();
    return await this.startupSweep();
  }

  /**
   * Configures Windows folder attributes and desktop.ini to suppress thumbnail generation.
   */
  public async applyWindowsCacheSuppression(): Promise<void> {
    try {
      const desktopIniPath = path.join(this.secureDir, 'desktop.ini');
      const iniContent = '[.ShellClassInfo]\r\nFolderType=Generic\r\nConfirmFileOp=0\r\nNoThumbnailCache=1\r\n';

      if (!fs.existsSync(desktopIniPath)) {
        fs.writeFileSync(desktopIniPath, iniContent, 'utf8');
      }

      if (process.platform === 'win32') {
        // Set System + Hidden attributes on desktop.ini and the secure folder
        try {
          await execFileAsync('attrib', ['+h', '+s', desktopIniPath]);
          await execFileAsync('attrib', ['+h', '+s', this.secureDir]);
          console.log('[SecureTempManager] Applied Windows thumbnail suppression attributes (+h +s)');
        } catch (attribErr) {
          console.warn('[SecureTempManager] Non-critical: Failed to execute attrib command:', attribErr);
        }
      }
    } catch (err) {
      console.warn('[SecureTempManager] Error applying thumbnail suppression:', err);
    }
  }

  /**
   * Scans the secure directory and purges any orphaned files or job subdirectories.
   * Runs unconditionally on startup and can be triggered on recovery.
   */
  public async startupSweep(): Promise<SecureCleanupResult> {
    const result: SecureCleanupResult = {
      purgedFiles: [],
      errors: []
    };

    try {
      if (!fs.existsSync(this.secureDir)) {
        return result;
      }

      const entries = fs.readdirSync(this.secureDir);
      const ignoredFiles = new Set(['desktop.ini', 'thumbs.db']);

      for (const entry of entries) {
        if (ignoredFiles.has(entry.toLowerCase())) {
          continue;
        }

        const fullPath = path.join(this.secureDir, entry);

        try {
          const stats = fs.statSync(fullPath);

          if (stats.isFile()) {
            // If direct file is in-flight, skip
            if (this.activeJobs.has(fullPath)) {
              continue;
            }
            await this.deleteFileWithVerification(fullPath);
            result.purgedFiles.push(fullPath);
            console.log(`[SecureTempManager] [CRASH RECOVERY] Purged orphaned file: ${entry}`);
          } else if (stats.isDirectory()) {
            // Inspect per-job subdirectories
            const subEntries = fs.readdirSync(fullPath);
            let hasActiveFile = false;

            for (const sub of subEntries) {
              const subPath = path.join(fullPath, sub);
              if (this.activeJobs.has(subPath)) {
                hasActiveFile = true;
                break;
              }
            }

            if (hasActiveFile) {
              continue;
            }

            // Purge all orphaned files inside the job folder
            for (const sub of subEntries) {
              const subPath = path.join(fullPath, sub);
              try {
                if (fs.statSync(subPath).isFile()) {
                  await this.deleteFileWithVerification(subPath);
                  result.purgedFiles.push(subPath);
                  console.log(`[SecureTempManager] [CRASH RECOVERY] Purged file in job folder: ${sub}`);
                }
              } catch (subErr: any) {
                result.errors.push(`Failed to purge ${subPath}: ${subErr?.message || subErr}`);
              }
            }

            // Remove the empty job directory
            try {
              if (fs.existsSync(fullPath) && fs.readdirSync(fullPath).length === 0) {
                fs.rmdirSync(fullPath);
                console.log(`[SecureTempManager] [CRASH RECOVERY] Removed orphaned job dir: ${entry}`);
              }
            } catch (rmDirErr: any) {
              result.errors.push(`Failed to remove job dir ${entry}: ${rmDirErr?.message || rmDirErr}`);
            }
          }
        } catch (delErr: any) {
          const errMsg = `Failed to purge ${entry}: ${delErr?.message || delErr}`;
          console.error(`[SecureTempManager] ${errMsg}`);
          result.errors.push(errMsg);
        }
      }

      if (result.purgedFiles.length > 0) {
        console.log(`[SecureTempManager] Crash recovery complete. Cleaned up ${result.purgedFiles.length} orphan(s).`);
      } else {
        console.log('[SecureTempManager] Startup sweep complete. Directory is clean.');
      }
    } catch (err: any) {
      console.error('[SecureTempManager] Error during startup sweep:', err);
      result.errors.push(err?.message || String(err));
    }

    return result;
  }

  /**
   * Registers a file path as active in-flight to protect against concurrent sweeps.
   */
  public registerActiveFile(filePath: string): void {
    this.activeJobs.add(filePath);
  }

  /**
   * Unregisters an in-flight file path.
   */
  public unregisterActiveFile(filePath: string): void {
    this.activeJobs.delete(filePath);
  }

  /**
   * Standard OS delete + post-deletion existence verification.
   * Followed by clean removal of the parent job directory if empty.
   */
  public async deleteFileWithVerification(filePath: string): Promise<boolean> {
    this.unregisterActiveFile(filePath);

    if (!fs.existsSync(filePath)) {
      return true;
    }

    try {
      await fs.promises.unlink(filePath);
    } catch (err) {
      // Fallback attempt with unlinkSync if async failed
      try {
        fs.unlinkSync(filePath);
      } catch (fallbackErr) {
        throw new Error(`Failed to unlink file ${filePath}: ${fallbackErr}`);
      }
    }

    // Immediate existence verification check
    if (fs.existsSync(filePath)) {
      throw new Error(`Security verification failed: File ${filePath} still exists on disk after delete attempt.`);
    }

    console.log(`[SecureTempManager] Verified file deleted successfully from disk: ${filePath}`);

    // Try to remove the isolated job directory if empty
    try {
      const parentDir = path.dirname(filePath);
      if (fs.existsSync(parentDir) && path.basename(path.dirname(parentDir)).toLowerCase() === 'jobs') {
        const remaining = fs.readdirSync(parentDir);
        if (remaining.length === 0) {
          fs.rmdirSync(parentDir);
          console.log(`[SecureTempManager] Removed isolated job directory: ${parentDir}`);
        }
      }
    } catch (dirErr) {
      // Non-critical if directory removal is deferred to next sweep
      console.warn('[SecureTempManager] Note: Could not immediately remove parent job dir:', dirErr);
    }

    return true;
  }
}
