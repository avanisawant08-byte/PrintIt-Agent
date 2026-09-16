import fs from 'fs';
import path from 'path';
import { getPrinters, print } from 'pdf-to-printer';
import { PrinterDevice } from './types';
import { getUserDataDir } from './paths';

export const VIRTUAL_PRINTER_NAME = 'Virtual Test Printer (Save to Disk)';

export class PrinterService {
  private static instance: PrinterService;

  private constructor() {}

  public static getInstance(): PrinterService {
    if (!PrinterService.instance) {
      PrinterService.instance = new PrinterService();
    }
    return PrinterService.instance;
  }

  /**
   * Retrieves all available printers installed on the Windows host,
   * plus a built-in Virtual Test Printer for hardware-free development and testing.
   */
  public async getAvailablePrinters(): Promise<PrinterDevice[]> {
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

    return list;
  }

  /**
   * Silently prints a PDF file using SumatraPDF under the hood,
   * or routes to virtual disk output if Virtual Test Printer is selected.
   */
  public async printPdf(filePath: string, printerName?: string, copies: number = 1): Promise<{ savedPath?: string }> {
    console.log(`[PrinterService] Initiating print for file: ${filePath}`);
    console.log(`[PrinterService] Target printer: ${printerName || 'SYSTEM DEFAULT'}, Copies: ${copies}`);

    // Hardware-free Virtual Printer Mode
    if (printerName === VIRTUAL_PRINTER_NAME) {
      return this.printToVirtualDisk(filePath, copies);
    }

    const options: any = {
      silent: true,
      copies: Math.max(1, copies)
    };

    if (printerName && printerName.trim().length > 0) {
      options.printer = printerName;
    }

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
}
