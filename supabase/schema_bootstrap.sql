-- QuackDASH — Core schema bootstrap
-- Safe to run multiple times. Creates tables only if they don't exist.
-- Run this FIRST, then run audit_migration.sql + quackmaster_migration.sql.

-- ============================================================
-- LOOKUP TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS categories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS units (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  abbreviation TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- LOCATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS locations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('central_kitchen', 'outlet')),
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- ITEMS
-- ============================================================

CREATE TABLE IF NOT EXISTS items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  sku            TEXT UNIQUE,
  category_id    UUID REFERENCES categories(id) ON DELETE SET NULL,
  unit_id        UUID REFERENCES units(id) ON DELETE SET NULL,
  reorder_level  NUMERIC DEFAULT 0,
  is_active      BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- INVENTORY
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory_levels (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id  UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  item_id      UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity     NUMERIC DEFAULT 0,
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (location_id, item_id)
);

-- ============================================================
-- RLS — permit all authenticated users (enforce per-role later)
-- ============================================================

ALTER TABLE categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE units             ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_levels  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories', 'units', 'locations', 'items', 'inventory_levels']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "auth read %s" ON %I',  t, t);
    EXECUTE format('DROP POLICY IF EXISTS "auth write %s" ON %I', t, t);
    EXECUTE format('CREATE POLICY "auth read %s"  ON %I FOR SELECT TO authenticated USING (true)',        t, t);
    EXECUTE format('CREATE POLICY "auth write %s" ON %I FOR ALL    TO authenticated USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;

-- ============================================================
-- SEED COMMON UNITS + CATEGORIES (only if empty)
-- ============================================================

INSERT INTO units (name, abbreviation)
SELECT * FROM (VALUES
  ('Kilogram',   'kg'),
  ('Gram',       'g'),
  ('Litre',      'L'),
  ('Millilitre', 'ml'),
  ('Piece',      'pc'),
  ('Packet',     'pkt'),
  ('Bottle',     'btl'),
  ('Box',        'box')
) AS v(name, abbreviation)
WHERE NOT EXISTS (SELECT 1 FROM units);

INSERT INTO categories (name)
SELECT * FROM (VALUES
  ('Noodles'),
  ('Proteins'),
  ('Sauces'),
  ('Vegetables'),
  ('Garnishes'),
  ('Beverages'),
  ('Packaging'),
  ('Cleaning')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM categories);
