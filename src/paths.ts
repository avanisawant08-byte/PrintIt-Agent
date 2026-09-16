import path from 'path';
import fs from 'fs';

/**
 * Safely resolves the user data directory in both Electron runtime and Node CLI / test runners.
 */
export function getUserDataDir(): string {
  try {
    // Dynamic require so non-Electron test environments don't fail on module load
    const electron = require('electron');
    if (electron && electron.app && typeof electron.app.getPath === 'function') {
      return electron.app.getPath('userData');
    }
  } catch {
    // Not running inside Electron app context
  }

  const fallbackDir = path.join(process.cwd(), '.agent-data');
  if (!fs.existsSync(fallbackDir)) {
    fs.mkdirSync(fallbackDir, { recursive: true });
  }
  return fallbackDir;
}

/**
 * Safely resolves the temporary files directory for downloaded PDFs.
 */
export function getTempDir(): string {
  try {
    const electron = require('electron');
    if (electron && electron.app && typeof electron.app.getPath === 'function') {
      return electron.app.getPath('temp');
    }
  } catch {
    // Fallback
  }

  const fallbackTemp = path.join(process.cwd(), '.temp');
  if (!fs.existsSync(fallbackTemp)) {
    fs.mkdirSync(fallbackTemp, { recursive: true });
  }
  return fallbackTemp;
}

/**
 * Safely resolves the dedicated PrintIt temporary base directory.
 * Standardizes to %TEMP%\PrintItAgent
 */
export function getPrintItTempBaseDir(): string {
  const baseTemp = getTempDir();
  const agentTempDir = path.join(baseTemp, 'PrintItAgent');
  if (!fs.existsSync(agentTempDir)) {
    fs.mkdirSync(agentTempDir, { recursive: true });
  }
  return agentTempDir;
}

/**
 * Returns the base jobs directory: %TEMP%\PrintItAgent\jobs\
 */
export function getJobsBaseDir(): string {
  const baseDir = getPrintItTempBaseDir();
  const jobsDir = path.join(baseDir, 'jobs');
  if (!fs.existsSync(jobsDir)) {
    fs.mkdirSync(jobsDir, { recursive: true });
  }
  return jobsDir;
}

/**
 * Returns the isolated per-job temporary directory: %TEMP%\PrintItAgent\jobs\<jobId>\
 */
export function getJobTempDir(jobId: string): string {
  const sanitizedJobId = (jobId || 'job').replace(/[^a-zA-Z0-9_-]/g, '_');
  const jobDir = path.join(getJobsBaseDir(), sanitizedJobId);
  if (!fs.existsSync(jobDir)) {
    fs.mkdirSync(jobDir, { recursive: true });
  }
  return jobDir;
}

/**
 * Backwards compatibility helper for existing references to secure temp dir.
 * Points to the PrintItAgent jobs base directory.
 */
export function getSecureTempDir(): string {
  return getJobsBaseDir();
}

