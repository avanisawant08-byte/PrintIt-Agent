const path = require('path');
const crypto = require('crypto');
const { getDbClient } = require('./db.js');

async function main() {
  const client = getDbClient();
  await client.connect();
  console.log('Connected to Supabase Postgres.');

  // Find all FAILED jobs or jobs without download tokens
  const targetJobs = await client.query(`
    SELECT id, order_id, shop_id, pdf_url, status, retry_count, error_message
    FROM print_jobs
    WHERE status = 'FAILED' OR (status = 'PENDING' AND (pdf_url NOT LIKE '%&token=%' OR pdf_url IS NULL))
    ORDER BY created_at DESC
  `);

  console.log(`Found ${targetJobs.rows.length} job(s) requiring reset or token attachment.`);

  if (targetJobs.rows.length === 0) {
    console.log('No jobs to process.');
    await client.end();
    return;
  }

  let getStorage;
  try {
    let fb;
    try {
      fb = require('../backend/src/config/firebase.js');
    } catch {
      fb = require('c:/Users/avani/Downloads/print it/print it/backend/src/config/firebase.js');
    }
    getStorage = fb.getStorage;
  } catch (e) {
    console.warn('Could not load Firebase Admin SDK:', e.message);
  }

  for (const job of targetJobs.rows) {
    console.log(`\nProcessing job ${job.order_id} (ID: ${job.id})...`);
    let newPdfUrl = job.pdf_url;

    // If pdf_url is missing a token and we have Firebase Admin, add token to storage file and url
    if (newPdfUrl && !newPdfUrl.includes('&token=') && getStorage) {
      try {
        const bucket = getStorage().bucket();
        // Extract storage path from url
        const match = newPdfUrl.match(/\/o\/([^?]+)/);
        if (match) {
          const storagePath = decodeURIComponent(match[1]);
          const file = bucket.file(storagePath);
          const [exists] = await file.exists();
          if (exists) {
            const [meta] = await file.getMetadata();
            let token = meta.metadata && meta.metadata.firebaseStorageDownloadTokens;
            if (!token) {
              token = crypto.randomUUID();
              await file.setMetadata({
                metadata: {
                  ...(meta.metadata || {}),
                  firebaseStorageDownloadTokens: token
                }
              });
              console.log(`  -> Attached download token to Firebase Storage: ${storagePath}`);
            }
            const bucketName = bucket.name || 'printit-4d823.firebasestorage.app';
            newPdfUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
            console.log(`  -> Updated URL with token: ${newPdfUrl}`);
          }
        }
      } catch (fbErr) {
        console.warn(`  -> Could not update token for ${job.order_id}:`, fbErr.message);
      }
    }

    // Reset job to PENDING
    await client.query(`
      UPDATE print_jobs
      SET status = 'PENDING',
          retry_count = 0,
          error_message = NULL,
          pdf_url = $1,
          updated_at = NOW()
      WHERE id = $2
    `, [newPdfUrl, job.id]);

    console.log(`  -> Reset job ${job.order_id} to PENDING.`);
  }

  console.log('\nAll failed jobs successfully reset to PENDING!');
  await client.end();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
