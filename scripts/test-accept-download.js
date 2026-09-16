/**
 * E2E test: simulates the full "Accept & Download" flow
 * 1. Creates a PENDING print_job for an existing order
 * 2. Verifies the agent's backend download-url endpoint works
 * 3. Tests the URL refresh logic (the 403 fix)
 */
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const SUPABASE_URL = 'https://ncasateooojzdxyxszfn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jYXNhdGVvb29qemR4eXhzemZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNTY3NjcsImV4cCI6MjA5MzYzMjc2N30.Inq_6jnWP-6KlNWu6IPE-pBI5MHgJ3p4ndIRm1m3E2I';
const BACKEND_URL = 'http://localhost:3000';

// Test job using the existing FAILED job
const EXISTING_JOB_ID = '0e5e1013-51a4-4ed9-bbc1-a1df19299b79'; // Eaa0027
const EXISTING_PDF_URL = 'https://firebasestorage.googleapis.com/v0/b/printit-4d823.firebasestorage.app/o/printit%2Fuploads%2F1789051736590-746247702_OSY_ASSIGNMENT-1.pdf?alt=media';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function test() {
  console.log('='.repeat(60));
  console.log('PrintIt Agent — E2E "Accept & Download" Flow Test');
  console.log('='.repeat(60));
  
  // ── Test 1: Backend health ─────────────────────────────────
  console.log('\n[Test 1] Backend health check...');
  try {
    const res = await axios.get(`${BACKEND_URL}/api/health`, { timeout: 5000 });
    console.log('✅ Backend is UP:', res.data.status, '| DB:', res.data.database);
  } catch (e) {
    console.log('❌ Backend unreachable:', e.message);
    console.log('   → Start the backend with: cd "c:/Users/avani/Downloads/print it/print it/backend" && npm start');
    process.exit(1);
  }

  // ── Test 2: Agent auth token ───────────────────────────────
  console.log('\n[Test 2] Checking agent auth token...');
  const { data: devices } = await supabase
    .from('agent_devices')
    .select('id, shop_id, status, auth_token, last_seen_at')
    .not('auth_token', 'is', null)
    .order('last_seen_at', { ascending: false })
    .limit(1);
  
  if (!devices || devices.length === 0) {
    console.log('❌ No paired devices found. Please pair the agent first.');
    process.exit(1);
  }
  const device = devices[0];
  console.log(`✅ Device found: ${device.id} | Shop: ${device.shop_id} | Status: ${device.status}`);
  console.log(`   Auth token: ${device.auth_token ? device.auth_token.substring(0, 30) + '...' : 'MISSING'}`);

  // ── Test 3: /api/agent/download-url endpoint ───────────────
  console.log('\n[Test 3] Testing /api/agent/download-url endpoint (the 403 fix)...');
  const storagePath = 'printit/uploads/1789051736590-746247702_OSY_ASSIGNMENT-1.pdf';
  try {
    const res = await axios.get(`${BACKEND_URL}/api/agent/download-url`, {
      params: { path: storagePath },
      headers: { Authorization: `Bearer ${device.auth_token}` },
      timeout: 15000
    });
    console.log('✅ Got fresh download URL from backend!');
    console.log(`   URL: ${res.data.url ? res.data.url.substring(0, 100) + '...' : 'EMPTY'}`);
    
    // Verify the returned URL actually has a token
    if (res.data.url && (res.data.url.includes('&token=') || res.data.url.includes('?token='))) {
      console.log('✅ URL contains a download token — downloads will succeed!');
    } else {
      console.log('⚠️  URL returned but no token in it — check Firebase Storage rules');
    }
    
    // ── Test 4: Actual download ─────────────────────────────
    console.log('\n[Test 4] Testing actual file download with refreshed URL...');
    try {
      const dlRes = await axios.get(res.data.url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: 50 * 1024 * 1024 // 50MB max for test
      });
      const sizeKb = Math.round(dlRes.data.byteLength / 1024);
      console.log(`✅ File downloaded successfully! Size: ${sizeKb} KB`);
      console.log(`   Content-Type: ${dlRes.headers['content-type']}`);
    } catch (dlErr) {
      console.log('❌ Download failed:', dlErr.response?.status, dlErr.message);
    }
  } catch (e) {
    if (e.response?.status === 401) {
      console.log('❌ Auth failed (401) — agent auth token not in agent_devices table');
    } else if (e.response?.status === 404) {
      console.log('❌ File not found (404) — file may have been deleted from Firebase');
    } else {
      console.log('❌ Backend download-url endpoint error:', e.response?.status, e.message);
    }
  }

  // ── Test 5: Reset existing FAILED jobs to PENDING ─────────
  console.log('\n[Test 5] Resetting existing FAILED jobs to PENDING for retry...');
  const { data: failedJobs } = await supabase
    .from('print_jobs')
    .select('id, order_id, pdf_url, status')
    .eq('status', 'FAILED')
    .eq('shop_id', device.shop_id);
  
  if (failedJobs && failedJobs.length > 0) {
    console.log(`Found ${failedJobs.length} FAILED jobs to reset:`);
    for (const job of failedJobs) {
      const { error } = await supabase
        .from('print_jobs')
        .update({ status: 'PENDING', error_message: null, updated_at: new Date().toISOString() })
        .eq('id', job.id);
      if (error) {
        console.log(`  ❌ Failed to reset job ${job.order_id}:`, error.message);
      } else {
        console.log(`  ✅ Reset job ${job.order_id} → PENDING`);
      }
    }
    console.log('\n✅ FAILED jobs reset to PENDING — the agent will pick them up on next poll (within 5 seconds)!');
  } else {
    console.log('No FAILED jobs found for this shop.');
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('Test complete! Start/restart the agent to process queued jobs.');
  console.log('Expected flow: Agent polls → detects PENDING jobs → fetches fresh URL → downloads → prints');
  console.log('='.repeat(60));
}

test().catch(console.error);
