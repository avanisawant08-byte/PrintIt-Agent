-- ============================================================================
-- PrintIt Remote Print Agent — Supabase PostgreSQL Schema
-- ============================================================================

-- 1. Create Enums
DO $$ BEGIN
    CREATE TYPE print_job_status AS ENUM ('PENDING', 'PRINTING', 'COMPLETED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE agent_device_status AS ENUM ('ONLINE', 'OFFLINE', 'PRINTING');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Create agent_devices Table
CREATE TABLE IF NOT EXISTS agent_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL,
    device_name VARCHAR(100) NOT NULL,
    pairing_code VARCHAR(6),
    pairing_code_expires_at TIMESTAMPTZ,
    auth_token TEXT,
    selected_printer VARCHAR(255),
    available_printers JSONB DEFAULT '[]'::jsonb,
    agent_version VARCHAR(20) DEFAULT '1.0.0',
    status agent_device_status DEFAULT 'OFFLINE',
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure columns exist if table was already created
ALTER TABLE agent_devices ADD COLUMN IF NOT EXISTS available_printers JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_agent_devices_pairing ON agent_devices (pairing_code);
CREATE INDEX IF NOT EXISTS idx_agent_devices_shop ON agent_devices (shop_id);

-- 3. Create print_jobs Table
CREATE TABLE IF NOT EXISTS print_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL,
    shop_id UUID NOT NULL,
    pdf_url TEXT NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    copies INT DEFAULT 1 CHECK (copies > 0),
    status print_job_status DEFAULT 'PENDING',
    error_message TEXT,
    retry_count INT DEFAULT 0,
    is_secure BOOLEAN DEFAULT false,
    file_deleted BOOLEAN DEFAULT false,
    file_deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure columns exist if table was already created
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS is_secure BOOLEAN DEFAULT false;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS file_deleted BOOLEAN DEFAULT false;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS file_deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_print_jobs_shop_status ON print_jobs (shop_id, status);
CREATE INDEX IF NOT EXISTS idx_print_jobs_created ON print_jobs (created_at);
CREATE INDEX IF NOT EXISTS idx_print_jobs_secure ON print_jobs (shop_id, is_secure);

-- 4. Enable Supabase Realtime Publication for print_jobs & agent_devices
-- This enables the desktop agent and web portal to listen to real-time events
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE print_jobs;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE agent_devices;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 5. Helper Function & Trigger for Auto-Updating updated_at
CREATE OR REPLACE FUNCTION update_timestamp_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_print_jobs_updated_at ON print_jobs;
CREATE TRIGGER trg_print_jobs_updated_at
    BEFORE UPDATE ON print_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp_column();

DROP TRIGGER IF EXISTS trg_agent_devices_updated_at ON agent_devices;
CREATE TRIGGER trg_agent_devices_updated_at
    BEFORE UPDATE ON agent_devices
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp_column();

-- ============================================================================
-- 6. Helper Function to Generate 6-Character Pairing Code for a Shop
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_pairing_code(p_shop_id UUID, p_device_name VARCHAR)
RETURNS VARCHAR(6) AS $$
DECLARE
    v_code VARCHAR(6);
BEGIN
    -- Generate random 6-character alphanumeric code (excluding ambiguous chars like 0/O, 1/I)
    v_code := upper(substring(md5(random()::text) from 1 for 6));
    
    INSERT INTO agent_devices (
        shop_id,
        device_name,
        pairing_code,
        pairing_code_expires_at,
        status
    ) VALUES (
        p_shop_id,
        p_device_name,
        v_code,
        NOW() + INTERVAL '15 minutes',
        'OFFLINE'
    );
    
    RETURN v_code;
END;
$$ LANGUAGE plpgsql;
