const path = require('path');
const fs = require('fs');
const { PDFDocument, rgb } = require('pdf-lib');
const { LayoutProcessor } = require('../dist/layoutProcessor');
const { PrinterService, VIRTUAL_PRINTER_NAME } = require('../dist/printer');

async function test4UpPrintFlow() {
  console.log('====================================================');
  console.log('    Testing 4 Pages on a Sheet Print Flow');
  console.log('====================================================\n');

  // 1. Create a mock 4-page PDF document
  console.log('[Step 1] Creating a 4-page sample document...');
  const doc = await PDFDocument.create();
  for (let i = 1; i <= 4; i++) {
    const page = doc.addPage([400, 600]);
    page.drawText(`Sample Document - Page ${i}`, { x: 50, y: 300, size: 24 });
  }
  const samplePdfBytes = await doc.save();

  const tempTestDir = path.join(__dirname, 'temp_test_4up');
  if (!fs.existsSync(tempTestDir)) fs.mkdirSync(tempTestDir, { recursive: true });

  const inputPdfPath = path.join(tempTestDir, 'sample-4-pages.pdf');
  fs.writeFileSync(inputPdfPath, samplePdfBytes);
  console.log(`  -> Saved 4-page input to: ${inputPdfPath}`);

  // 2. Process through LayoutProcessor with pages_per_paper: 4
  console.log('\n[Step 2] Processing layout for 4 pages on an A4 sheet (2x2 grid)...');
  const processor = LayoutProcessor.getInstance();
  const printOptions = {
    pages_per_paper: 4,
    size: 'A4',
    orientation: 'portrait',
    color: 'bw',
    sides: 'single',
    copies: 1
  };

  const layoutResult = await processor.process(inputPdfPath, printOptions, tempTestDir);
  console.log(`  -> Transformed: ${layoutResult.isTransformed}`);
  console.log(`  -> Formatted file path: ${layoutResult.outputPath}`);

  // 3. Inspect the formatted PDF
  const formattedBytes = fs.readFileSync(layoutResult.outputPath);
  const formattedDoc = await PDFDocument.load(formattedBytes);
  const sheetCount = formattedDoc.getPageCount();
  const firstSheet = formattedDoc.getPage(0);
  console.log(`  -> Output sheet count: ${sheetCount} (Expected: 1 sheet containing all 4 pages)`);
  console.log(`  -> Sheet dimensions: ${firstSheet.getWidth().toFixed(1)} x ${firstSheet.getHeight().toFixed(1)} pt (A4: 595.3 x 841.9 pt)`);

  if (sheetCount !== 1) {
    throw new Error(`Expected 1 sheet, got ${sheetCount}`);
  }

  // 4. Print via Virtual Test Printer
  console.log('\n[Step 3] Spooling to Virtual Test Printer (Save to Disk)...');
  const printerService = PrinterService.getInstance();
  const printResult = await printerService.printPdf(
    layoutResult.outputPath,
    VIRTUAL_PRINTER_NAME,
    1,
    printOptions
  );

  console.log(`  -> Successfully printed to virtual disk: ${printResult.savedPath}`);
  
  // Verify virtual print output exists and has 1 sheet
  const virtualDoc = await PDFDocument.load(fs.readFileSync(printResult.savedPath));
  console.log(`  -> Verified virtual print PDF contains ${virtualDoc.getPageCount()} sheet(s).`);

  // Cleanup test input
  fs.rmSync(tempTestDir, { recursive: true, force: true });

  console.log('\n====================================================');
  console.log('✅ SUCCESS: 4 pages on a sheet printed and verified!');
  console.log('====================================================');
}

test4UpPrintFlow().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
