const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { getDbClient } = require('./db.js');

async function migrate() {
  const client = getDbClient();
  await client.connect();
  console.log('Connected to Supabase PostgreSQL.');

  // 1. Add print_options JSONB column to print_jobs if it doesn't exist
  await client.query(`
    ALTER TABLE print_jobs 
    ADD COLUMN IF NOT EXISTS print_options JSONB DEFAULT '{}'::jsonb;
  `);
  console.log('1. Ensured print_options column in print_jobs table.');

  // 2. Update trigger function to extract print_options directly from v_file
  const updatedTriggerSql = `
    CREATE OR REPLACE FUNCTION sync_order_to_print_jobs()
    RETURNS TRIGGER AS $$
    DECLARE
      v_file JSONB;
      v_url TEXT;
      v_copies INT;
      v_checksum TEXT;
      v_print_opts JSONB;
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
              v_print_opts := COALESCE(
                v_file->'print_options',
                '{}'::jsonb
              );
              
              IF v_url IS NOT NULL AND v_url <> '' THEN
                INSERT INTO print_jobs (
                  order_id,
                  shop_id,
                  pdf_url,
                  checksum,
                  copies,
                  print_options,
                  status,
                  is_secure,
                  created_at
                ) VALUES (
                  NEW.order_id::VARCHAR,
                  NEW.shop_id,
                  v_url,
                  v_checksum,
                  v_copies,
                  v_print_opts,
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

  await client.query(updatedTriggerSql);
  console.log('2. Updated sync_order_to_print_jobs function with print_options support.');

  // 3. Accurately backfill print_options for all existing print_jobs matching file URLs
  const backfillRes = await client.query(`
    UPDATE print_jobs pj
    SET print_options = matched.file_opts
    FROM (
      SELECT 
        pj_inner.id as job_id,
        v_file->'print_options' as file_opts
      FROM print_jobs pj_inner
      JOIN orders o ON o.order_id::varchar = pj_inner.order_id
      CROSS JOIN jsonb_array_elements(o.files) v_file
      WHERE split_part(pj_inner.pdf_url, '?', 1) = split_part(COALESCE(v_file->'file_info'->>'s3_key', v_file->>'s3_key', v_file->>'url'), '?', 1)
         OR (jsonb_array_length(o.files) = 1)
    ) matched
    WHERE pj.id = matched.job_id
      AND matched.file_opts IS NOT NULL;
  `);
  console.log('3. Backfilled true file_print_options for ' + backfillRes.rowCount + ' print_jobs.');

  await client.end();
  console.log('Migration completed successfully.');
}

migrate().catch(console.error);
