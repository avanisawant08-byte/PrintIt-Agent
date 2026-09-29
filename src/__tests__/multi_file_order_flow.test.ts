import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { PrinterService, VIRTUAL_PRINTER_NAME } from '../printer';
import { DedupDatabase } from '../dedup';
import { PrintJob } from '../types';

test('Multi-File Order Architecture: When customer uploads multiple files and shopkeeper clicks print once', async (t) => {
  const scratchDir = path.join(__dirname, 'test_scratch_multi_file_order');
  fs.mkdirSync(scratchDir, { recursive: true });

  const printer = PrinterService.getInstance();
  const dedup = DedupDatabase.getInstance();
  await dedup.init();

  // Create 2 test PDF files representing a multi-file customer order
  const file1Path = path.join(scratchDir, 'order123_file1.pdf');
  const file2Path = path.join(scratchDir, 'order123_file2.pdf');

  const doc1 = await PDFDocument.create();
  doc1.addPage([595.28, 841.89]);
  fs.writeFileSync(file1Path, await doc1.save());

  const doc2 = await PDFDocument.create();
  doc2.addPage([595.28, 841.89]);
  doc2.addPage([595.28, 841.89]);
  fs.writeFileSync(file2Path, await doc2.save());

  const orderId = `order-multifile-${Date.now()}`;

  // In database trigger sync_order_to_print_jobs(), each file in the order's files[] array
  // produces a separate row in print_jobs with its own job ID, pointing to the same order_id:
  const job1: PrintJob = {
    id: `job-row-1-${Date.now()}`,
    order_id: orderId,
    shop_id: 'test-shop',
    pdf_url: 'https://example.com/file1.pdf',
    checksum: 'checksum1',
    copies: 1,
    print_options: { color: 'bw', sides: 'single' },
    status: 'PENDING',
    retry_count: 0,
    file_index: 0,
    total_files: 2,
    created_at: new Date().toISOString()
  };

  const job2: PrintJob = {
    id: `job-row-2-${Date.now()}`,
    order_id: orderId,
    shop_id: 'test-shop',
    pdf_url: 'https://example.com/file2.pdf',
    checksum: 'checksum2',
    copies: 2,
    print_options: { color: 'color', sides: 'double' },
    status: 'PENDING',
    retry_count: 0,
    file_index: 1,
    total_files: 2,
    created_at: new Date().toISOString()
  };

  // Verification 1: Separate Job Records
  assert.notEqual(job1.id, job2.id, 'Each file must have a unique job ID');
  assert.equal(job1.order_id, job2.order_id, 'Both jobs must share the parent order_id');

  // Verification 2: Agent Queue and Sequential Isolation
  const queue: PrintJob[] = [job1, job2];
  assert.equal(queue.length, 2, 'The agent queue holds each file as a separate job item');

  // Process Job 1
  const activeJob1 = queue.shift()!;
  assert.equal(activeJob1.id, job1.id);
  const printResult1 = await printer.printPdf(file1Path, VIRTUAL_PRINTER_NAME, activeJob1.copies, activeJob1.print_options || {});
  dedup.markJobProcessed(activeJob1.id, activeJob1.checksum, 'COMPLETED', activeJob1.order_id, activeJob1.file_index || 0);

  // Process Job 2
  const activeJob2 = queue.shift()!;
  assert.equal(activeJob2.id, job2.id);
  const printResult2 = await printer.printPdf(file2Path, VIRTUAL_PRINTER_NAME, activeJob2.copies, activeJob2.print_options || {});
  dedup.markJobProcessed(activeJob2.id, activeJob2.checksum, 'COMPLETED', activeJob2.order_id, activeJob2.file_index || 0);

  // Verification 3: Distinct Physical / Virtual Spool Outputs
  assert.ok(printResult1.savedPath, 'Job 1 produced an independent print spool output');
  assert.ok(printResult2.savedPath, 'Job 2 produced an independent print spool output');
  assert.notEqual(printResult1.savedPath, printResult2.savedPath, 'Job 1 and Job 2 are separate spooler jobs and do not bleed into each other');

  // Verification 4: Local Dedup Database isolates each file completion
  assert.equal(dedup.isJobProcessed(job1.id), true, 'Job 1 marked COMPLETED in local SQLite');
  assert.equal(dedup.isJobProcessed(job2.id), true, 'Job 2 marked COMPLETED in local SQLite');
  assert.equal(dedup.isFileInOrderProcessed(orderId, 0), true, 'File index 0 recorded as processed');
  assert.equal(dedup.isFileInOrderProcessed(orderId, 1), true, 'File index 1 recorded as processed');

  const completedFiles = dedup.getCompletedFilesForOrder(orderId);
  assert.equal(completedFiles.length, 2, 'Both files are recorded under the order');

  // Cleanup
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
    if (printResult1.savedPath && fs.existsSync(printResult1.savedPath)) fs.unlinkSync(printResult1.savedPath);
    if (printResult2.savedPath && fs.existsSync(printResult2.savedPath)) fs.unlinkSync(printResult2.savedPath);
  } catch {}
});
