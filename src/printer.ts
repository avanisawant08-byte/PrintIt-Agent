import fs from 'fs';
import path from 'path';
import { getPrinters, print } from 'pdf-to-printer';
import { PrinterDevice, PrintOptions, AgentConfig } from './types';
import { getUserDataDir } from './paths';
import { logger } from './logger';

export const VIRTUAL_PRINTER_NAME = 'Virtual Test Printer (Save to Disk)';

export class PrinterService {
  private static instance: PrinterService;
  private cachedPrinters: PrinterDevice[] | null = null;
  private lastPrinterFetchTime = 0;
  private readonly PRINTER_CACHE_TTL_MS = 15000;

  private constructor() {}

  public static getInstance(): PrinterService {
    if (!PrinterService.instance) {
      PrinterService.instance = new PrinterService();
    }
    return PrinterService.instance;
  }

  /**
   * Deterministically resolves the target printer based on job options (B&W vs Color)
   * and verifies that the selected printer is available on this system.
   */
  public async resolveTargetPrinter(
    printOptions?: PrintOptions | null,
    config?: AgentConfig
  ): Promise<string> {
    const isColor = printOptions?.color === 'color' || printOptions?.color === 'c';
    let chosenPrinter = printOptions?.printer_name;

    if (!chosenPrinter) {
      if (isColor && config?.selectedPrinterColor) {
        chosenPrinter = config.selectedPrinterColor;
      } else if (!isColor && config?.selectedPrinterBw) {
        chosenPrinter = config.selectedPrinterBw;
      } else {
        chosenPrinter = config?.selectedPrinter;
      }
    }

    // Verify availability against installed printers
    if (chosenPrinter && chosenPrinter !== VIRTUAL_PRINTER_NAME) {
      const available = await this.getAvailablePrinters();
      const exists = available.some((p) => p.name.toLowerCase() === chosenPrinter!.toLowerCase());
      if (!exists) {
        throw new Error(
          `Printer Unavailable: Configured target printer "${chosenPrinter}" is not found or offline on this system.`
        );
      }
    }

    return chosenPrinter || VIRTUAL_PRINTER_NAME;
  }

  /**
   * Retrieves all available printers installed on the Windows host,
   * plus a built-in Virtual Test Printer for hardware-free development and testing.
   * Caches results for 15 seconds to eliminate UI and tray latency on Windows spooler queries.
   */
  public async getAvailablePrinters(forceRefresh = false): Promise<PrinterDevice[]> {
    if (!forceRefresh && this.cachedPrinters && (Date.now() - this.lastPrinterFetchTime < this.PRINTER_CACHE_TTL_MS)) {
      return [...this.cachedPrinters];
    }

    const list: PrinterDevice[] = [
      {
        deviceId: 'virtual-test-printer',
        name: VIRTUAL_PRINTER_NAME,
        isDefault: false
      }
    ];

    try {
      const osPrinters = await getPrinters();
      const mapped = osPrinters.map((p) => ({
        deviceId: p.deviceId || p.name,
        name: p.name,
        isDefault: Boolean((p as any).isDefault)
      }));
      list.push(...mapped);
    } catch (err) {
      console.error('[PrinterService] Error fetching Windows printers:', err);
    }

    this.cachedPrinters = list;
    this.lastPrinterFetchTime = Date.now();
    return list;
  }

  /**
   * Silently prints a PDF file using SumatraPDF under the hood,
   * or routes to virtual disk output if Virtual Test Printer is selected.
   */
  public async printPdf(
    filePath: string,
    printerName?: string,
    copies: number = 1,
    printOptions?: PrintOptions | null
  ): Promise<{ savedPath?: string }> {
    console.log(`[PrinterService] Initiating print for file: ${filePath}`);
    console.log(
      `[PrinterService] Target printer: ${printerName || 'SYSTEM DEFAULT'}, Copies: ${copies}, Options: ${JSON.stringify(printOptions || {})}`
    );

    // Hardware-free Virtual Printer Mode
    if (printerName === VIRTUAL_PRINTER_NAME) {
      return this.printToVirtualDisk(filePath, copies);
    }

    const options = this.buildDriverOptions(printerName, copies, printOptions);

    try {
      await print(filePath, options);
      console.log(`[PrinterService] Print job spooled successfully to: ${printerName || 'SYSTEM DEFAULT'}`);
      return {};
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      console.error(`[PrinterService] Failed to print document silently:`, errorMsg);
      throw new Error(`Silent print failed on printer "${printerName || 'DEFAULT'}": ${errorMsg}`);
    }
  }

  private async printToVirtualDisk(filePath: string, copies: number): Promise<{ savedPath: string }> {
    const outDir = path.join(process.cwd(), 'output_prints');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const fileName = `virtual-print-${Date.now()}.pdf`;
    const destPath = path.join(outDir, fileName);

    fs.copyFileSync(filePath, destPath);
    console.log(`[PrinterService] [VIRTUAL PRINTER] Saved ${copies} copy/copies to: ${destPath}`);

    // Small delay to simulate spooler latency
    await new Promise((resolve) => setTimeout(resolve, 400));
    return { savedPath: destPath };
  }

  /**
   * Constructs validated driver options for physical printing via SumatraPDF
   */
  public buildDriverOptions(
    printerName?: string,
    copies: number = 1,
    printOptions?: PrintOptions | null
  ): Record<string, any> {
    const options: any = {
      silent: true,
      copies: Math.max(1, copies)
    };

    if (printerName && printerName.trim().length > 0) {
      const trimmedPrinter = printerName.trim();
      // Whitelist printer names to prevent shell / argument injection
      if (!/^[\w\s\-.():\\/]+$/.test(trimmedPrinter)) {
        throw new Error(`Security Violation: Illegal characters detected in printer name: "${trimmedPrinter}"`);
      }
      options.printer = trimmedPrinter;
    }

    // Pass options to physical printer driver via SumatraPDF with strict validation
    if (printOptions) {
      if (printOptions.color === 'bw') {
        options.monochrome = true;
      }
      if (printOptions.sides === 'double') {
        options.side = 'duplex';
      } else if (printOptions.sides === 'single') {
        options.side = 'simplex';
      }
      if (printOptions.size) {
        const sizeStr = String(printOptions.size).trim();
        if (/^[\w\-]+$/.test(sizeStr)) {
          options.paperSize = sizeStr;
        }
      }
      if (printOptions.page_range) {
        const rangeStr = String(printOptions.page_range).trim();
        if (/^[0-9,\-\s]+$/.test(rangeStr)) {
          options.pages = rangeStr;
        } else {
          console.warn(`[PrinterService] Ignored invalid page_range format: "${rangeStr}"`);
        }
      }
    }

    return options;
  }
}
