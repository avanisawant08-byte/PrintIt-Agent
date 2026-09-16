const { Client } = require('c:/Users/avani/Downloads/print it/print it/backend/node_modules/pg');

async function fixTriggerAndEnum() {
  const client = new Client({
    connectionString: 'postgresql://postgres.ncasateooojzdxyxszfn:os4XLmnlViI14UBA@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true'
  });
  await client.connect();
  console.log('Connected to Supabase PostgreSQL.');

  // 1. Add in_progress to order_status enum if not present
  try {
    await client.query("ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'in_progress';");
    console.log('Added in_progress to order_status enum.');
  } catch (err) {
    console.warn('Enum in_progress note:', err.message);
  }

  // 2. Replace sync_order_to_print_jobs with resilient version
  const safeTriggerSql = `
    CREATE OR REPLACE FUNCTION sync_order_to_print_jobs()
    RETURNS TRIGGER AS $$
    DECLARE
      v_file JSONB;
      v_url TEXT;
      v_copies INT;
      v_checksum TEXT;
    BEGIN
      -- Safely compare status as TEXT
      IF (NEW.status::TEXT IN ('processing', 'accepted', 'in_progress', 'ready')) THEN
        -- Check if print_jobs already created for this order to prevent duplicates
        IF NOT EXISTS (SELECT 1 FROM print_jobs WHERE order_id = NEW.order_id::VARCHAR) THEN
          IF NEW.files IS NOT NULL AND jsonb_typeof(NEW.files) = 'array' THEN
            FOR v_file IN SELECT * FROM jsonb_array_elements(NEW.files) LOOP
              v_url := COALESCE(
                v_file->'file_info'->>'s3_key',
                v_file->>'s3_key',
                v_file->>'url',
                v_file->>'file_url',
                v_file->'file_info'->>'url'
              );
              v_copies := COALESCE(
                (v_file->'print_options'->>'copies')::INT,
                (v_file->>'copies')::INT,
                1
              );
              v_checksum := COALESCE(
                v_file->'file_info'->>'checksum',
                v_file->>'checksum',
                ''
              );
              
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
                  true, -- Privacy-by-Default
                  NOW()
                );
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
      RETURN NEW;
    EXCEPTION WHEN OTHERS THEN
      -- Guarantee that an error in the trigger NEVER blocks the order update transaction
      RAISE WARNING 'sync_order_to_print_jobs non-blocking warning: %', SQLERRM;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `;

  await client.query(safeTriggerSql);
  console.log('2. Replaced sync_order_to_print_jobs with bulletproof non-blocking function.');

  await client.end();
}

fixTriggerAndEnum().catch(console.error);
