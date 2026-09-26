import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { logger } from './logger';

export class PageSelector {
  private static instance: PageSelector;

  private constructor() {}

  public static getInstance(): PageSelector {
    if (!PageSelector.instance) {
      PageSelector.instance = new PageSelector();
    }
    return PageSelector.instance;
  }

  /**
   * Parses and validates a page selection string against the actual document page count.
   *
   * Grammar supported:
   * - Single pages: "1, 3, 7"
   * - Hyphenated ranges: "1-3, 7, 10-12"
   * - Out-of-order & reverse: "3, 1" or "5-3" (5, 4, 3)
   * - Repeats / duplicates: "1, 1, 2"
   * - "all" (case-insensitive) or undefined/null: returns null (indicating full document)
   *
   * Throws an explicit, actionable error if:
   * - The selection is empty or whitespace
   * - The format contains illegal tokens
   * - Any requested page is <= 0 or exceeds totalPages (FR-4)
   */
  public parsePageSelection(selectionStr?: string | null, totalPages: number = 1): number[] | null {
    if (selectionStr === undefined || selectionStr === null) {
      return null;
    }

    const trimmed = selectionStr.trim();
    if (trimmed === '') {
      throw new Error(`Invalid page selection: string is empty or contains only whitespace.`);
    }

    if (trimmed.toLowerCase() === 'all') {
      return null;
    }

    const tokens = trimmed.split(',');
    const resolvedPages: number[] = [];
    const maxTokensLimit = Math.max(1000, totalPages * 20);

    for (const rawToken of tokens) {
      const token = rawToken.trim();
      if (!token) {
        throw new Error(
          `Invalid page selection format: empty token detected in "${selectionStr}". Double commas are not allowed.`
        );
      }

      // Check for range: e.g. "1-3" or "5-3"
      if (token.includes('-')) {
        const rangeMatch = token.match(/^(\d+)\s*-\s*(\d+)$/);
        if (!rangeMatch) {
          throw new Error(
            `Invalid page selection range: "${token}". Expected format "start-end" with positive integers (e.g. 1-5).`
          );
        }

        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);

        this.validatePageNumber(start, totalPages, token);
        this.validatePageNumber(end, totalPages, token);

        if (start <= end) {
          for (let p = start; p <= end; p++) {
            resolvedPages.push(p);
            this.checkLimit(resolvedPages.length, maxTokensLimit);
          }
        } else {
          // Descending range: e.g. 5-3 -> 5, 4, 3
          for (let p = start; p >= end; p--) {
            resolvedPages.push(p);
            this.checkLimit(resolvedPages.length, maxTokensLimit);
          }
        }
      } else {
        // Single page token: e.g. "7"
        if (!/^\d+$/.test(token)) {
          throw new Error(
            `Invalid page selection format: "${token}". Expected a page number (e.g. 3) or range (e.g. 1-5).`
          );
        }

        const pageNum = parseInt(token, 10);
        this.validatePageNumber(pageNum, totalPages, token);
        resolvedPages.push(pageNum);
        this.checkLimit(resolvedPages.length, maxTokensLimit);
      }
    }

    if (resolvedPages.length === 0) {
      throw new Error(`Invalid page selection: no valid page numbers resolved from "${selectionStr}".`);
    }

    return resolvedPages;
  }

  private validatePageNumber(page: number, totalPages: number, tokenContext: string): void {
    if (page < 1) {
      throw new Error(
        `Invalid page selection: page ${page} in token "${tokenContext}" is invalid. Page numbers must be greater than or equal to 1.`
      );
    }
    if (page > totalPages) {
      throw new Error(
        `Page ${page} requested but document only has ${totalPages} page${totalPages === 1 ? '' : 's'}.`
      );
    }
  }

  private checkLimit(currentLength: number, maxLimit: number): void {
    if (currentLength > maxLimit) {
      throw new Error(
        `Page selection exceeds maximum limit of ${maxLimit} pages. Please request a smaller subset.`
      );
    }
  }

  /**
   * Extracts the requested page subset from the input PDF file and creates a new PDF document.
   *
   * Returns:
   * - outputPath: path to the subset PDF (or original if selection was "all"/null)
   * - isExtracted: boolean indicating whether subset extraction was performed
   * - pageCount: page count of the resulting document
   * - requestedPages: array of 1-based page numbers requested
   */
  public async extractPageSubset(
    inputPdfPath: string,
    selectionStr?: string | null,
    destinationDir?: string
  ): Promise<{
    outputPath: string;
    isExtracted: boolean;
    pageCount: number;
    requestedPages?: number[];
  }> {
    if (!fs.existsSync(inputPdfPath)) {
      throw new Error(`[PageSelector] Input file does not exist: ${inputPdfPath}`);
    }

    if (this.isImageFile(inputPdfPath)) {
      const resolvedPages = this.parsePageSelection(selectionStr, 1);
      if (!resolvedPages || (resolvedPages.length === 1 && resolvedPages[0] === 1)) {
        return {
          outputPath: inputPdfPath,
          isExtracted: false,
          pageCount: 1,
          requestedPages: resolvedPages || [1]
        };
      }
    }

    const srcBuffer = fs.readFileSync(inputPdfPath);
    const srcDoc = await PDFDocument.load(srcBuffer);
    const totalPages = srcDoc.getPageCount();

    if (totalPages === 0) {
      throw new Error(`[PageSelector] Source document contains 0 pages: ${inputPdfPath}`);
    }

    const resolvedPages = this.parsePageSelection(selectionStr, totalPages);

    // If no page subset requested (null = full document)
    if (!resolvedPages) {
      return {
        outputPath: inputPdfPath,
        isExtracted: false,
        pageCount: totalPages
      };
    }

    logger.info(
      'PageSelector',
      `Extracting ${resolvedPages.length} page(s) [${resolvedPages.join(', ')}] from ${path.basename(inputPdfPath)} (total: ${totalPages} pages)`
    );

    // Build the new PDF with the exact requested page sequence
    const destDoc = await PDFDocument.create();
    const pageIndices0Based = resolvedPages.map((p) => p - 1);
    const copiedPages = await destDoc.copyPages(srcDoc, pageIndices0Based);

    for (const page of copiedPages) {
      destDoc.addPage(page);
    }

    const destBytes = await destDoc.save();

    const outDir = destinationDir || path.dirname(inputPdfPath);
    const rawBase = path.basename(inputPdfPath, path.extname(inputPdfPath));
    const safeBase = rawBase.replace(/[^a-zA-Z0-9_-]/g, '_');
    const outputFileName = `subset-${Date.now()}-${safeBase}.pdf`;
    const outputPath = path.join(outDir, outputFileName);

    if (!path.resolve(outputPath).startsWith(path.resolve(outDir))) {
      throw new Error(`Path traversal attempt detected during page subset extraction`);
    }

    fs.writeFileSync(outputPath, destBytes);

    return {
      outputPath,
      isExtracted: true,
      pageCount: copiedPages.length,
      requestedPages: resolvedPages
    };
  }

  private isImageFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.bmp', '.webp'].includes(ext);
  }
}
