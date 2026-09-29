const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { getDbClient } = require('./db.js');

async function runMigration() {
  console.log('Connecting to Supabase PostgreSQL database...');
  const client = getDbClient();
  await client.connect();
  try {
    console.log('Connected.');

    // 1. Ensure agent_devices columns exist
    await client.query(`
      ALTER TABLE agent_devices ADD COLUMN IF NOT EXISTS selected_printer_bw VARCHAR(255);
      ALTER TABLE agent_devices ADD COLUMN IF NOT EXISTS selected_printer_color VARCHAR(255);
      ALTER TABLE agent_devices ADD COLUMN IF NOT EXISTS available_printers JSONB DEFAULT '[]'::jsonb;
    `);
    console.log('1. Ensured selected_printer_bw, selected_printer_color, and available_printers on agent_devices.');

    // 2. Ensure agent_print_jobs table and storage_paths exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_print_jobs (
        id           SERIAL PRIMARY KEY,
        shop_id      TEXT NOT NULL,
        order_id     TEXT NOT NULL,
        file_index   INT NOT NULL DEFAULT 0,
        storage_path TEXT,
        storage_paths JSONB,
        print_options JSONB,
        status       TEXT NOT NULL DEFAULT 'pending',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        acked_at     TIMESTAMPTZ
      );
      ALTER TABLE agent_print_jobs ADD COLUMN IF NOT EXISTS storage_paths JSONB;
    `);
    console.log('2. Ensured agent_print_jobs and storage_paths.');

    // 3. Ensure print_options on print_jobs
    await client.query(`
      ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS print_options JSONB DEFAULT '{}'::jsonb;
    `);
    console.log('3. Ensured print_options on print_jobs.');

    // 4. Update sync_order_to_print_jobs() trigger to handle multi_file_grid
    const triggerSql = `
      CREATE OR REPLACE FUNCTION sync_order_to_print_jobs()
      RETURNS TRIGGER AS $$
      DECLARE
        v_file JSONB;
        v_url TEXT;
        v_copies INT;
        v_checksum TEXT;
        v_print_opts JSONB;
        v_all_urls JSONB;
        v_first_url TEXT;
        v_first_checksum TEXT;
      BEGIN
        IF (NEW.status::TEXT IN ('processing', 'accepted', 'in_progress', 'ready')) THEN
          IF NOT EXISTS (SELECT 1 FROM print_jobs WHERE order_id = NEW.order_id::VARCHAR) THEN
            IF NEW.files IS NOT NULL AND jsonb_typeof(NEW.files) = 'array' THEN
              
              -- Check if multi_file_grid is active
              IF (NEW.print_options->>'multi_file_grid' = 'true') THEN
                SELECT jsonb_agg(COALESCE(
                  f->'file_info'->>'s3_key',
                  f->>'s3_key',
                  f->>'url',
                  f->>'file_url',
                  f->'file_info'->>'url'
                ))
                INTO v_all_urls
                FROM jsonb_array_elements(NEW.files) f;

                v_first_url := v_all_urls->>0;
                v_first_checksum := COALESCE(
                  NEW.files->0->'file_info'->>'checksum',
                  NEW.files->0->>'checksum',
                  ''
                );

                IF v_first_url IS NOT NULL AND v_first_url <> '' THEN
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
                    v_first_url,
                    v_first_checksum,
                    COALESCE((NEW.print_options->>'copies')::INT, 1),
                    jsonb_build_object('multi_file_grid', true, 'file_urls', v_all_urls) || COALESCE(NEW.print_options, '{}'::jsonb),
                    'PENDING',
                    true,
                    NOW()
                  );
                END IF;

              ELSE
                -- Default: Insert separate row per file
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
                    (NEW.print_options->>'copies')::INT,
                    1
                  );
                  v_checksum := COALESCE(
                    v_file->'file_info'->>'checksum',
                    v_file->>'checksum',
                    ''
                  );
                  v_print_opts := COALESCE(
                    v_file->'print_options',
                    NEW.print_options,
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
                      true,
                      NOW()
                    );
                  END IF;
                END LOOP;
              END IF;

            END IF;
          END IF;
        END IF;
        RETURN NEW;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'sync_order_to_print_jobs non-blocking warning: %', SQLERRM;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `;
    await client.query(triggerSql);
    console.log('4. Updated sync_order_to_print_jobs() trigger function with multi_file_grid support.');

    console.log('Database migration successfully applied!');
  } finally {
    await client.end();
  }
}

runMigration().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
