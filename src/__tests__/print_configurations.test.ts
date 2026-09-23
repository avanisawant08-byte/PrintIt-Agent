import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { LayoutProcessor } from '../layoutProcessor';
import { PrinterService, VIRTUAL_PRINTER_NAME } from '../printer';
import { PrintOptions } from '../types';

test('Print Configurations: buildDriverOptions translates options to SumatraPDF flags', () => {
  const printerService = PrinterService.getInstance();

  // Test 1: B&W, Duplex, Custom Copies, A4, Page Range
  const options1: PrintOptions = {
    color: 'bw',
    sides: 'double',
    copies: 3,
    size: 'A4',
    page_range: '1-5'
  };

  const driverOpts1 = printerService.buildDriverOptions('HP LaserJet Pro', 3, options1);
  assert.equal(driverOpts1.silent, true);
  assert.equal(driverOpts1.copies, 3);
  assert.equal(driverOpts1.printer, 'HP LaserJet Pro');
  assert.equal(driverOpts1.monochrome, true, 'color: bw should set monochrome: true');
  assert.equal(driverOpts1.side, 'duplex', 'sides: double should set side: duplex');
  assert.equal(driverOpts1.paperSize, 'A4', 'size: A4 should set paperSize: A4');
  assert.equal(driverOpts1.pages, '1-5', 'page_range: 1-5 should set pages: 1-5');

  // Test 2: Color, Single-sided, Default Copies (1), Letter
  const options2: PrintOptions = {
    color: 'color',
    sides: 'single',
    size: 'LETTER'
  };

  const driverOpts2 = printerService.buildDriverOptions('Canon PIXMA', 1, options2);
  assert.equal(driverOpts2.silent, true);
  assert.equal(driverOpts2.copies, 1);
  assert.equal(driverOpts2.printer, 'Canon PIXMA');
  assert.equal(driverOpts2.monochrome, undefined, 'color: color should not set monochrome');
  assert.equal(driverOpts2.side, 'simplex', 'sides: single should set side: simplex');
  assert.equal(driverOpts2.paperSize, 'LETTER', 'size: LETTER should set paperSize: LETTER');
  assert.equal(driverOpts2.pages, undefined, 'no page_range should leave pages undefined');
});

test('Print Configurations: LayoutProcessor applies target paper sizes (A4, A3, Letter)', async () => {
  const processor = LayoutProcessor.getInstance();
  const testDir = path.join(__dirname, 'test_scratch_sizes');
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

  // Create a 1-page test PDF
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  const inputPath = path.join(testDir, 'sample-size.pdf');
  fs.writeFileSync(inputPath, await doc.save());

  // 1. A4 [595.28, 841.89]
  const a4Res = await processor.process(inputPath, { size: 'A4', orientation: 'portrait' }, testDir);
  const a4Doc = await PDFDocument.load(fs.readFileSync(a4Res.outputPath));
  const a4Page = a4Doc.getPage(0);
  assert.ok(Math.abs(a4Page.getWidth() - 595.28) < 1, 'A4 width should match 595.28 pt');
  assert.ok(Math.abs(a4Page.getHeight() - 841.89) < 1, 'A4 height should match 841.89 pt');

  // 2. A3 [841.89, 1190.55]
  const a3Res = await processor.process(inputPath, { size: 'A3', orientation: 'portrait' }, testDir);
  const a3Doc = await PDFDocument.load(fs.readFileSync(a3Res.outputPath));
  const a3Page = a3Doc.getPage(0);
  assert.ok(Math.abs(a3Page.getWidth() - 841.89) < 1, 'A3 width should match 841.89 pt');
  assert.ok(Math.abs(a3Page.getHeight() - 1190.55) < 1, 'A3 height should match 1190.55 pt');

  // 3. LETTER [612.0, 792.0]
  const letterRes = await processor.process(inputPath, { size: 'LETTER', orientation: 'portrait' }, testDir);
  const letterDoc = await PDFDocument.load(fs.readFileSync(letterRes.outputPath));
  const letterPage = letterDoc.getPage(0);
  assert.ok(Math.abs(letterPage.getWidth() - 612.0) < 1, 'LETTER width should match 612.0 pt');
  assert.ok(Math.abs(letterPage.getHeight() - 792.0) < 1, 'LETTER height should match 792.0 pt');

  // Cleanup
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('Print Configurations: LayoutProcessor applies orientation (Portrait vs Landscape)', async () => {
  const processor = LayoutProcessor.getInstance();
  const testDir = path.join(__dirname, 'test_scratch_orient');
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

  const doc = await PDFDocument.create();
  doc.addPage([400, 500]);
  const inputPath = path.join(testDir, 'sample-orient.pdf');
  fs.writeFileSync(inputPath, await doc.save());

  // Portrait
  const portRes = await processor.process(inputPath, { size: 'A4', orientation: 'portrait' }, testDir);
  const portDoc = await PDFDocument.load(fs.readFileSync(portRes.outputPath));
  const portPage = portDoc.getPage(0);
  assert.ok(portPage.getHeight() > portPage.getWidth(), 'Portrait height must exceed width');

  // Landscape
  const landRes = await processor.process(inputPath, { size: 'A4', orientation: 'landscape' }, testDir);
  const landDoc = await PDFDocument.load(fs.readFileSync(landRes.outputPath));
  const landPage = landDoc.getPage(0);
  assert.ok(landPage.getWidth() > landPage.getHeight(), 'Landscape width must exceed height');

  fs.rmSync(testDir, { recursive: true, force: true });
});

test('Print Configurations: Multi-page N-up grid layouts (2, 4, 6 pages per paper)', async () => {
  const processor = LayoutProcessor.getInstance();
  const testDir = path.join(__dirname, 'test_scratch_nup');
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

  // Create a 12-page document
  const doc = await PDFDocument.create();
  for (let i = 1; i <= 12; i++) {
    const page = doc.addPage([400, 600]);
    page.drawText(`Page ${i}`);
  }
  const inputPath = path.join(testDir, 'sample-12pages.pdf');
  fs.writeFileSync(inputPath, await doc.save());

  // 1. 2 pages per paper: 12 pages -> 6 sheets
  const res2 = await processor.process(inputPath, { pages_per_paper: 2, size: 'A4' }, testDir);
  const doc2 = await PDFDocument.load(fs.readFileSync(res2.outputPath));
  assert.equal(doc2.getPageCount(), 6, '12 pages @ 2-up must result in exactly 6 sheets');

  // 2. 4 pages per paper: 12 pages -> 3 sheets
  const res4 = await processor.process(inputPath, { pages_per_paper: 4, size: 'A4' }, testDir);
  const doc4 = await PDFDocument.load(fs.readFileSync(res4.outputPath));
  assert.equal(doc4.getPageCount(), 3, '12 pages @ 4-up must result in exactly 3 sheets');

  // 3. 6 pages per paper: 12 pages -> 2 sheets
  const res6 = await processor.process(inputPath, { pages_per_paper: 6, size: 'A4' }, testDir);
  const doc6 = await PDFDocument.load(fs.readFileSync(res6.outputPath));
  assert.equal(doc6.getPageCount(), 2, '12 pages @ 6-up must result in exactly 2 sheets');

  fs.rmSync(testDir, { recursive: true, force: true });
});

test('Print Configurations: End-to-end accepted order simulation with Virtual Test Printer', async () => {
  const processor = LayoutProcessor.getInstance();
  const printerService = PrinterService.getInstance();
  const testDir = path.join(__dirname, 'test_scratch_e2e');
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

  // Simulate an accepted order with complex customer configurations:
  // e.g., 4 pages on an A4 sheet in landscape orientation, 2 copies, B&W
  const simulatedAcceptedOrderOptions: PrintOptions = {
    pages_per_paper: 4,
    size: 'A4',
    orientation: 'landscape',
    color: 'bw',
    sides: 'double',
    copies: 2,
    printer_name: VIRTUAL_PRINTER_NAME
  };

  // Create an 8-page input document
  const doc = await PDFDocument.create();
  for (let i = 1; i <= 8; i++) {
    const page = doc.addPage([400, 600]);
    page.drawText(`Customer Document Section ${i}`);
  }
  const inputDocPath = path.join(testDir, 'customer-order-8pages.pdf');
  fs.writeFileSync(inputDocPath, await doc.save());

  // Step 1: Layout transformation applied by agent
  const layoutResult = await processor.process(inputDocPath, simulatedAcceptedOrderOptions, testDir);
  assert.equal(layoutResult.isTransformed, true);

  const transformedBytes = fs.readFileSync(layoutResult.outputPath);
  const transformedDoc = await PDFDocument.load(transformedBytes);
  // 8 pages with 4 pages per sheet = 2 sheets
  assert.equal(transformedDoc.getPageCount(), 2, '8 pages at 4-up must produce 2 sheets');

  // Verify sheet orientation is landscape
  const sheet1 = transformedDoc.getPage(0);
  assert.ok(sheet1.getWidth() > sheet1.getHeight(), 'Transformed sheet must be in landscape orientation');

  // Step 2: Spool to Virtual Test Printer
  const printResult = await printerService.printPdf(
    layoutResult.outputPath,
    VIRTUAL_PRINTER_NAME,
    simulatedAcceptedOrderOptions.copies || 1,
    simulatedAcceptedOrderOptions
  );

  assert.ok(printResult.savedPath, 'Virtual printer must return saved path');
  assert.ok(fs.existsSync(printResult.savedPath), 'Virtual print output file must exist on disk');

  // Verify saved file contains the transformed sheets
  const savedDoc = await PDFDocument.load(fs.readFileSync(printResult.savedPath));
  assert.equal(savedDoc.getPageCount(), 2, 'Printed file must have exactly 2 sheets');

  // Cleanup
  if (fs.existsSync(printResult.savedPath)) {
    fs.unlinkSync(printResult.savedPath);
  }
  fs.rmSync(testDir, { recursive: true, force: true });
});
