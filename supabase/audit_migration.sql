-- ============================================================
-- QuackDASH Audit & Soft Delete Migration
-- Run this in Supabase → SQL Editor
-- ============================================================

-- Audit log table
CREATE TABLE IF NOT EXISTS audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name   TEXT NOT NULL,
  record_id    TEXT,
  action       TEXT NOT NULL,  -- 'create' | 'update' | 'delete' | 'restore'
  performed_by TEXT NOT NULL,  -- user email
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  summary      TEXT,           -- human-readable description
  old_data     JSONB,
  new_data     JSONB
);

-- Index for fast lookups by table and time
CREATE INDEX IF NOT EXISTS audit_logs_table_name_idx ON audit_logs (table_name, performed_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_performed_by_idx ON audit_logs (performed_by, performed_at DESC);

-- Soft delete on locations
ALTER TABLE locations ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS deleted_by  TEXT;

-- Soft delete on items
ALTER TABLE items ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ;
ALTER TABLE items ADD COLUMN IF NOT EXISTS deleted_by  TEXT;

-- Soft delete on qm_production_items
ALTER TABLE qm_production_items ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ;
ALTER TABLE qm_production_items ADD COLUMN IF NOT EXISTS deleted_by  TEXT;

-- Soft delete on suppliers
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS deleted_by  TEXT;

-- RLS: allow authenticated users to insert audit logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can insert audit logs"
  ON audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read audit logs"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (true);
