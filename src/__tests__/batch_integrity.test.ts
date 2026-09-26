import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { PDFDocument, rgb } from 'pdf-lib';
import { LayoutProcessor } from '../layoutProcessor';
import { PrinterService, VIRTUAL_PRINTER_NAME } from '../printer';
import { DedupDatabase } from '../dedup';

// Helper to create synthetic test PDFs with a specified page count
async function createTestPdf(pageCount: number, outPath: string): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([595.28, 841.89]); // A4
    page.drawText(`Page ${i + 1} of ${pageCount}`, {
      x: 50,
      y: 800,
      size: 24,
      color: rgb(0.1, 0.1, 0.1)
    });
  }
  const bytes = await doc.save();
  fs.writeFileSync(outPath, bytes);
  return outPath;
}

test('Job-Boundary Integrity: Odd-page duplex document is automatically padded with 1 blank sheet', async () => {
  const scratchDir = path.join(__dirname, 'test_scratch_batch_duplex');
  fs.mkdirSync(scratchDir, { recursive: true });

  const inputPdf = path.join(scratchDir, 'file-3pages.pdf');
  await createTestPdf(3, inputPdf);

  const processor = LayoutProcessor.getInstance();
  const result = await processor.process(
    inputPdf,
    {
      sides: 'double', // Duplex
      pages_per_paper: 1
    },
    scratchDir
  );

  assert.ok(result.isTransformed, 'Odd-page duplex PDF must be transformed to pad blank page');
  assert.ok(fs.existsSync(result.outputPath), 'Output file must exist');

  // Verify resulting page count is now 4 (3 content + 1 blank back sheet)
  const resultBytes = fs.readFileSync(result.outputPath);
  const resultDoc = await PDFDocument.load(resultBytes);
  assert.equal(resultDoc.getPageCount(), 4, '3-page duplex document must be padded to exactly 4 pages');

  // Clean up
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  } catch {}
});

test('Job-Boundary Integrity: Even-page duplex document is NOT padded', async () => {
  const scratchDir = path.join(__dirname, 'test_scratch_batch_even');
  fs.mkdirSync(scratchDir, { recursive: true });

  const inputPdf = path.join(scratchDir, 'file-4pages.pdf');
  await createTestPdf(4, inputPdf);

  const processor = LayoutProcessor.getInstance();
  const result = await processor.process(
    inputPdf,
    {
      sides: 'double', // Duplex
      pages_per_paper: 1
    },
    scratchDir
  );

  // Even page duplex doesn't need transformation if no size/orientation override
  const resultPath = result.outputPath;
  const resultBytes = fs.readFileSync(resultPath);
  const resultDoc = await PDFDocument.load(resultBytes);
  assert.equal(resultDoc.getPageCount(), 4, '4-page duplex document must remain exactly 4 pages');

  // Clean up
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  } catch {}
});

test('Job-Boundary Integrity: Simplex document is NEVER padded with a blank page', async () => {
  const scratchDir = path.join(__dirname, 'test_scratch_batch_simplex');
  fs.mkdirSync(scratchDir, { recursive: true });

  const inputPdf = path.join(scratchDir, 'file-3pages-simplex.pdf');
  await createTestPdf(3, inputPdf);

  const processor = LayoutProcessor.getInstance();
  const result = await processor.process(
    inputPdf,
    {
      sides: 'single', // Simplex
      pages_per_paper: 1
    },
    scratchDir
  );

  const resultBytes = fs.readFileSync(result.outputPath);
  const resultDoc = await PDFDocument.load(resultBytes);
  assert.equal(resultDoc.getPageCount(), 3, 'Simplex document must stay at 3 pages to avoid wasting physical paper');

  // Clean up
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  } catch {}
});

test('Job-Boundary Integrity: DedupDatabase tracks order_id and file_index and isolates completed files', async () => {
  const dedup = DedupDatabase.getInstance();
  await dedup.init();

  const orderId = `test-order-batch-${Date.now()}`;
  const file1JobId = `job-file-1-${Date.now()}`;
  const file2JobId = `job-file-2-${Date.now()}`;

  // Initially neither file is processed
  assert.equal(dedup.isFileInOrderProcessed(orderId, 0), false);
  assert.equal(dedup.isFileInOrderProcessed(orderId, 1), false);

  // Mark file 1 completed
  dedup.markJobProcessed(file1JobId, 'checksum-f1', 'COMPLETED', orderId, 0);

  // File 1 is now recognized as completed
  assert.equal(dedup.isFileInOrderProcessed(orderId, 0), true);
  assert.equal(dedup.isFileInOrderProcessed(orderId, 1), false);
  assert.equal(dedup.isJobProcessed(file1JobId), true);

  // Completed files for order
  const completed = dedup.getCompletedFilesForOrder(orderId);
  assert.equal(completed.length, 1);
  assert.equal(completed[0], file1JobId);
});

test('Job-Boundary Integrity: Multi-file batch spooling produces distinct physical OS jobs without bleeding', async () => {
  const scratchDir = path.join(__dirname, 'test_scratch_batch_e2e');
  fs.mkdirSync(scratchDir, { recursive: true });

  const fileA = path.join(scratchDir, 'fileA-3pages.pdf');
  const fileB = path.join(scratchDir, 'fileB-2pages.pdf');

  await createTestPdf(3, fileA);
  await createTestPdf(2, fileB);

  const processor = LayoutProcessor.getInstance();
  const printer = PrinterService.getInstance();

  // File A (3 pages, Duplex)
  const resA = await processor.process(fileA, { sides: 'double' }, scratchDir);
  const printA = await printer.printPdf(resA.outputPath, VIRTUAL_PRINTER_NAME, 1, { sides: 'double' });

  // File B (2 pages, Duplex)
  const resB = await processor.process(fileB, { sides: 'double' }, scratchDir);
  const printB = await printer.printPdf(resB.outputPath, VIRTUAL_PRINTER_NAME, 1, { sides: 'double' });

  // Both jobs must produce distinct virtual output files (independent OS print jobs)
  assert.ok(printA.savedPath, 'File A must produce a separate print output file');
  assert.ok(printB.savedPath, 'File B must produce a separate print output file');
  assert.notEqual(printA.savedPath, printB.savedPath, 'Each file in batch must be its own independent print job');

  // Verify File A was padded to 4 pages so its blank back side physically ejects before File B
  const docA = await PDFDocument.load(fs.readFileSync(printA.savedPath!));
  assert.equal(docA.getPageCount(), 4, 'File A output must have 4 pages (3 content + 1 blank back sheet)');

  // Verify File B remains 2 pages
  const docB = await PDFDocument.load(fs.readFileSync(printB.savedPath!));
  assert.equal(docB.getPageCount(), 2, 'File B output must have 2 pages');

  // Clean up
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
    if (printA.savedPath && fs.existsSync(printA.savedPath)) fs.unlinkSync(printA.savedPath);
    if (printB.savedPath && fs.existsSync(printB.savedPath)) fs.unlinkSync(printB.savedPath);
  } catch {}
});
