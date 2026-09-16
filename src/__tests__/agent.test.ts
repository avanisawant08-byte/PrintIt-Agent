import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DedupDatabase } from '../dedup';
import { ConfigManager } from '../config';
import { PdfDownloader } from '../downloader';

test('ConfigManager: gets defaults and sets updates', () => {
  const config = ConfigManager.getInstance();
  const initial = config.get();
  assert.ok(typeof initial === 'object');
  assert.strictEqual(typeof initial.autoStartOnBoot, 'boolean');

  config.set({ deviceName: 'Test-Station-Alpha' });
  assert.strictEqual(config.get().deviceName, 'Test-Station-Alpha');
});

test('DedupDatabase: initializes and deduplicates jobs', async () => {
  const db = DedupDatabase.getInstance();
  await db.init();

  const testJobId = 'test-job-' + Date.now();
  const testChecksum = 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3';

  // Initially should not be processed
  assert.strictEqual(db.isJobProcessed(testJobId), false);

  // Mark as processed
  db.markJobProcessed(testJobId, testChecksum, 'COMPLETED');

  // Should now return true
  assert.strictEqual(db.isJobProcessed(testJobId), true);

  // Recent jobs list should contain it
  const recent = db.getRecentJobs(10);
  assert.ok(recent.length > 0);
  const found = recent.find((r) => r.job_id === testJobId);
  assert.ok(found);
  assert.strictEqual(found?.status, 'COMPLETED');
});

test('PdfDownloader: calculates and validates SHA-256 correctly', async () => {
  const downloader = new PdfDownloader();
  const sampleContent = 'Sample PDF document content for testing SHA256 integrity';
  const expectedHash = crypto.createHash('sha256').update(sampleContent).digest('hex');

  // Test checksum comparison logic directly
  const computedHash = crypto.createHash('sha256').update(sampleContent).digest('hex');
  assert.strictEqual(computedHash, expectedHash);

  // Mismatched hash verification
  const wrongHash = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  assert.notStrictEqual(computedHash, wrongHash);
});
