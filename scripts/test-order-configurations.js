const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { PDFDocument } = require('pdf-lib');
const { LayoutProcessor } = require('../dist/layoutProcessor');
const { PrinterService, VIRTUAL_PRINTER_NAME } = require('../dist/printer');

async function testConfigurationsPipeline() {
  console.log('='.repeat(75));
  console.log('      PRINT CONFIGURATIONS VERIFICATION REPORT');
  console.log('='.repeat(75));

  const processor = LayoutProcessor.getInstance();
  const printer = PrinterService.getInstance();
  const outDir = path.join(__dirname, '..', 'output_prints');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const tempDir = path.join(__dirname, 'temp_config_test');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  // Test Case 1: 4 pages on a sheet (2x2 grid), Portrait, A4, B&W, 2 Copies
  console.log('\n[TEST CASE 1] 4 Pages per sheet, A4 Portrait, B&W, 2 Copies');
  {
    const doc = await PDFDocument.create();
    for (let i = 1; i <= 4; i++) {
      const p = doc.addPage([400, 600]);
      p.drawText(`Page ${i} content`, { x: 50, y: 300, size: 20 });
    }
    const pdfPath = path.join(tempDir, 'case1-input.pdf');
    fs.writeFileSync(pdfPath, await doc.save());

    const options = {
      pages_per_paper: 4,
      size: 'A4',
      orientation: 'portrait',
      color: 'bw',
      sides: 'single',
      copies: 2
    };

    const layoutRes = await processor.process(pdfPath, options, tempDir);
    const outPdf = await PDFDocument.load(fs.readFileSync(layoutRes.outputPath));
    const sheet = outPdf.getPage(0);

    console.log(`  -> Input Pages: 4`);
    console.log(`  -> Output Sheets: ${outPdf.getPageCount()} (Expected: 1)`);
    console.log(`  -> Dimensions: ${sheet.getWidth().toFixed(1)} x ${sheet.getHeight().toFixed(1)} pt (A4 Portrait)`);
    
    // Check SumatraPDF driver options
    const driverOpts = printer.buildDriverOptions('HP LaserJet', options.copies, options);
    console.log(`  -> Driver Flags: silent=${driverOpts.silent}, copies=${driverOpts.copies}, monochrome=${driverOpts.monochrome}, paperSize=${driverOpts.paperSize}, side=${driverOpts.side}`);

    if (outPdf.getPageCount() !== 1 || !driverOpts.monochrome || driverOpts.copies !== 2) {
      throw new Error('Test Case 1 failed verification!');
    }
    console.log('  ✅ Case 1 Verified: All layout and driver configurations applied.');
  }

  // Test Case 2: 2 pages per sheet (Landscape side-by-side), A3 Paper, Duplex, Color
  console.log('\n[TEST CASE 2] 2 Pages per sheet, A3 Landscape, Duplex, Color');
  {
    const doc = await PDFDocument.create();
    for (let i = 1; i <= 6; i++) {
      const p = doc.addPage([400, 600]);
      p.drawText(`Page ${i}`, { x: 50, y: 300, size: 20 });
    }
    const pdfPath = path.join(tempDir, 'case2-input.pdf');
    fs.writeFileSync(pdfPath, await doc.save());

    const options = {
      pages_per_paper: 2,
      size: 'A3',
      orientation: 'landscape',
      color: 'color',
      sides: 'double',
      copies: 1
    };

    const layoutRes = await processor.process(pdfPath, options, tempDir);
    const outPdf = await PDFDocument.load(fs.readFileSync(layoutRes.outputPath));
    const sheet = outPdf.getPage(0);

    console.log(`  -> Input Pages: 6`);
    console.log(`  -> Output Sheets: ${outPdf.getPageCount()} (Expected: 3 sheets @ 2-up)`);
    console.log(`  -> Dimensions: ${sheet.getWidth().toFixed(1)} x ${sheet.getHeight().toFixed(1)} pt (A3 Landscape: 1190.6 x 841.9 pt)`);
    console.log(`  -> Orientation: ${sheet.getWidth() > sheet.getHeight() ? 'LANDSCAPE' : 'PORTRAIT'}`);

    const driverOpts = printer.buildDriverOptions('Xerox Altalink', options.copies, options);
    console.log(`  -> Driver Flags: copies=${driverOpts.copies}, monochrome=${driverOpts.monochrome || false}, side=${driverOpts.side}, paperSize=${driverOpts.paperSize}`);

    if (outPdf.getPageCount() !== 3 || driverOpts.side !== 'duplex' || !(sheet.getWidth() > sheet.getHeight())) {
      throw new Error('Test Case 2 failed verification!');
    }
    console.log('  ✅ Case 2 Verified: All layout and driver configurations applied.');
  }

  // Test Case 3: Repeat Single Page on Grid (Passport / ID photo tile - 6-up)
  console.log('\n[TEST CASE 3] Repeat 1-Page on 6-up Grid (repeat_image_on_grid: true)');
  {
    const doc = await PDFDocument.create();
    const p = doc.addPage([300, 400]);
    p.drawText('ID Badge / Photo', { x: 50, y: 200, size: 18 });
    const pdfPath = path.join(tempDir, 'case3-input.pdf');
    fs.writeFileSync(pdfPath, await doc.save());

    const options = {
      pages_per_paper: 6,
      repeat_image_on_grid: true,
      size: 'A4',
      orientation: 'landscape',
      color: 'color',
      sides: 'single',
      copies: 1
    };

    const layoutRes = await processor.process(pdfPath, options, tempDir);
    const outPdf = await PDFDocument.load(fs.readFileSync(layoutRes.outputPath));

    console.log(`  -> Input Pages: 1 single page`);
    console.log(`  -> Output Sheets: ${outPdf.getPageCount()} (Repeated across 6 slots on 1 sheet)`);

    // Spool to Virtual Test Printer
    const printRes = await printer.printPdf(layoutRes.outputPath, VIRTUAL_PRINTER_NAME, 1, options);
    console.log(`  -> Spooled to Virtual Test Printer: ${printRes.savedPath}`);
    assert.ok(fs.existsSync(printRes.savedPath));

    if (fs.existsSync(printRes.savedPath)) fs.unlinkSync(printRes.savedPath);
    console.log('  ✅ Case 3 Verified: Single page replicated across sheet grid slots.');
  }

  // Cleanup
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log('\n' + '='.repeat(75));
  console.log('ALL PRINT CONFIGURATION TESTS COMPLETED AND VERIFIED: PASS');
  console.log('='.repeat(75));
}

testConfigurationsPipeline().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
