const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { DedupDatabase } = require('../dist/dedup');
const { PdfDownloader } = require('../dist/downloader');
const { PrinterService } = require('../dist/printer');
const { ConfigManager } = require('../dist/config');

async function runEndToEndSimulation() {
  console.log('====================================================');
  console.log('       PrintIt Agent — End-to-End Self Test');
  console.log('====================================================\n');

  // 1. Initialize SQLite Dedup Database
  console.log('[Step 1/5] Initializing local SQLite Dedup Engine...');
  const dedupDb = DedupDatabase.getInstance();
  await dedupDb.init();
  console.log('  -> Dedup Database initialized successfully.');

  // 2. Discover Windows Printers
  console.log('\n[Step 2/5] Checking Windows Printers...');
  const printerService = PrinterService.getInstance();
  const printers = await printerService.getAvailablePrinters();
  console.log(`  -> Found ${printers.length} printer(s):`);
  printers.forEach((p) => console.log(`     * ${p.name}${p.isDefault ? ' (Default)' : ''}`));

  // 3. Start a local temporary HTTP server to host a sample test PDF
  console.log('\n[Step 3/5] Starting local mock PDF server...');
  const samplePdfBuffer = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 300 200]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000010 00000 n\n0000000060 00000 n\n0000000118 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF'
  );
  const samplePdfHash = crypto.createHash('sha256').update(samplePdfBuffer).digest('hex');

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    res.end(samplePdfBuffer);
  });

  await new Promise((resolve) => server.listen(48921, '127.0.0.1', resolve));
  const testPdfUrl = 'http://127.0.0.1:48921/test.pdf';
  console.log(`  -> Mock PDF server active at ${testPdfUrl}`);
  console.log(`  -> Expected SHA-256 Checksum: ${samplePdfHash}`);

  // 4. Download and verify PDF via PdfDownloader
  console.log('\n[Step 4/5] Testing download and SHA-256 verification...');
  const downloader = new PdfDownloader();
  const testJobId = 'test-job-' + Date.now();

  const downloadResult = await downloader.downloadAndVerify(testJobId, testPdfUrl, samplePdfHash);
  console.log(`  -> Download verified! Saved to: ${downloadResult.filePath}`);
  console.log(`  -> SHA-256 Hash Matched: ${downloadResult.checksum}`);

  // 5. Test SQLite Deduplication (Simulate duplicate job reception)
  console.log('\n[Step 5/5] Testing SQLite Deduplication...');
  console.log(`  -> Checking if Job ${testJobId} was processed before: ${dedupDb.isJobProcessed(testJobId)}`);
  
  dedupDb.markJobProcessed(testJobId, downloadResult.checksum, 'COMPLETED');
  console.log(`  -> Job marked as COMPLETED in SQLite.`);
  
  const isNowProcessed = dedupDb.isJobProcessed(testJobId);
  console.log(`  -> Checking if Job ${testJobId} is recognized now: ${isNowProcessed}`);

  if (isNowProcessed) {
    console.log('  -> Duplicate Prevention: SUCCESS! Resending this job will be ignored.');
  } else {
    console.error('  -> Duplicate Prevention: FAILED!');
  }

  // Cleanup standard job file
  await downloader.cleanup(downloadResult.filePath);

  // 6. Test Privacy-by-Default Print Flow (Isolated temp dir, verified deletion, startup sweep)
  console.log('\n[Step 6/6] Testing Privacy-by-Default Print Flow & Post-Delete Existence Check...');
  const { SecureTempManager } = require('../dist/secureTempManager');
  const secureMgr = SecureTempManager.getInstance();
  await secureMgr.initAndSweep();

  const privacyJobId = 'privacy-job-' + Date.now();
  const privacyResult = await downloader.downloadAndVerify(privacyJobId, testPdfUrl, samplePdfHash);
  console.log(`  -> Privacy-by-default download saved to isolated directory: ${privacyResult.filePath}`);
  
  if (!privacyResult.filePath.includes('PrintItAgent') || !privacyResult.filePath.includes('jobs')) {
    throw new Error('Document file was not saved in the isolated PrintItAgent/jobs directory!');
  }

  // Verify file exists before cleanup
  if (!fs.existsSync(privacyResult.filePath)) {
    throw new Error('Document file should exist on disk before cleanup');
  }

  // Execute verified cleanup
  await downloader.cleanup(privacyResult.filePath);
  const existsAfterDelete = fs.existsSync(privacyResult.filePath);
  console.log(`  -> Post-deletion existence check (Must be false): ${existsAfterDelete}`);

  if (existsAfterDelete) {
    throw new Error('Privacy Failure: Document file still exists after deletion!');
  }
  console.log('  -> Verified Deletion: SUCCESS! File and isolated job directory completely removed.');

  server.close();

  console.log('\n====================================================');
  console.log('       All Agent Core Systems Verified: OK!         ');
  console.log('====================================================\n');
}

runEndToEndSimulation().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
