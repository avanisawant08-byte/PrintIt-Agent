import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PdfDownloader } from '../downloader';
import { PrinterService } from '../printer';

test('Security: PdfDownloader blocks SSRF and cloud metadata endpoints', () => {
  const downloader = new PdfDownloader();

  // Test cloud metadata IPs & hostnames
  assert.throws(
    () => downloader.validateDownloadUrl('http://169.254.169.254/latest/meta-data/'),
    /SSRF Block/
  );

  assert.throws(
    () => downloader.validateDownloadUrl('http://metadata.google.internal/computeMetadata/v1/'),
    /SSRF Block/
  );

  assert.throws(
    () => downloader.validateDownloadUrl('http://100.100.100.200/latest/meta-data/'),
    /SSRF Block/
  );

  // Test forbidden protocols
  assert.throws(
    () => downloader.validateDownloadUrl('file:///C:/Windows/System32/cmd.exe'),
    /Forbidden protocol/
  );

  assert.throws(
    () => downloader.validateDownloadUrl('ftp://example.com/file.pdf'),
    /Forbidden protocol/
  );

  assert.throws(
    () => downloader.validateDownloadUrl('javascript:alert(1)'),
    /Forbidden protocol/
  );

  // Legitimate URLs pass
  assert.doesNotThrow(() => {
    downloader.validateDownloadUrl('https://firebasestorage.googleapis.com/v0/b/app/doc.pdf?alt=media&token=123');
  });

  assert.doesNotThrow(() => {
    downloader.validateDownloadUrl('https://s3.amazonaws.com/my-bucket/doc.pdf');
  });
});

test('Security: PrinterService rejects malicious printer names with command injection characters', async () => {
  const printerService = PrinterService.getInstance();

  await assert.rejects(
    async () => {
      await printerService.printPdf('sample.pdf', 'HP LaserJet & calc.exe', 1);
    },
    /Security Violation: Illegal characters detected in printer name/
  );

  await assert.rejects(
    async () => {
      await printerService.printPdf('sample.pdf', 'Printer | whoami', 1);
    },
    /Security Violation: Illegal characters detected in printer name/
  );

  await assert.rejects(
    async () => {
      await printerService.printPdf('sample.pdf', 'Printer; rm -rf /', 1);
    },
    /Security Violation: Illegal characters detected in printer name/
  );
});

test('Security: PrinterService ignores malicious page range injection', async () => {
  const printerService = PrinterService.getInstance();
  const fs = require('fs');
  const path = require('path');
  const dummyPath = path.join(__dirname, 'dummy-security.pdf');
  fs.writeFileSync(dummyPath, '%PDF-1.4 sample');

  try {
    // Virtual printer prints without error and ignores/sanitizes invalid range
    const result = await printerService.printPdf(
      dummyPath,
      'Virtual Test Printer (Save to Disk)',
      1,
      { page_range: '1-3; malicious' }
    );
    assert.ok(result);
  } finally {
    if (fs.existsSync(dummyPath)) fs.unlinkSync(dummyPath);
  }
});

test('Security: PdfDownloader validates magic byte signatures and rejects disguised files', () => {
  const downloader = new PdfDownloader();
  const fs = require('fs');
  const path = require('path');

  const validPdfPath = path.join(__dirname, 'valid-magic.pdf');
  const validPngPath = path.join(__dirname, 'valid-magic.png');
  const validJpgPath = path.join(__dirname, 'valid-magic.jpg');
  const fakePdfPath = path.join(__dirname, 'malicious-disguised.pdf');

  try {
    // Valid PDF signature (%PDF-)
    fs.writeFileSync(validPdfPath, Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]));
    assert.strictEqual(downloader.validateFileSignature(validPdfPath), true);

    // Valid PNG signature (0x89 50 4E 47 0D 0A 1A 0A)
    fs.writeFileSync(validPngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]));
    assert.strictEqual(downloader.validateFileSignature(validPngPath), true);

    // Valid JPG signature (0xFF D8 FF)
    fs.writeFileSync(validJpgPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]));
    assert.strictEqual(downloader.validateFileSignature(validJpgPath), true);

    // Malicious fake PDF (contains text/script instead of PDF magic bytes)
    fs.writeFileSync(fakePdfPath, Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00 malicious PE executable'));
    assert.strictEqual(downloader.validateFileSignature(fakePdfPath), false);
  } finally {
    [validPdfPath, validPngPath, validJpgPath, fakePdfPath].forEach((p) => {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
  }
});

test('Security: Logger redacts tokens, JWTs, query credentials, and database passwords', () => {
  const { logger } = require('../logger');

  const rawTokenMsg = 'Device token: agent-jwt-4b6e9dfd-c2da-4196-a265-2a2a2d5a8b0a-1b298283e5c8f4fa';
  const sanitizedToken = logger.sanitize(rawTokenMsg);
  assert.ok(!sanitizedToken.includes('1b298283e5c8f4fa'));
  assert.ok(sanitizedToken.includes('[REDACTED_AGENT_TOKEN]'));

  const rawUrlMsg = 'Downloading https://firebasestorage.googleapis.com/v0/b/app/doc.pdf?alt=media&token=e5f686e2-d43c-49e1-8b92-630ee27b1516';
  const sanitizedUrl = logger.sanitize(rawUrlMsg);
  assert.ok(!sanitizedUrl.includes('e5f686e2-d43c-49e1-8b92-630ee27b1516'));
  assert.ok(sanitizedUrl.includes('&token=[REDACTED]'));

  const rawJwtMsg = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSJ9.signature12345';
  const sanitizedJwt = logger.sanitize(rawJwtMsg);
  assert.ok(!sanitizedJwt.includes('signature12345'));
  assert.ok(sanitizedJwt.includes('Bearer [REDACTED]'));
});

test('Printing: Deterministic B&W vs Color printer resolution', async () => {
  const printerService = PrinterService.getInstance();
  const mockConfig: any = {
    selectedPrinter: 'Virtual Test Printer (Save to Disk)',
    selectedPrinterBw: 'Virtual Test Printer (Save to Disk)',
    selectedPrinterColor: 'Virtual Test Printer (Save to Disk)'
  };

  // Color job selects color printer
  const colorPrinter = await printerService.resolveTargetPrinter({ color: 'color' }, mockConfig);
  assert.strictEqual(colorPrinter, 'Virtual Test Printer (Save to Disk)');

  // B&W job selects B&W printer
  const bwPrinter = await printerService.resolveTargetPrinter({ color: 'bw' }, mockConfig);
  assert.strictEqual(bwPrinter, 'Virtual Test Printer (Save to Disk)');

  // Unavailable printer throws error
  await assert.rejects(
    async () => {
      await printerService.resolveTargetPrinter(
        { printer_name: 'NonExistent Physical Hardware XYZ' },
        mockConfig
      );
    },
    /Printer Unavailable/
  );
});
