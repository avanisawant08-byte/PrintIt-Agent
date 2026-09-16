import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { SecureTempManager } from '../secureTempManager';
import { PdfDownloader } from '../downloader';
import { getSecureTempDir, getTempDir, getJobTempDir, getJobsBaseDir } from '../paths';

test('SecureTempManager: initializes directory and creates desktop.ini for thumbnail suppression', async () => {
  const manager = SecureTempManager.getInstance();
  const res = await manager.initAndSweep();

  assert.ok(Array.isArray(res.purgedFiles));
  assert.ok(Array.isArray(res.errors));

  const dir = manager.getDirectory();
  assert.ok(fs.existsSync(dir), 'Secure directory must exist');

  const desktopIni = path.join(dir, 'desktop.ini');
  assert.ok(fs.existsSync(desktopIni), 'desktop.ini must exist in secure temp dir');

  const iniContent = fs.readFileSync(desktopIni, 'utf8');
  assert.ok(iniContent.includes('NoThumbnailCache=1'), 'desktop.ini must set NoThumbnailCache=1');
  assert.ok(iniContent.includes('FolderType=Generic'), 'desktop.ini must specify FolderType=Generic');
});

test('SecureTempManager: crash recovery startup sweep removes orphaned unlinked files', async () => {
  const manager = SecureTempManager.getInstance();
  const dir = manager.getDirectory();

  // Simulate leftover orphaned files and folders from a prior crash or power loss
  const orphanFile1 = path.join(dir, `crash-orphan-${Date.now()}-1.pdf`);
  const orphanJobDir = path.join(dir, `crash-job-${Date.now()}`);
  fs.mkdirSync(orphanJobDir, { recursive: true });
  const orphanFile2 = path.join(orphanJobDir, `doc-crash-job.pdf`);

  fs.writeFileSync(orphanFile1, 'Dummy sensitive PDF contents 1');
  fs.writeFileSync(orphanFile2, 'Dummy sensitive PDF contents 2');

  assert.ok(fs.existsSync(orphanFile1), 'Orphan 1 should exist prior to sweep');
  assert.ok(fs.existsSync(orphanFile2), 'Orphan 2 inside nested job dir should exist prior to sweep');

  // Execute startup sweep
  const result = await manager.startupSweep();

  assert.strictEqual(result.errors.length, 0, 'Sweep should complete with zero errors');
  assert.ok(result.purgedFiles.includes(orphanFile1), 'Orphan 1 should be listed in purgedFiles');
  assert.ok(result.purgedFiles.includes(orphanFile2), 'Orphan 2 should be listed in purgedFiles');

  // Verify post-sweep existence
  assert.strictEqual(fs.existsSync(orphanFile1), false, 'Orphan 1 must not exist on disk after sweep');
  assert.strictEqual(fs.existsSync(orphanFile2), false, 'Orphan 2 must not exist on disk after sweep');
  assert.strictEqual(fs.existsSync(orphanJobDir), false, 'Orphaned job dir must be removed after sweep');
});

test('SecureTempManager: deleteFileWithVerification unlinks file and passes existence check', async () => {
  const manager = SecureTempManager.getInstance();
  const dir = manager.getDirectory();
  const testFile = path.join(dir, `delete-test-${Date.now()}.pdf`);

  fs.writeFileSync(testFile, 'Sensitive test document data');
  assert.ok(fs.existsSync(testFile), 'Test file must exist before delete');

  const deleted = await manager.deleteFileWithVerification(testFile);
  assert.strictEqual(deleted, true, 'deleteFileWithVerification must return true');
  assert.strictEqual(fs.existsSync(testFile), false, 'File must not exist on disk');

  // Calling on already deleted file should return true idempotently
  const deletedAgain = await manager.deleteFileWithVerification(testFile);
  assert.strictEqual(deletedAgain, true, 'Deleting already missing file must return true');
});

test('SecureTempManager: active in-flight jobs are protected from sweep', async () => {
  const manager = SecureTempManager.getInstance();
  const dir = manager.getDirectory();
  const activeFile = path.join(dir, `active-in-flight-${Date.now()}.pdf`);

  fs.writeFileSync(activeFile, 'In-flight spooled document data');
  manager.registerActiveFile(activeFile);

  // Sweep should NOT delete this active file
  const sweepRes = await manager.startupSweep();
  assert.ok(!sweepRes.purgedFiles.includes(activeFile), 'Active file must not be purged by sweep');
  assert.ok(fs.existsSync(activeFile), 'Active file must remain intact while in flight');

  // Unregister and delete
  manager.unregisterActiveFile(activeFile);
  await manager.deleteFileWithVerification(activeFile);
  assert.strictEqual(fs.existsSync(activeFile), false);
});

test('PdfDownloader: resolves isolated per-job destination paths cleanly', async () => {
  const downloader = new PdfDownloader();
  const testJobId = 'job-test-isolation-123';
  const jobDir = getJobTempDir(testJobId);
  const jobsBaseDir = getJobsBaseDir();

  assert.ok(fs.existsSync(jobDir), 'Per-job temporary directory must exist');
  assert.ok(fs.existsSync(jobsBaseDir), 'Base jobs directory must exist');
  assert.ok(jobDir.startsWith(jobsBaseDir), 'Job dir must reside inside base jobs directory');
  assert.ok(jobDir.endsWith('job-test-isolation-123'), 'Job dir path should end with sanitized job ID');

  // Verify that cleanup removes the file and the job directory
  const testFile = path.join(jobDir, `doc-${testJobId}.pdf`);
  fs.writeFileSync(testFile, 'dummy payload');
  assert.ok(fs.existsSync(testFile));

  await downloader.cleanup(testFile);
  assert.strictEqual(fs.existsSync(testFile), false, 'Document file must be deleted');
  assert.strictEqual(fs.existsSync(jobDir), false, 'Isolated job directory must be deleted when empty');
});
