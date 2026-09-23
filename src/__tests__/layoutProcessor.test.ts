import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { LayoutProcessor } from '../layoutProcessor';

test('LayoutProcessor: 4 pages on a sheet (2x2 grid) transforms 4 pages into 1 sheet', async () => {
  const processor = LayoutProcessor.getInstance();

  // Create a 4-page dummy PDF
  const doc = await PDFDocument.create();
  for (let i = 1; i <= 4; i++) {
    const page = doc.addPage([400, 600]);
    page.drawText(`Page ${i}`);
  }
  const testDir = path.join(__dirname, 'test_scratch');
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

  const inputPath = path.join(testDir, 'test-4pages.pdf');
  fs.writeFileSync(inputPath, await doc.save());

  const result = await processor.process(inputPath, {
    pages_per_paper: 4,
    size: 'A4',
    orientation: 'portrait'
  }, testDir);

  assert.equal(result.isTransformed, true);
  assert.ok(fs.existsSync(result.outputPath));

  // Inspect generated PDF
  const outputBytes = fs.readFileSync(result.outputPath);
  const outDoc = await PDFDocument.load(outputBytes);
  // 4 pages placed on 1 sheet
  assert.equal(outDoc.getPageCount(), 1);

  // A4 Portrait dimensions: 595.28 x 841.89
  const firstPage = outDoc.getPage(0);
  assert.ok(Math.abs(firstPage.getWidth() - 595.28) < 1);
  assert.ok(Math.abs(firstPage.getHeight() - 841.89) < 1);

  // Cleanup
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('LayoutProcessor: 8 pages with pages_per_paper: 4 produces exactly 2 sheets', async () => {
  const processor = LayoutProcessor.getInstance();

  const doc = await PDFDocument.create();
  for (let i = 1; i <= 8; i++) {
    const page = doc.addPage([400, 600]);
    page.drawText(`Page ${i}`);
  }
  const testDir = path.join(__dirname, 'test_scratch_8');
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

  const inputPath = path.join(testDir, 'test-8pages.pdf');
  fs.writeFileSync(inputPath, await doc.save());

  const result = await processor.process(inputPath, {
    pages_per_paper: 4,
    size: 'A4'
  }, testDir);

  const outDoc = await PDFDocument.load(fs.readFileSync(result.outputPath));
  assert.equal(outDoc.getPageCount(), 2);

  fs.rmSync(testDir, { recursive: true, force: true });
});

test('LayoutProcessor: 2 pages on a sheet produces 1 landscape A4 sheet', async () => {
  const processor = LayoutProcessor.getInstance();

  const doc = await PDFDocument.create();
  doc.addPage([400, 600]);
  doc.addPage([400, 600]);

  const testDir = path.join(__dirname, 'test_scratch_2');
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

  const inputPath = path.join(testDir, 'test-2pages.pdf');
  fs.writeFileSync(inputPath, await doc.save());

  const result = await processor.process(inputPath, {
    pages_per_paper: 2,
    size: 'A4'
  }, testDir);

  const outDoc = await PDFDocument.load(fs.readFileSync(result.outputPath));
  assert.equal(outDoc.getPageCount(), 1);

  // Landscape A4: width > height
  const page = outDoc.getPage(0);
  assert.ok(page.getWidth() > page.getHeight());

  fs.rmSync(testDir, { recursive: true, force: true });
});

test('LayoutProcessor: repeat_image_on_grid replicates single page across all 4 cells on 1 sheet', async () => {
  const processor = LayoutProcessor.getInstance();

  const doc = await PDFDocument.create();
  doc.addPage([400, 600]); // 1 single page (e.g. ID card or image)

  const testDir = path.join(__dirname, 'test_scratch_repeat');
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

  const inputPath = path.join(testDir, 'test-single.pdf');
  fs.writeFileSync(inputPath, await doc.save());

  const result = await processor.process(inputPath, {
    pages_per_paper: 4,
    repeat_image_on_grid: true,
    size: 'A4'
  }, testDir);

  const outDoc = await PDFDocument.load(fs.readFileSync(result.outputPath));
  assert.equal(outDoc.getPageCount(), 1);

  fs.rmSync(testDir, { recursive: true, force: true });
});

test('LayoutProcessor: converts PNG image and arranges 4-on-a-sheet with repeat', async () => {
  const processor = LayoutProcessor.getInstance();

  const testDir = path.join(__dirname, 'test_scratch_png');
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

  // 1x1 transparent PNG
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const imgPath = path.join(testDir, 'test-photo.png');
  fs.writeFileSync(imgPath, Buffer.from(pngBase64, 'base64'));

  const result = await processor.process(imgPath, {
    pages_per_paper: 4,
    repeat_image_on_grid: true,
    size: 'A4'
  }, testDir);

  assert.equal(result.isTransformed, true);
  const outDoc = await PDFDocument.load(fs.readFileSync(result.outputPath));
  assert.equal(outDoc.getPageCount(), 1);

  fs.rmSync(testDir, { recursive: true, force: true });
});

test('LayoutProcessor: bypasses transformation when pages_per_paper is 1 and already a standard PDF', async () => {
  const processor = LayoutProcessor.getInstance();

  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);

  const testDir = path.join(__dirname, 'test_scratch_noop');
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

  const inputPath = path.join(testDir, 'test-noop.pdf');
  fs.writeFileSync(inputPath, await doc.save());

  const result = await processor.process(inputPath, {
    pages_per_paper: 1
  }, testDir);

  assert.equal(result.isTransformed, false);
  assert.equal(result.outputPath, inputPath);

  fs.rmSync(testDir, { recursive: true, force: true });
});
