const { ConfigManager } = require('../dist/config');
const { SupabaseService } = require('../dist/supabase');
const { RealtimeManager } = require('../dist/realtime');
const { DedupDatabase } = require('../dist/dedup');

async function testAgentExecution() {
  console.log('--- TEST AGENT REALTIME & EXECUTION ---');
  
  // 1. Initialize Dedup
  const dedup = DedupDatabase.getInstance();
  await dedup.init();

  // 2. Check config
  const config = ConfigManager.getInstance();
  const cfg = config.get();
  console.log('Config loaded:');
  console.log('  Shop ID:', cfg.shopId);
  console.log('  Device ID:', cfg.deviceId);
  console.log('  Printer:', cfg.selectedPrinter);
  console.log('  Supabase URL:', cfg.supabaseUrl);
  console.log('  Is paired?:', config.isPaired());

  // 3. Check Supabase
  const supa = SupabaseService.getInstance();
  const client = supa.getClient();
  console.log('Supabase client initialized:', Boolean(client));

  // 4. Test query pending jobs
  console.log('Testing getPendingJobs for shop:', cfg.shopId);
  const pending = await supa.getPendingJobs(cfg.shopId);
  console.log(`Found ${pending.length} pending jobs:`, pending);

  // 5. Test RealtimeManager catch-up
  console.log('Starting RealtimeManager...');
  const realtime = RealtimeManager.getInstance();
  await realtime.start();

  // Wait 10 seconds to observe polling & execution
  await new Promise(r => setTimeout(r, 10000));

  console.log('Stopping RealtimeManager...');
  await realtime.stop();
  console.log('--- TEST COMPLETE ---');
  process.exit(0);
}

testAgentExecution().catch((err) => {
  console.error(err);
  process.exit(1);
});
