const { Client } = require('c:/Users/avani/Downloads/print it/print it/backend/node_modules/pg');

const client = new Client({
  connectionString: 'postgresql://postgres.ncasateooojzdxyxszfn:os4XLmnlViI14UBA@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true'
});

async function main() {
  await client.connect();
  
  const createSql = `
    CREATE TABLE IF NOT EXISTS print_job_audit (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id UUID REFERENCES print_jobs(id) ON DELETE SET NULL,
      device_id UUID REFERENCES agent_devices(id) ON DELETE SET NULL,
      action VARCHAR(50) NOT NULL,
      timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      ip_address VARCHAR(50),
      details JSONB
    );
    CREATE INDEX IF NOT EXISTS idx_print_job_audit_job ON print_job_audit(job_id);
    CREATE INDEX IF NOT EXISTS idx_print_job_audit_device ON print_job_audit(device_id);
  `;
  
  await client.query(createSql);
  console.log('✅ print_job_audit table verified/created successfully.');
  
  await client.end();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
