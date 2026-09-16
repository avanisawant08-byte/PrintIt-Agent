const { Client } = require('c:/Users/avani/Downloads/print it/print it/backend/node_modules/pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres.ncasateooojzdxyxszfn:os4XLmnlViI14UBA@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true'
  });
  await client.connect();
  console.log('Connected to Supabase PostgreSQL database.');

  // 1. Ensure print_jobs.order_id supports VARCHAR order IDs (like 'Eaa0026')
  await client.query("ALTER TABLE print_jobs ALTER COLUMN order_id TYPE VARCHAR(100);");
  console.log('1. Altered print_jobs.order_id to VARCHAR(100).');

  // 2. Create the Trigger Function to automatically bridge accepted orders to print_jobs
  const triggerFunctionSql = `
    CREATE OR REPLACE FUNCTION sync_order_to_print_jobs()
    RETURNS TRIGGER AS $$
    DECLARE
      v_file JSONB;
      v_url TEXT;
      v_copies INT;
      v_checksum TEXT;
    BEGIN
      -- Trigger when order is accepted/processing or newly inserted with paid/processing status
      IF (NEW.status IN ('processing', 'accepted', 'in_progress', 'ready')) THEN
        -- Check if print_jobs already created for this order to prevent duplicates
        IF NOT EXISTS (SELECT 1 FROM print_jobs WHERE order_id = NEW.order_id::VARCHAR) THEN
          -- Check if files JSON array exists
          IF NEW.files IS NOT NULL AND jsonb_typeof(NEW.files) = 'array' THEN
            FOR v_file IN SELECT * FROM jsonb_array_elements(NEW.files) LOOP
              v_url := v_file->'file_info'->>'s3_key';
              v_copies := COALESCE((v_file->'print_options'->>'copies')::INT, 1);
              v_checksum := COALESCE(v_file->'file_info'->>'checksum', '');
              
              IF v_url IS NOT NULL AND v_url <> '' THEN
                INSERT INTO print_jobs (
                  order_id,
                  shop_id,
                  pdf_url,
                  checksum,
                  copies,
                  status,
                  is_secure,
                  created_at
                ) VALUES (
                  NEW.order_id::VARCHAR,
                  NEW.shop_id,
                  v_url,
                  v_checksum,
                  v_copies,
                  'PENDING',
                  true, -- Privacy-by-Default: active for all orders
                  NOW()
                );
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `;
  await client.query(triggerFunctionSql);
  console.log('2. Created sync_order_to_print_jobs trigger function.');

  // 3. Attach trigger to orders table
  await client.query("DROP TRIGGER IF EXISTS trg_orders_to_print_jobs ON orders;");
  await client.query(`
    CREATE TRIGGER trg_orders_to_print_jobs
    AFTER INSERT OR UPDATE OF status ON orders
    FOR EACH ROW
    EXECUTE FUNCTION sync_order_to_print_jobs();
  `);
  console.log('3. Attached trg_orders_to_print_jobs trigger to orders table.');

  // 4. Also insert the currently pending/processing order 'Eaa0026' into print_jobs right now
  const orderRes = await client.query("SELECT * FROM orders WHERE order_id = 'Eaa0026' LIMIT 1");
  if (orderRes.rows.length > 0) {
    const o = orderRes.rows[0];
    const file = o.files && o.files[0];
    const url = file?.file_info?.s3_key;
    const copies = file?.print_options?.copies || 1;
    if (url) {
      await client.query(
        "INSERT INTO print_jobs (order_id, shop_id, pdf_url, checksum, copies, status, is_secure) VALUES ($1, $2, $3, $4, $5, 'PENDING', $6) ON CONFLICT DO NOTHING",
        [o.order_id, o.shop_id, url, '', copies, (o.print_mode === 'secure')]
      );
      console.log(`4. Inserted existing order ${o.order_id} into print_jobs for Shop ${o.shop_id}.`);
    }
  }

  await client.end();
}

main().catch(console.error);
