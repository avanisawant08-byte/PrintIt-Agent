import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

export interface TestPageInfo {
  shopName?: string;
  shopId?: string;
  deviceName?: string;
  printerName?: string;
  version?: string;
}

export async function generateTestPagePdf(
  destPath: string,
  info: TestPageInfo = {}
): Promise<string> {
  const pdfDoc = await PDFDocument.create();
  // Standard A4 dimensions (595.28 x 841.89 pt)
  const page = pdfDoc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

  // 1. Decorative border
  page.drawRectangle({
    x: 30,
    y: 30,
    width: width - 60,
    height: height - 60,
    borderColor: rgb(0.15, 0.23, 0.36),
    borderWidth: 2,
    color: rgb(0.98, 0.99, 1.0)
  });

  // Top header banner
  page.drawRectangle({
    x: 32,
    y: height - 120,
    width: width - 64,
    height: 88,
    color: rgb(0.08, 0.45, 0.85)
  });

  // Header Title
  page.drawText('PrintIt — Remote Print Agent', {
    x: 50,
    y: height - 75,
    size: 24,
    font: fontBold,
    color: rgb(1, 1, 1)
  });

  page.drawText('Hardware & Silent Spooler Diagnostic Test Page', {
    x: 50,
    y: height - 100,
    size: 13,
    font: fontRegular,
    color: rgb(0.85, 0.92, 1.0)
  });

  // 2. Diagnostics Info Box
  let yPos = height - 160;

  page.drawText('SYSTEM CONFIGURATION & PRINTER BINDING', {
    x: 50,
    y: yPos,
    size: 12,
    font: fontBold,
    color: rgb(0.12, 0.18, 0.28)
  });

  yPos -= 10;
  page.drawLine({
    start: { x: 50, y: yPos },
    end: { x: width - 50, y: yPos },
    color: rgb(0.8, 0.85, 0.9),
    thickness: 1
  });

  yPos -= 25;

  const details = [
    { label: 'Shop Name', value: info.shopName || 'Connected Store' },
    { label: 'Shop ID', value: info.shopId || 'N/A' },
    { label: 'Station Name', value: info.deviceName || 'Windows-Shop-Agent' },
    { label: 'Target Printer', value: info.printerName || 'Default System Printer' },
    { label: 'Agent Version', value: info.version || 'v1.0.0' },
    { label: 'Spool Timestamp', value: new Date().toLocaleString() },
    { label: 'Spool Engine', value: 'SumatraPDF / Windows Print Spooler (Silent Mode)' }
  ];

  for (const item of details) {
    page.drawText(item.label + ':', {
      x: 55,
      y: yPos,
      size: 11,
      font: fontBold,
      color: rgb(0.3, 0.35, 0.45)
    });

    page.drawText(item.value, {
      x: 180,
      y: yPos,
      size: 11,
      font: fontMono,
      color: rgb(0.1, 0.12, 0.16)
    });

    yPos -= 22;
  }

  // 3. Test Alignment & Color Swatches
  yPos -= 15;
  page.drawText('COLOR & TONER DIAGNOSTIC SWATCHES', {
    x: 50,
    y: yPos,
    size: 12,
    font: fontBold,
    color: rgb(0.12, 0.18, 0.28)
  });

  yPos -= 10;
  page.drawLine({
    start: { x: 50, y: yPos },
    end: { x: width - 50, y: yPos },
    color: rgb(0.8, 0.85, 0.9),
    thickness: 1
  });

  yPos -= 35;

  // Grayscale & Color Swatch blocks
  const swatches = [
    { name: '100% Black', color: rgb(0, 0, 0) },
    { name: '75% Gray', color: rgb(0.25, 0.25, 0.25) },
    { name: '50% Gray', color: rgb(0.5, 0.5, 0.5) },
    { name: '25% Gray', color: rgb(0.75, 0.75, 0.75) },
    { name: 'Cyan', color: rgb(0, 0.75, 0.9) },
    { name: 'Magenta', color: rgb(0.85, 0.1, 0.55) },
    { name: 'Yellow', color: rgb(0.95, 0.85, 0.1) },
    { name: 'Blue', color: rgb(0.15, 0.4, 0.95) }
  ];

  const swatchWidth = 52;
  const swatchHeight = 28;
  const startX = 55;

  swatches.forEach((swatch, idx) => {
    const x = startX + idx * (swatchWidth + 8);
    page.drawRectangle({
      x,
      y: yPos,
      width: swatchWidth,
      height: swatchHeight,
      color: swatch.color,
      borderColor: rgb(0.7, 0.7, 0.7),
      borderWidth: 1
    });

    page.drawText(swatch.name, {
      x: x + 2,
      y: yPos - 12,
      size: 7,
      font: fontRegular,
      color: rgb(0.3, 0.3, 0.3)
    });
  });

  // 4. Status confirmation footer
  yPos -= 60;
  page.drawRectangle({
    x: 50,
    y: yPos - 10,
    width: width - 100,
    height: 40,
    color: rgb(0.92, 0.98, 0.94),
    borderColor: rgb(0.18, 0.72, 0.45),
    borderWidth: 1
  });

  page.drawText('[OK] PRINTER COMMUNICATION & PAGE RENDERING SUCCESSFUL', {
    x: 70,
    y: yPos + 6,
    size: 11,
    font: fontBold,
    color: rgb(0.1, 0.55, 0.3)
  });

  // Footer notes
  page.drawText('This document confirms that the PrintIt Remote Silent Agent is actively connected and spooled document data.', {
    x: 50,
    y: 50,
    size: 9,
    font: fontRegular,
    color: rgb(0.5, 0.55, 0.6)
  });

  const pdfBytes = await pdfDoc.save();
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(destPath, Buffer.from(pdfBytes));
  return destPath;
}
