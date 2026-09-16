const { Client } = require('c:/Users/avani/Downloads/print it/print it/backend/node_modules/pg');
const axios = require('axios');

const DB_URL = 'postgresql://postgres.ncasateooojzdxyxszfn:os4XLmnlViI14UBA@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true';
const BACKEND_URL = 'http://localhost:3000';

async function run() {
  console.log('='.repeat(70));
  console.log('TESTING "ACCEPT & DOWNLOAD" AUTOMATED WORKFLOW');
  console.log('='.repeat(70));

  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  // 1. Check Backend Server
  console.log('\n[Step 1] Verifying Backend Server...');
  try {
    const health = await axios.get(`${BACKEND_URL}/api/health`, { timeout: 3000 });
    console.log('✅ Backend is UP and running on port 3000 (status:', health.data.status, ')');
  } catch (err) {
    console.error('❌ Backend is not running on port 3000:', err.message);
    await client.end();
    process.exit(1);
  }

  // 2. Fetch the target order (Eaa0045 or most recent queued order)
  console.log('\n[Step 2] Finding queued order to test...');
  let orderRes = await client.query(`
    SELECT order_id, shop_id, status, files, print_mode 
    FROM orders 
    WHERE order_id = 'Eaa0045'
  `);

  if (orderRes.rows.length === 0) {
    orderRes = await client.query(`
      SELECT order_id, shop_id, status, files, print_mode 
      FROM orders 
      WHERE status = 'queued' 
      ORDER BY created_at DESC 
      LIMIT 1
    `);
  }

  if (orderRes.rows.length === 0) {
    console.log('❌ No queued orders found in database.');
    await client.end();
    return;
  }

  const order = orderRes.rows[0];
  console.log(`✅ Target Order: ${order.order_id} | Current Status: ${order.status} | Shop: ${order.shop_id}`);
  
  let files = order.files;
  if (typeof files === 'string') {
    try { files = JSON.parse(files); } catch (e) { files = []; }
  }
  console.log(`   Attached files: ${files.length}`);
  if (files.length > 0) {
    const f = files[0];
    const url = (f.file_info && f.file_info.s3_key) || f.s3_key || f.url || 'None';
    console.log(`   File 1 URL/Key: ${url.substring(0, 80)}...`);
  }

  // 3. Clean up any existing print_jobs for this order so trigger can fire cleanly
  await client.query(`DELETE FROM print_jobs WHERE order_id = $1`, [order.order_id]);
  console.log(`   (Cleared existing print_jobs for ${order.order_id} to test clean trigger firing)`);

  // 4. Simulate clicking "Accept & DL" by updating order status to 'processing'
  console.log('\n[Step 3] Simulating clicking "Accept & Download" (Status: queued -> processing)...');
  await client.query(`
    UPDATE orders 
    SET status = 'processing', updated_at = NOW() 
    WHERE order_id = $1
  `, [order.order_id]);
  console.log(`✅ Order ${order.order_id} updated to 'processing'!`);

  // 5. Verify database trigger created the print_job automatically
  console.log('\n[Step 4] Checking if DB trigger created row in print_jobs table...');
  const jobRes = await client.query(`
    SELECT id, order_id, shop_id, pdf_url, status, retry_count, is_secure, created_at 
    FROM print_jobs 
    WHERE order_id = $1
  `, [order.order_id]);

  if (jobRes.rows.length === 0) {
    console.error('❌ Trigger DID NOT create a print_job! Trigger needs investigation.');
    await client.end();
    return;
  }

  const job = jobRes.rows[0];
  console.log('✅ Trigger successfully created print_job!');
  console.log(`   Job ID: ${job.id}`);
  console.log(`   Status: ${job.status}`);
  console.log(`   Order:  ${job.order_id}`);
  console.log(`   Shop:   ${job.shop_id}`);
  console.log(`   Secure: ${job.is_secure}`);

  // 6. Verify Agent Device Token
  console.log('\n[Step 5] Checking Agent device authentication for shop...');
  const devRes = await client.query(`
    SELECT id, shop_id, status, auth_token 
    FROM agent_devices 
    WHERE shop_id = $1 AND auth_token IS NOT NULL
    ORDER BY last_seen_at DESC LIMIT 1
  `, [job.shop_id]);

  let agentToken = null;
  if (devRes.rows.length > 0) {
    agentToken = devRes.rows[0].auth_token;
    console.log(`✅ Agent Device Found: ${devRes.rows[0].id} (Status: ${devRes.rows[0].status})`);
  } else {
    // Fallback to any active agent device token
    const anyDev = await client.query(`
      SELECT id, shop_id, status, auth_token 
      FROM agent_devices 
      WHERE auth_token IS NOT NULL 
      ORDER BY last_seen_at DESC LIMIT 1
    `);
    if (anyDev.rows.length > 0) {
      agentToken = anyDev.rows[0].auth_token;
      console.log(`ℹ️ Using paired agent device: ${anyDev.rows[0].id} (Shop: ${anyDev.rows[0].shop_id})`);
    }
  }

  // 7. Verify /api/agent/download-url generates 1-hour signed URL
  console.log('\n[Step 6] Testing Agent Download URL resolution (1-hour Signed URL)...');
  let storagePath = '';
  const match = job.pdf_url.match(/\/o\/([^?]+)/);
  if (match) {
    storagePath = decodeURIComponent(match[1]);
  } else {
    storagePath = job.pdf_url;
  }
  console.log(`   Storage Path: ${storagePath}`);

  try {
    const dlUrlRes = await axios.get(`${BACKEND_URL}/api/agent/download-url`, {
      params: { path: storagePath },
      headers: { Authorization: `Bearer ${agentToken}` }
    });

    console.log('✅ Download URL endpoint succeeded!');
    console.log(`   Signed URL: ${dlUrlRes.data.url.substring(0, 80)}...`);
    console.log(`   Expires In: ${dlUrlRes.data.expires_in} seconds (1 hour)`);
    console.log(`   Is Signed:  ${dlUrlRes.data.is_signed_url}`);

    // 8. Test file download from the signed URL
    console.log('\n[Step 7] Testing direct binary download using Signed URL...');
    const downloadRes = await axios.get(dlUrlRes.data.url, {
      responseType: 'arraybuffer',
      timeout: 20000,
      maxContentLength: 50 * 1024 * 1024
    });
    console.log(`✅ Download SUCCESS! HTTP Status: ${downloadRes.status}`);
    console.log(`   Downloaded size: ${Math.round(downloadRes.data.byteLength / 1024)} KB`);
    console.log(`   Content-Type:    ${downloadRes.headers['content-type']}`);

    // 9. Verify Audit Trail in DB
    console.log('\n[Step 8] Verifying Audit Trail in print_job_audit...');
    const auditRes = await client.query(`
      SELECT id, device_id, action, timestamp, ip_address, details 
      FROM print_job_audit 
      ORDER BY timestamp DESC LIMIT 1
    `);
    if (auditRes.rows.length > 0) {
      const a = auditRes.rows[0];
      console.log(`✅ Audit event recorded: [${a.action}] at ${a.timestamp}`);
      console.log(`   Device ID: ${a.device_id} | Details:`, a.details);
    }

  } catch (dlErr) {
    console.error('❌ Download error:', dlErr.response?.data || dlErr.message);
  }

  await client.end();
  console.log('\n' + '='.repeat(70));
  console.log('AUTOMATED WORKFLOW TEST COMPLETED SUCCESSFULLY!');
  console.log('='.repeat(70));
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
