import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';
import { getJobTempDir } from './paths';
import { SecureTempManager } from './secureTempManager';
import { logger } from './logger';

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

    logger.info(
      'PdfDownloader',
      `Streaming document for job ${jobId} to isolated dir: ${destinationDir}`
    );

    // Resolve the effective URL — refreshing from the backend if the stored URL lacks a token
    let effectiveUrl = await this.resolveDownloadUrl(jobId, pdfUrl);

    // Validate effective URL to prevent SSRF and unsafe protocols
    this.validateDownloadUrl(effectiveUrl);

    try {
      await this.streamToFile(effectiveUrl, targetPath);
    } catch (err: any) {
      const statusCode = err?.response?.status;
      const isAuthOrForbidden = statusCode === 401 || statusCode === 403;

      if (isAuthOrForbidden) {
        logger.warn(
          'PdfDownloader',
          `Job ${jobId}: Download stream returned ${statusCode} (token expired or unauthorized). Attempting backend signed URL refresh...`
        );
        const refreshedUrl = await this.refreshUrlFromBackend(jobId, pdfUrl);
        if (refreshedUrl && refreshedUrl !== effectiveUrl) {
          logger.info('PdfDownloader', `Job ${jobId}: Retrying download with refreshed signed URL...`);
          this.validateDownloadUrl(refreshedUrl);
          effectiveUrl = refreshedUrl;
          await this.streamToFile(effectiveUrl, targetPath);
        } else {
          // Clean up partial file before throwing
          await this.cleanup(targetPath, isSecure);
          throw new Error(
            `Download failed for job ${jobId} with HTTP ${statusCode}. Backend could not provide an authorized download URL.`
          );
        }
      } else {
        await this.cleanup(targetPath, isSecure);
        throw err;
      }
    }

    const actualChecksum = this.hashStream.digest('hex');
    const stats = fs.statSync(targetPath);

    // Security Hardening: Enforce maximum file size constraint (100MB)
    const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
    if (stats.size > MAX_FILE_SIZE_BYTES) {
      await this.cleanup(targetPath, isSecure);
      throw new Error(
        `Security Violation: Downloaded file for job ${jobId} (${stats.size} bytes) exceeds maximum allowed limit of 100MB.`
      );
    }

    // Security Hardening: Verify file signature / magic bytes to prevent renamed malicious files
    if (!this.validateFileSignature(targetPath)) {
      await this.cleanup(targetPath, isSecure);
      throw new Error(
        `Security Violation: Untrusted file signature detected for job ${jobId}. Only authenticated PDF, PNG, and JPG documents are permitted.`
      );
    }

    logger.info(
      'PdfDownloader',
      `Stream download completed for job ${jobId} (${stats.size} bytes). SHA-256: ${actualChecksum}`
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
   * Validates document magic bytes (PDF, PNG, JPG) to block renamed executables or scripts
   */
  public validateFileSignature(filePath: string): boolean {
    try {
      const buffer = Buffer.alloc(12);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, 12, 0);
      fs.closeSync(fd);

      // PDF: %PDF- (0x25 0x50 0x44 0x46 0x2d)
      const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46 && buffer[4] === 0x2d;
      // PNG: 0x89 0x50 0x4e 0x47 0x0d 0x0a 0x1a 0x0a
      const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
                    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a;
      // JPG/JPEG: 0xff 0xd8 0xff
      const isJpg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

      return isPdf || isPng || isJpg;
    } catch (err) {
      logger.error('PdfDownloader', `Failed to read file magic bytes for signature check: ${filePath}`, err);
      return false;
    }
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
    logger.info('PdfDownloader', `Job ${jobId}: URL has no download token — refreshing via backend...`);
    const refreshed = await this.refreshUrlFromBackend(jobId, originalUrl);
    if (refreshed) {
      logger.info('PdfDownloader', `Job ${jobId}: Got fresh token-bearing URL from backend.`);
      return refreshed;
    }

    // Backend unreachable — attempt original URL anyway (may work if bucket rules allow reads)
    logger.warn('PdfDownloader', `Job ${jobId}: Could not refresh URL; attempting original URL.`);
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
        logger.warn('PdfDownloader', `Job ${jobId}: Cannot parse storage path from URL`);
        return null;
      }

      const resp = await axios.get(`${backendUrl}/api/agent/download-url`, {
        params: { path: storagePath },
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        timeout: 10000
      });

      return (resp.data && resp.data.url) ? resp.data.url : null;
    } catch (err: any) {
      logger.warn('PdfDownloader', `Job ${jobId}: Backend URL refresh failed: ${err?.message || err}`);
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
      timeout: 45000, // 45s for large files on slow shop networks
      validateStatus: null // Don't throw on non-2xx — we handle it below
    });

    // Reject non-2xx responses before writing anything to disk.
    // Without this check, error bodies (e.g. a 15-byte "Access Denied" string)
    // get streamed into the file and produce corrupt/blank PDFs.
    if (response.status < 200 || response.status >= 300) {
      // Consume and discard the response body to free the socket
      response.data.resume();
      const err: any = new Error(`HTTP ${response.status} downloading file`);
      err.response = response;
      throw err;
    }

    const fileStream = fs.createWriteStream(targetPath);

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      response.data.on('data', (chunk: Buffer) => {
        this.hashStream.update(chunk);
      });

      response.data.pipe(fileStream);

      fileStream.on('finish', () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });

      fileStream.on('error', (err) => {
        if (!settled) {
          settled = true;
          fileStream.destroy();
          reject(err);
        }
      });

      response.data.on('error', (err: unknown) => {
        if (!settled) {
          settled = true;
          fileStream.destroy();
          reject(err);
        }
      });
    });
  }

  /**
   * Guaranteed cleanup with existence verification.
   * Cleans up file and its isolated job directory.
   */
  public async cleanup(filePath: string, _isSecure: boolean = true): Promise<void> {
    try {
      await this.secureTempManager.deleteFileWithVerification(filePath);
      logger.info('PdfDownloader', `Privacy cleanup verified: ${path.basename(filePath)}`);
    } catch (err) {
      logger.warn('PdfDownloader', `Failed to delete temp file ${path.basename(filePath)}:`, err);
    }
  }

  /**
   * Validates a document URL against SSRF, metadata service endpoints, and unsafe protocols.
   */
  public validateDownloadUrl(url: string): void {
    if (!url || typeof url !== 'string') {
      throw new Error('Download URL must be a non-empty string');
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Malformed download URL: "${url}"`);
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`Forbidden protocol "${parsed.protocol}". Only HTTP/HTTPS allowed.`);
    }

    const host = parsed.hostname.toLowerCase();
    const isLoopback = host === 'localhost' || host === '127.0.0.1';

    // Enforce HTTPS in production unless connecting to local test harness
    if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:' && !isLoopback) {
      throw new Error(`Security Violation: Unencrypted HTTP download rejected in production (${host}). HTTPS is required.`);
    }

    // Block cloud instance metadata endpoints (AWS, GCP, Azure, Oracle, Alibaba)
    const blockedHosts = [
      '169.254.169.254',
      'metadata.google.internal',
      'metadata.internal',
      '100.100.100.200',
      'instance-data'
    ];

    if (blockedHosts.includes(host) || host.endsWith('.internal')) {
      throw new Error(`SSRF Block: Access to internal cloud metadata endpoint is prohibited (${host})`);
    }
  }
}
