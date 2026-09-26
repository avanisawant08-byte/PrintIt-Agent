import fs from 'fs';
import path from 'path';
import initSqlJs, { Database } from 'sql.js';
import { ProcessedJobRecord, PrintJobStatus } from './types';
import { getUserDataDir } from './paths';

export class DedupDatabase {
  private static instance: DedupDatabase;
  private db: Database | null = null;
  private dbFilePath: string;
  private isInitialized = false;

  private constructor() {
    const userDataDir = getUserDataDir();
    this.dbFilePath = path.join(userDataDir, 'dedup.db');
  }

  public static getInstance(): DedupDatabase {
    if (!DedupDatabase.instance) {
      DedupDatabase.instance = new DedupDatabase();
    }
    return DedupDatabase.instance;
  }

  public async init(): Promise<void> {
    if (this.isInitialized && this.db) {
      return;
    }

    // Initialize sql.js WebAssembly engine with robust multi-tier path resolution
    const SQL = await initSqlJs({
      locateFile: (file) => {
        const candidatePaths = [
          path.join(__dirname, file),
          path.join(__dirname, '..', 'dist', file),
          path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file),
          path.join(process.resourcesPath || '', file),
          path.join(process.resourcesPath || '', 'dist', file),
          path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', file)
        ];

        for (const candidate of candidatePaths) {
          if (candidate && fs.existsSync(candidate)) {
            return candidate;
          }
        }
        return path.join(process.resourcesPath || __dirname, file);
      }
    });

    if (fs.existsSync(this.dbFilePath)) {
      try {
        const fileBuffer = fs.readFileSync(this.dbFilePath);
        this.db = new SQL.Database(fileBuffer);
      } catch (err) {
        console.error('[DedupDatabase] Corrupted DB file, creating fresh one:', err);
        this.db = new SQL.Database();
      }
    } else {
      this.db = new SQL.Database();
    }

    // Create processed_jobs table if it does not exist
    this.db.run(`
      CREATE TABLE IF NOT EXISTS processed_jobs (
        job_id TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        printed_at INTEGER NOT NULL,
        status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_processed_printed_at ON processed_jobs (printed_at);
    `);

    // Migration guard: ensure order_id and file_index exist across all DB instances
    try {
      this.db.run("ALTER TABLE processed_jobs ADD COLUMN order_id TEXT;");
    } catch {}
    try {
      this.db.run("ALTER TABLE processed_jobs ADD COLUMN file_index INTEGER DEFAULT 0;");
    } catch {}
    try {
      this.db.run("CREATE INDEX IF NOT EXISTS idx_processed_order_id ON processed_jobs (order_id);");
    } catch {}

    this.persist();
    this.isInitialized = true;
    console.log('[DedupDatabase] SQLite dedup database initialized at:', this.dbFilePath);
  }

  public isJobProcessed(jobId: string): boolean {
    if (!this.db) return false;

    // Only treat COMPLETED jobs as fully processed (skip them).
    // FAILED jobs should be retried — do NOT skip them.
    const stmt = this.db.prepare(
      "SELECT job_id FROM processed_jobs WHERE job_id = :id AND status = 'COMPLETED'"
    );
    stmt.bind({ ':id': jobId });

    const hasRow = stmt.step();
    stmt.free();
    return hasRow;
  }

  public isFileInOrderProcessed(orderId: string, fileIndex: number): boolean {
    if (!this.db || !orderId) return false;
    const stmt = this.db.prepare(
      "SELECT job_id FROM processed_jobs WHERE order_id = :order_id AND file_index = :file_index AND status = 'COMPLETED'"
    );
    stmt.bind({ ':order_id': orderId, ':file_index': fileIndex });
    const hasRow = stmt.step();
    stmt.free();
    return hasRow;
  }

  public getCompletedFilesForOrder(orderId: string): string[] {
    if (!this.db || !orderId) return [];
    const stmt = this.db.prepare(
      "SELECT job_id FROM processed_jobs WHERE order_id = :order_id AND status = 'COMPLETED'"
    );
    stmt.bind({ ':order_id': orderId });
    const jobIds: string[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (row.job_id) jobIds.push(String(row.job_id));
    }
    stmt.free();
    return jobIds;
  }

  public markJobProcessed(
    jobId: string,
    checksum: string,
    status: PrintJobStatus,
    orderId?: string,
    fileIndex: number = 0
  ): void {
    if (!this.db) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO processed_jobs (job_id, checksum, printed_at, status, order_id, file_index)
      VALUES (:job_id, :checksum, :printed_at, :status, :order_id, :file_index)
    `);

    stmt.run({
      ':job_id': jobId,
      ':checksum': checksum || '',
      ':printed_at': Date.now(),
      ':status': status,
      ':order_id': orderId || null,
      ':file_index': fileIndex
    });
    stmt.free();

    this.persist();
  }

  public getRecentJobs(limit = 20): ProcessedJobRecord[] {
    if (!this.db) return [];

    const stmt = this.db.prepare(`
      SELECT job_id, checksum, printed_at, status, order_id, file_index
      FROM processed_jobs
      ORDER BY printed_at DESC
      LIMIT :limit
    `);
    stmt.bind({ ':limit': limit });

    const results: any[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push(row);
    }
    stmt.free();
    return results as ProcessedJobRecord[];
  }

  private persist(): void {
    if (!this.db) return;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbFilePath, buffer);
    } catch (err) {
      console.error('[DedupDatabase] Failed to write SQLite file to disk:', err);
    }
  }
}
