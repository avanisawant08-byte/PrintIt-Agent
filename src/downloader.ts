import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';
import { getJobTempDir } from './paths';
import { SecureTempManager } from './secureTempManager';

export interface DownloadResult {
  filePath: string;
  checksum: string;
  fileSize: number;
}

export class PdfDownloader {
  private secureTempManager: SecureTempManager;
  private hashStream: crypto.Hash;

  constructor() {
    this.secureTempManager = SecureTempManager.getInstance();
    this.hashStream = crypto.createHash('sha256');
  }

  /**
   * Downloads a PDF file from a URL, calculates SHA-256 hash on-the-fly,
   * and verifies against expected checksum.
   *
   * Privacy-by-Default Architecture:
   * - Streams directly to an isolated per-job temp dir: %TEMP%\PrintItAgent\jobs\<jobId>\
   * - ZERO in-memory buffering (low RAM footprint for older shop PCs).
   * - Registered with SecureTempManager during in-flight processing.
   *
   * 403 Auto-Recovery:
   * - Firebase Storage URLs without a ?token= always return 403 for private files.
   * - If the stored URL has no token, this method calls the local backend's
   *   /api/agent/download-url endpoint to get a fresh token-bearing URL, then retries.
   */
  public async downloadAndVerify(
    jobId: string,
    pdfUrl: string,
    expectedChecksum: string,
    isSecure: boolean = true
  ): Promise<DownloadResult> {
    const destinationDir = getJobTempDir(jobId);
    const sanitizedJobId = (jobId || 'job').replace(/[^a-zA-Z0-9_-]/g, '_');
    const targetPath = path.join(destinationDir, `doc-${sanitizedJobId}.pdf`);

    // Ensure path containment to prevent directory traversal attacks
    if (!path.resolve(targetPath).startsWith(path.resolve(destinationDir))) {
      throw new Error(`Path traversal attempt detected for jobId: ${jobId}`);
    }

    this.secureTempManager.registerActiveFile(targetPath);

    console.log(
      `[PdfDownloader] Streaming document for job ${jobId} to isolated dir: ${destinationDir}`
    );

    // Resolve the effective URL — refreshing from the backend if the stored URL lacks a token
    const effectiveUrl = await this.resolveDownloadUrl(jobId, pdfUrl);

    await this.streamToFile(effectiveUrl, targetPath);

    const actualChecksum = this.hashStream.digest('hex');
    const stats = fs.statSync(targetPath);

    console.log(
      `[PdfDownloader] Stream download completed for job ${jobId} (${stats.size} bytes). SHA-256: ${actualChecksum}`
    );

    // Verify checksum if provided and not empty/'auto'
    if (expectedChecksum && expectedChecksum !== 'auto' && actualChecksum.toLowerCase() !== expectedChecksum.toLowerCase()) {
      await this.cleanup(targetPath, isSecure);
      throw new Error(
        `Checksum mismatch for job ${jobId}! Expected: ${expectedChecksum}, Actual: ${actualChecksum}`
      );
    }

    return {
      filePath: targetPath,
      checksum: actualChecksum,
      fileSize: stats.size
    };
  }

  /**
   * Resolves the effective download URL.
   *
   * Firebase Storage URLs without a `&token=` param return 403 for private files.
   * If the stored URL has no token, we pre-emptively call the local backend to
   * get a fresh token-bearing URL before attempting the download.
   */
  private async resolveDownloadUrl(jobId: string, originalUrl: string): Promise<string> {
    // If the URL already carries a token, use it directly
    if (originalUrl.includes('&token=') || originalUrl.includes('?token=')) {
      return originalUrl;
    }

    // URL has no token — it will 403. Refresh via the local backend first.
    console.log(`[PdfDownloader] Job ${jobId}: URL has no download token — refreshing via backend...`);
    const refreshed = await this.refreshUrlFromBackend(jobId, originalUrl);
    if (refreshed) {
      console.log(`[PdfDownloader] Job ${jobId}: Got fresh token-bearing URL from backend.`);
      return refreshed;
    }

    // Backend unreachable — attempt original URL anyway (may work if bucket rules allow reads)
    console.warn(`[PdfDownloader] Job ${jobId}: Could not refresh URL; attempting original URL.`);
    return originalUrl;
  }

  /**
   * Calls the local backend's GET /api/agent/download-url endpoint to obtain a
   * fresh, token-bearing Firebase Storage download URL.
   * Returns null if the backend is unreachable or returns an error.
   */
  private async refreshUrlFromBackend(jobId: string, originalUrl: string): Promise<string | null> {
    try {
      // Lazy-import ConfigManager to avoid circular deps at module load time
      const { ConfigManager } = await import('./config');
      const config = ConfigManager.getInstance().get();
      const backendUrl = (config.backendApiUrl || 'http://localhost:3000').replace(/\/$/, '');
      const authToken = config.authToken || '';

      // Extract the Firebase Storage path from the URL
      // Format: .../o/ENCODED_PATH?alt=media  → decoded: printit/uploads/file.pdf
      const storagePath = this.extractStoragePath(originalUrl);
      if (!storagePath) {
        console.warn(`[PdfDownloader] Job ${jobId}: Cannot parse storage path from: ${originalUrl}`);
        return null;
      }

      const resp = await axios.get(`${backendUrl}/api/agent/download-url`, {
        params: { path: storagePath },
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        timeout: 10000
      });

      return (resp.data && resp.data.url) ? resp.data.url : null;
    } catch (err: any) {
      console.warn(`[PdfDownloader] Job ${jobId}: Backend URL refresh failed:`, err?.message || err);
      return null;
    }
  }

  /**
   * Extracts the Firebase Storage object path from a Firebase Storage download URL.
   * e.g. ".../o/printit%2Fuploads%2Ffile.pdf?alt=media" → "printit/uploads/file.pdf"
   */
  private extractStoragePath(url: string): string | null {
    try {
      const match = url.match(/\/o\/([^?#]+)/);
      if (match && match[1]) {
        return decodeURIComponent(match[1]);
      }
    } catch { /* ignore */ }
    return null;
  }

  /**
   * Streams a URL directly to a local file, updating the SHA-256 hash in-flight.
   * Keeps RAM usage near zero — no full-file buffering.
   */
  private async streamToFile(url: string, targetPath: string): Promise<void> {
    // Reset hash for this download
    this.hashStream = crypto.createHash('sha256');

    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      timeout: 45000 // 45s for large files on slow shop networks
    });

    const fileStream = fs.createWriteStream(targetPath);

    await new Promise<void>((resolve, reject) => {
      response.data.on('data', (chunk: Buffer) => {
        this.hashStream.update(chunk);
      });

      response.data.pipe(fileStream);

      fileStream.on('finish', () => resolve());
      fileStream.on('error', (err) => reject(err));
      response.data.on('error', (err: unknown) => reject(err));
    });
  }

  /**
   * Guaranteed cleanup with existence verification.
   * Cleans up file and its isolated job directory.
   */
  public async cleanup(filePath: string, _isSecure: boolean = true): Promise<void> {
    try {
      await this.secureTempManager.deleteFileWithVerification(filePath);
      console.log(`[PdfDownloader] Privacy cleanup verified: ${filePath}`);
    } catch (err) {
      console.warn(`[PdfDownloader] Failed to delete temp file ${filePath}:`, err);
    }
  }
}
