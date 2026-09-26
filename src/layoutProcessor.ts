import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { PrintOptions } from './types';
import { ConfigManager } from './config';

const PAGE_SIZES: Record<string, [number, number]> = {
  A4: [595.28, 841.89],
  A3: [841.89, 1190.55],
  LETTER: [612.0, 792.0],
  LEGAL: [612.0, 1008.0]
};

export interface GridConfig {
  cols: number;
  rows: number;
}

export class LayoutProcessor {
  private static instance: LayoutProcessor;

  private constructor() {}

  public static getInstance(): LayoutProcessor {
    if (!LayoutProcessor.instance) {
      LayoutProcessor.instance = new LayoutProcessor();
    }
    return LayoutProcessor.instance;
  }

  /**
   * Processes a document (PDF or Image) applying user print options:
   * - N-up layout (pages_per_paper: 1, 2, 4, 6, 9, 16)
   * - Sheet orientation (portrait / landscape)
   * - Target paper size (A4, A3, Letter)
   * - Image conversion to PDF and optional grid repeat (repeat_image_on_grid)
   * - Odd-page duplex sheet termination (+ blank page) to prevent cross-file sheet bleeding
   *
   * Returns the path to the formatted PDF ready for printing.
   */
  public async process(
    inputFilePath: string,
    options?: PrintOptions | null,
    destinationDir?: string
  ): Promise<{ outputPath: string; isTransformed: boolean }> {
    if (!fs.existsSync(inputFilePath)) {
      throw new Error(`[LayoutProcessor] Input file does not exist: ${inputFilePath}`);
    }

    const pagesPerPaper = Number(options?.pages_per_paper) || 1;
    const isImage = this.isImageFile(inputFilePath);
    const repeatOnGrid = options?.repeat_image_on_grid ?? false;
    const isDuplex = options?.sides === 'double' || options?.sides === 'duplex';

    // 1. Prepare source PDF Document (convert image if needed)
    let srcDoc: PDFDocument;
    if (isImage) {
      srcDoc = await this.createPdfFromImage(inputFilePath, options);
    } else {
      const srcBuffer = fs.readFileSync(inputFilePath);
      srcDoc = await PDFDocument.load(srcBuffer);
    }

    const srcPageCount = srcDoc.getPageCount();
    if (srcPageCount === 0) {
      throw new Error(`[LayoutProcessor] Source document contains 0 pages: ${inputFilePath}`);
    }

    // Check if odd duplex padding should be applied to avoid cross-file sheet bleeding
    let shouldPadDuplex = false;
    if (isDuplex && srcPageCount % 2 !== 0) {
      if (options?.pad_odd_duplex !== undefined) {
        shouldPadDuplex = Boolean(options.pad_odd_duplex);
      } else {
        try {
          const cfg = ConfigManager.getInstance().get();
          shouldPadDuplex = cfg.padOddDuplexFiles !== false;
        } catch {
          shouldPadDuplex = true;
        }
      }
    }

    // If it's a PDF and only 1 page per paper without explicit orientation/size override,
    // and does not require duplex padding, we don't need to re-encode
    if (!isImage && pagesPerPaper === 1 && !options?.size && !options?.orientation && !shouldPadDuplex) {
      return { outputPath: inputFilePath, isTransformed: false };
    }

    console.log(
      `[LayoutProcessor] Transforming document: ${path.basename(inputFilePath)} (pages_per_paper: ${pagesPerPaper}, orientation: ${options?.orientation || 'auto'}, size: ${options?.size || 'A4'}, repeat: ${repeatOnGrid})`
    );

    const outDir = destinationDir || path.dirname(inputFilePath);
    const rawBase = path.basename(inputFilePath, path.extname(inputFilePath));
    const safeBase = rawBase.replace(/[^a-zA-Z0-9_-]/g, '_');
    const outputFileName = `layout-${Date.now()}-${safeBase}.pdf`;
    const outputPath = path.join(outDir, outputFileName);

    if (!path.resolve(outputPath).startsWith(path.resolve(outDir))) {
      throw new Error(`Path traversal attempt detected during layout transformation`);
    }

    // 2. If pagesPerPaper === 1 and not an image needing re-tiling:
    if (pagesPerPaper === 1) {
      // If only odd duplex padding is needed without other overrides on native PDF:
      if (!isImage && !options?.size && !options?.orientation && shouldPadDuplex) {
        const lastPage = srcDoc.getPage(srcPageCount - 1);
        const { width, height } = lastPage.getSize();
        srcDoc.addPage([width, height]);
        const transformedPdfBytes = await srcDoc.save();
        fs.writeFileSync(outputPath, transformedPdfBytes);
        console.log(
          `[LayoutProcessor] Appended blank sheet terminator for duplex printing (Pages: ${srcPageCount} -> ${srcDoc.getPageCount()}): ${outputPath}`
        );
        return { outputPath, isTransformed: true };
      }

      // If paper size or orientation was requested, fit page onto target sheet
      const transformedPdfBytes = await this.renderSinglePageSheets(srcDoc, options);
      fs.writeFileSync(outputPath, transformedPdfBytes);
      return { outputPath, isTransformed: true };
    }

    // 3. Multi-page N-up tiling (2, 4, 6, 9, 16)
    const transformedPdfBytes = await this.renderNupSheets(srcDoc, pagesPerPaper, options);
    fs.writeFileSync(outputPath, transformedPdfBytes);

    console.log(
      `[LayoutProcessor] Successfully formatted document with ${pagesPerPaper} pages per sheet: ${outputPath}`
    );
    return { outputPath, isTransformed: true };
  }

  /**
   * Renders multi-page N-up sheets (e.g. 4 pages per sheet in 2x2 grid)
   */
  private async renderNupSheets(
    srcDoc: PDFDocument,
    pagesPerPaper: number,
    options?: PrintOptions | null
  ): Promise<Uint8Array> {
    const destDoc = await PDFDocument.create();

    // Determine target paper dimensions
    const [baseW, baseH] = this.getTargetPaperDimensions(options?.size);
    const isLandscape = this.determineOrientation(pagesPerPaper, options?.orientation);
    const sheetWidth = isLandscape ? Math.max(baseW, baseH) : Math.min(baseW, baseH);
    const sheetHeight = isLandscape ? Math.min(baseW, baseH) : Math.max(baseW, baseH);

    const grid = this.getGridConfig(pagesPerPaper, sheetWidth > sheetHeight);
    const slotsPerSheet = grid.cols * grid.rows;

    this.ensurePageContents(srcDoc);
    const embeddedPages = await destDoc.embedPages(srcDoc.getPages());
    const totalSrcPages = embeddedPages.length;

    // Check if repeat on grid is requested for 1-page document
    const shouldRepeat = (options?.repeat_image_on_grid ?? false) && totalSrcPages === 1;

    // Margins and paddings
    const margin = 14; // outer sheet margin in points
    const padding = 5; // cell inner padding in points

    const usableWidth = sheetWidth - 2 * margin;
    const usableHeight = sheetHeight - 2 * margin;
    const cellWidth = usableWidth / grid.cols;
    const cellHeight = usableHeight / grid.rows;

    let srcPageIndex = 0;

    while (srcPageIndex < totalSrcPages || (shouldRepeat && srcPageIndex === 0)) {
      const sheet = destDoc.addPage([sheetWidth, sheetHeight]);

      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          let pageToDraw: any = null;

          if (shouldRepeat) {
            pageToDraw = embeddedPages[0];
          } else if (srcPageIndex < totalSrcPages) {
            pageToDraw = embeddedPages[srcPageIndex];
            srcPageIndex++;
          } else {
            break; // No more pages for this sheet
          }

          // PDF coordinate system origin (0,0) is bottom-left
          // Row 0 is top row:
          const cellLeft = margin + c * cellWidth;
          const cellBottom = margin + (grid.rows - 1 - r) * cellHeight;

          const boxX = cellLeft + padding;
          const boxY = cellBottom + padding;
          const boxW = cellWidth - 2 * padding;
          const boxH = cellHeight - 2 * padding;

          // Preserve aspect ratio
          const pWidth = pageToDraw.width;
          const pHeight = pageToDraw.height;
          const scale = Math.min(boxW / pWidth, boxH / pHeight);

          const drawW = pWidth * scale;
          const drawH = pHeight * scale;
          const drawX = boxX + (boxW - drawW) / 2;
          const drawY = boxY + (boxH - drawH) / 2;

          sheet.drawPage(pageToDraw, {
            x: drawX,
            y: drawY,
            width: drawW,
            height: drawH
          });
        }
      }

      if (shouldRepeat) {
        // Repeated single page fills the sheet once
        break;
      }
    }

    this.padOddDuplex(destDoc, sheetWidth, sheetHeight, options);
    return destDoc.save();
  }

  /**
   * Renders 1-up sheets, fitting content onto the target size and orientation
   */
  private async renderSinglePageSheets(
    srcDoc: PDFDocument,
    options?: PrintOptions | null
  ): Promise<Uint8Array> {
    const destDoc = await PDFDocument.create();
    const [baseW, baseH] = this.getTargetPaperDimensions(options?.size);

    const isLandscape = options?.orientation?.toLowerCase() === 'landscape';
    const sheetWidth = isLandscape ? Math.max(baseW, baseH) : Math.min(baseW, baseH);
    const sheetHeight = isLandscape ? Math.min(baseW, baseH) : Math.max(baseW, baseH);

    this.ensurePageContents(srcDoc);
    const embeddedPages = await destDoc.embedPages(srcDoc.getPages());
    const margin = 12;

    for (const p of embeddedPages) {
      const sheet = destDoc.addPage([sheetWidth, sheetHeight]);
      const boxW = sheetWidth - 2 * margin;
      const boxH = sheetHeight - 2 * margin;

      const scale = Math.min(boxW / p.width, boxH / p.height);
      const drawW = p.width * scale;
      const drawH = p.height * scale;
      const drawX = margin + (boxW - drawW) / 2;
      const drawY = margin + (boxH - drawH) / 2;

      sheet.drawPage(p, {
        x: drawX,
        y: drawY,
        width: drawW,
        height: drawH
      });
    }

    this.padOddDuplex(destDoc, sheetWidth, sheetHeight, options);
    return destDoc.save();
  }

  /**
   * Appends an empty page to odd-page documents when duplex printing is requested.
   * This guarantees that the final physical sheet has a blank back side and is ejected
   * before any subsequent print job begins, eliminating cross-file page bleed-through.
   */
  private padOddDuplex(
    doc: PDFDocument,
    width: number,
    height: number,
    options?: PrintOptions | null
  ): boolean {
    const isDuplex = options?.sides === 'double' || options?.sides === 'duplex';
    if (!isDuplex) return false;

    let shouldPad = true;
    if (options?.pad_odd_duplex !== undefined) {
      shouldPad = Boolean(options.pad_odd_duplex);
    } else {
      try {
        const cfg = ConfigManager.getInstance().get();
        shouldPad = cfg.padOddDuplexFiles !== false;
      } catch {
        shouldPad = true;
      }
    }

    if (shouldPad && doc.getPageCount() % 2 !== 0) {
      doc.addPage([width, height]);
      console.log(
        `[LayoutProcessor] Appended blank sheet terminator for duplex printing (Total pages: ${doc.getPageCount()})`
      );
      return true;
    }
    return false;
  }

  /**
   * Converts a PNG or JPEG file into a PDF document
   */
  private async createPdfFromImage(
    imagePath: string,
    options?: PrintOptions | null
  ): Promise<PDFDocument> {
    const doc = await PDFDocument.create();
    const imageBytes = fs.readFileSync(imagePath);

    let embeddedImage: any;
    const isPng = imagePath.toLowerCase().endsWith('.png') || this.hasPngMagic(imageBytes);

    if (isPng) {
      embeddedImage = await doc.embedPng(imageBytes);
    } else {
      embeddedImage = await doc.embedJpg(imageBytes);
    }

    const [baseW, baseH] = this.getTargetPaperDimensions(options?.size);
    const isLandscape = options?.orientation?.toLowerCase() === 'landscape';
    const sheetW = isLandscape ? Math.max(baseW, baseH) : Math.min(baseW, baseH);
    const sheetH = isLandscape ? Math.min(baseW, baseH) : Math.max(baseW, baseH);

    const page = doc.addPage([sheetW, sheetH]);
    const margin = 15;
    const boxW = sheetW - 2 * margin;
    const boxH = sheetH - 2 * margin;

    const scale = Math.min(boxW / embeddedImage.width, boxH / embeddedImage.height);
    const drawW = embeddedImage.width * scale;
    const drawH = embeddedImage.height * scale;
    const drawX = margin + (boxW - drawW) / 2;
    const drawY = margin + (boxH - drawH) / 2;

    page.drawImage(embeddedImage, {
      x: drawX,
      y: drawY,
      width: drawW,
      height: drawH
    });

    // CRITICAL: pdf-lib requires the document to be serialized and reloaded before its pages can be
    // embedded into another document via destDoc.embedPages(). Otherwise, the image XObject stream
    // is dropped, resulting in a completely blank page output!
    const serializedBytes = await doc.save();
    return PDFDocument.load(serializedBytes);
  }

  public getGridConfig(pagesPerPaper: number, isLandscape: boolean): GridConfig {
    switch (pagesPerPaper) {
      case 2:
        return isLandscape ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
      case 4:
        return { cols: 2, rows: 2 };
      case 6:
        return isLandscape ? { cols: 3, rows: 2 } : { cols: 2, rows: 3 };
      case 9:
        return { cols: 3, rows: 3 };
      case 16:
        return { cols: 4, rows: 4 };
      default: {
        const cols = Math.ceil(Math.sqrt(pagesPerPaper));
        const rows = Math.ceil(pagesPerPaper / cols);
        return { cols, rows };
      }
    }
  }

  private determineOrientation(pagesPerPaper: number, requestedOrientation?: string): boolean {
    if (requestedOrientation) {
      return requestedOrientation.toLowerCase() === 'landscape';
    }
    // 2-up standard is landscape sheet so 2 portrait pages sit side-by-side
    if (pagesPerPaper === 2) {
      return true;
    }
    // 6-up standard is landscape for 3 cols x 2 rows
    if (pagesPerPaper === 6) {
      return true;
    }
    return false;
  }

  private getTargetPaperDimensions(size?: string): [number, number] {
    const key = (size || 'A4').toUpperCase();
    return PAGE_SIZES[key] || PAGE_SIZES.A4;
  }

  private isImageFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.bmp', '.webp'].includes(ext)) {
      return true;
    }
    try {
      const buffer = Buffer.alloc(8);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, 8, 0);
      fs.closeSync(fd);
      return this.hasPngMagic(buffer) || this.hasJpgMagic(buffer);
    } catch {
      return false;
    }
  }

  private hasPngMagic(buf: Buffer): boolean {
    return (
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a
    );
  }

  private hasJpgMagic(buf: Buffer): boolean {
    return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }

  private ensurePageContents(doc: PDFDocument): void {
    const pages = doc.getPages();
    for (const page of pages) {
      if (!page.node.Contents()) {
        page.drawText(' ', { x: 0, y: 0, size: 1 });
      }
    }
  }
}
