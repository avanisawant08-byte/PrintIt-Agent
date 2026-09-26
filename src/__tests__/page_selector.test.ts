import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { PDFDocument, rgb } from 'pdf-lib';
import { PageSelector } from '../pageSelector';
import { LayoutProcessor } from '../layoutProcessor';

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

test('PageSelector: parsePageSelection correctly parses valid inputs', () => {
  const selector = PageSelector.getInstance();

  // Null and undefined return null (indicating full document)
  assert.equal(selector.parsePageSelection(undefined, 10), null);
  assert.equal(selector.parsePageSelection(null, 10), null);

  // 'all' (case-insensitive) returns null
  assert.equal(selector.parsePageSelection('all', 10), null);
  assert.equal(selector.parsePageSelection('ALL', 10), null);
  assert.equal(selector.parsePageSelection('All', 10), null);

  // Single page
  assert.deepEqual(selector.parsePageSelection('1', 5), [1]);
  assert.deepEqual(selector.parsePageSelection('5', 5), [5]);

  // Comma-separated list with arbitrary spacing
  assert.deepEqual(selector.parsePageSelection('1, 3, 5', 5), [1, 3, 5]);
  assert.deepEqual(selector.parsePageSelection('  2,   4 ', 5), [2, 4]);

  // Ranges
  assert.deepEqual(selector.parsePageSelection('1-3, 5', 5), [1, 2, 3, 5]);
  assert.deepEqual(selector.parsePageSelection('2-4', 5), [2, 3, 4]);

  // Out of order and reverse ranges
  assert.deepEqual(selector.parsePageSelection('3, 1', 5), [3, 1]);
  assert.deepEqual(selector.parsePageSelection('4-2', 5), [4, 3, 2]);

  // Duplicates / repeats
  assert.deepEqual(selector.parsePageSelection('1, 1, 2, 2', 5), [1, 1, 2, 2]);
});

test('PageSelector: parsePageSelection strictly rejects invalid inputs with actionable errors', () => {
  const selector = PageSelector.getInstance();

  // Empty or whitespace
  assert.throws(
    () => selector.parsePageSelection('', 10),
    /Invalid page selection: string is empty or contains only whitespace/
  );
  assert.throws(
    () => selector.parsePageSelection('   ', 10),
    /Invalid page selection: string is empty or contains only whitespace/
  );

  // Page out of bounds (> totalPages)
  assert.throws(
    () => selector.parsePageSelection('11', 10),
    /Page 11 requested but document only has 10 pages/
  );
  assert.throws(
    () => selector.parsePageSelection('1-12', 10),
    /Page 12 requested but document only has 10 pages/
  );

  // Page 0 or negative
  assert.throws(
    () => selector.parsePageSelection('0', 10),
    /Page numbers must be greater than or equal to 1/
  );
  assert.throws(
    () => selector.parsePageSelection('0-5', 10),
    /Page numbers must be greater than or equal to 1/
  );

  // Malformed tokens
  assert.throws(
    () => selector.parsePageSelection('1,,3', 10),
    /empty token detected.*Double commas are not allowed/
  );
  assert.throws(
    () => selector.parsePageSelection('abc', 10),
    /Expected a page number/
  );
  assert.throws(
    () => selector.parsePageSelection('1-2-3', 10),
    /Expected format "start-end"/
  );
});

test('PageSelector: extractPageSubset creates trimmed PDF with exact pages', async () => {
  const scratchDir = path.join(__dirname, 'test_scratch_page_subset');
  fs.mkdirSync(scratchDir, { recursive: true });

  const inputPdf = path.join(scratchDir, 'original-5pages.pdf');
  await createTestPdf(5, inputPdf);

  const selector = PageSelector.getInstance();

  // 1. Extract pages 1, 3, 5
  const result1 = await selector.extractPageSubset(inputPdf, '1, 3, 5', scratchDir);
  assert.equal(result1.isExtracted, true);
  assert.equal(result1.pageCount, 3);
  assert.deepEqual(result1.requestedPages, [1, 3, 5]);
  assert.ok(fs.existsSync(result1.outputPath));

  const doc1 = await PDFDocument.load(fs.readFileSync(result1.outputPath));
  assert.equal(doc1.getPageCount(), 3);

  // 2. Out of order & duplicate pages: "4, 2, 4"
  const result2 = await selector.extractPageSubset(inputPdf, '4, 2, 4', scratchDir);
  assert.equal(result2.isExtracted, true);
  assert.equal(result2.pageCount, 3);
  assert.deepEqual(result2.requestedPages, [4, 2, 4]);

  const doc2 = await PDFDocument.load(fs.readFileSync(result2.outputPath));
  assert.equal(doc2.getPageCount(), 3);

  // 3. Selection "all" or null returns original file unmodified
  const resultAll = await selector.extractPageSubset(inputPdf, 'all', scratchDir);
  assert.equal(resultAll.isExtracted, false);
  assert.equal(resultAll.outputPath, inputPdf);
  assert.equal(resultAll.pageCount, 5);

  // Clean up
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  } catch {}
});

test('PageSelector + LayoutProcessor: Pre-layout subset extraction prevents N-up page leaks', async () => {
  const scratchDir = path.join(__dirname, 'test_scratch_page_nup');
  fs.mkdirSync(scratchDir, { recursive: true });

  // 8-page original document
  const inputPdf = path.join(scratchDir, 'doc-8pages.pdf');
  await createTestPdf(8, inputPdf);

  const selector = PageSelector.getInstance();
  const processor = LayoutProcessor.getInstance();

  // User requests pages 1-4 with 2 pages per paper (2-up)
  const subsetResult = await selector.extractPageSubset(inputPdf, '1-4', scratchDir);
  assert.equal(subsetResult.isExtracted, true);
  assert.equal(subsetResult.pageCount, 4);

  const layoutResult = await processor.process(
    subsetResult.outputPath,
    { pages_per_paper: 2 },
    scratchDir
  );
  assert.ok(layoutResult.isTransformed);

  // 4 pages imposed 2-up must result in exactly 2 sheets (pages 1-2 on sheet 1, pages 3-4 on sheet 2)
  const finalDoc = await PDFDocument.load(fs.readFileSync(layoutResult.outputPath));
  assert.equal(finalDoc.getPageCount(), 2, '4 selected pages with 2-up must produce exactly 2 sheets');

  // Clean up
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  } catch {}
});

test('PageSelector + LayoutProcessor: Pre-layout subset extraction works with Duplex blank sheet padding', async () => {
  const scratchDir = path.join(__dirname, 'test_scratch_page_duplex');
  fs.mkdirSync(scratchDir, { recursive: true });

  // 6-page original document
  const inputPdf = path.join(scratchDir, 'doc-6pages.pdf');
  await createTestPdf(6, inputPdf);

  const selector = PageSelector.getInstance();
  const processor = LayoutProcessor.getInstance();

  // User selects odd subset (e.g. pages 1-3 = 3 pages) with duplex printing
  const subsetResult = await selector.extractPageSubset(inputPdf, '1-3', scratchDir);
  assert.equal(subsetResult.isExtracted, true);
  assert.equal(subsetResult.pageCount, 3);

  const layoutResult = await processor.process(
    subsetResult.outputPath,
    { sides: 'double', pad_odd_duplex: true, pages_per_paper: 1 },
    scratchDir
  );
  assert.ok(layoutResult.isTransformed);

  // 3 content pages padded to 4 pages for duplex boundary integrity
  const finalDoc = await PDFDocument.load(fs.readFileSync(layoutResult.outputPath));
  assert.equal(finalDoc.getPageCount(), 4, '3 selected pages in duplex mode must be padded to 4 sheets');

  // Clean up
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  } catch {}
});
