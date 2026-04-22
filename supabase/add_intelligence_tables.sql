-- =====================================================================
-- QuackDASH Intelligence Layer — Database Schema
-- Supports: Consumption forecasting, smart reordering, transfer optimization
-- Idempotent: safe to re-run
-- Run this in the Supabase SQL editor
-- =====================================================================

-- =====================================================================
-- 1. EXTEND SUPPLIERS TABLE
-- =====================================================================

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS lead_time_days INTEGER DEFAULT 7;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cost_ranking INTEGER DEFAULT 100;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS reliability_score NUMERIC DEFAULT 100;

CREATE INDEX IF NOT EXISTS idx_suppliers_cost_ranking ON suppliers(cost_ranking);

-- =====================================================================
-- 2. SUPPLY ROUTES — Link items to suppliers with pricing
-- =====================================================================

CREATE TABLE IF NOT EXISTS supply_routes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  supplier_id     UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  unit_cost       NUMERIC NOT NULL DEFAULT 0,
  min_order_qty   NUMERIC NOT NULL DEFAULT 0,
  is_preferred    BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (item_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_supply_routes_item ON supply_routes(item_id);
CREATE INDEX IF NOT EXISTS idx_supply_routes_supplier ON supply_routes(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supply_routes_preferred ON supply_routes(is_preferred);

ALTER TABLE supply_routes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "supply_routes read" ON supply_routes;
DROP POLICY IF EXISTS "supply_routes write" ON supply_routes;
CREATE POLICY "supply_routes read"  ON supply_routes FOR SELECT TO authenticated USING (true);
CREATE POLICY "supply_routes write" ON supply_routes FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =====================================================================
-- 3. RECIPE YIELDS — UoM conversion from production to outlet units
-- =====================================================================

CREATE TABLE IF NOT EXISTS recipe_yields (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  input_unit_id   UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  output_unit_id  UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  conversion_factor NUMERIC NOT NULL DEFAULT 1,
  description     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (item_id)
);

CREATE INDEX IF NOT EXISTS idx_recipe_yields_item ON recipe_yields(item_id);

ALTER TABLE recipe_yields ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recipe_yields read" ON recipe_yields;
DROP POLICY IF EXISTS "recipe_yields write" ON recipe_yields;
CREATE POLICY "recipe_yields read"  ON recipe_yields FOR SELECT TO authenticated USING (true);
CREATE POLICY "recipe_yields write" ON recipe_yields FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =====================================================================
-- 4. CONSUMPTION TRENDS — Rolling demand per location per item
-- =====================================================================

CREATE TABLE IF NOT EXISTS consumption_trends (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  location_id     UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  avg_qty_per_day NUMERIC NOT NULL DEFAULT 0,
  unit_id         UUID REFERENCES units(id) ON DELETE SET NULL,
  last_updated    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (item_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_consumption_trends_item_location ON consumption_trends(item_id, location_id);
CREATE INDEX IF NOT EXISTS idx_consumption_trends_updated ON consumption_trends(last_updated DESC);

ALTER TABLE consumption_trends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "consumption_trends read" ON consumption_trends;
DROP POLICY IF EXISTS "consumption_trends write" ON consumption_trends;
CREATE POLICY "consumption_trends read"  ON consumption_trends FOR SELECT TO authenticated USING (true);
CREATE POLICY "consumption_trends write" ON consumption_trends FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =====================================================================
-- 5. AUTO REORDER RULES — Per-item, per-location policy
-- =====================================================================

CREATE TABLE IF NOT EXISTS auto_reorder_rules (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id                 UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  location_id             UUID REFERENCES locations(id) ON DELETE CASCADE,
  min_stock_qty           NUMERIC NOT NULL DEFAULT 0,
  par_stock_qty           NUMERIC NOT NULL DEFAULT 0,
  lead_time_buffer_days   INTEGER DEFAULT 7,
  auto_order_enabled      BOOLEAN DEFAULT true,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now(),
  UNIQUE (item_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_auto_reorder_rules_item ON auto_reorder_rules(item_id);
CREATE INDEX IF NOT EXISTS idx_auto_reorder_rules_location ON auto_reorder_rules(location_id);
CREATE INDEX IF NOT EXISTS idx_auto_reorder_rules_enabled ON auto_reorder_rules(auto_order_enabled);

ALTER TABLE auto_reorder_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auto_reorder_rules read" ON auto_reorder_rules;
DROP POLICY IF EXISTS "auto_reorder_rules write" ON auto_reorder_rules;
CREATE POLICY "auto_reorder_rules read"  ON auto_reorder_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "auto_reorder_rules write" ON auto_reorder_rules FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =====================================================================
-- 6. REORDER SUGGESTIONS — Audit log of auto-generated PO suggestions
-- =====================================================================

CREATE TABLE IF NOT EXISTS reorder_suggestions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id             UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  suggested_qty       NUMERIC NOT NULL,
  suggested_supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  reason              TEXT,
  status              TEXT DEFAULT 'pending_approval', -- pending_approval | approved | ordered | cancelled
  created_by          TEXT NOT NULL DEFAULT 'system',
  created_at          TIMESTAMPTZ DEFAULT now(),
  approved_by         TEXT,
  approved_at         TIMESTAMPTZ,
  delivery_order_id   UUID REFERENCES delivery_orders(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_reorder_suggestions_item ON reorder_suggestions(item_id);
CREATE INDEX IF NOT EXISTS idx_reorder_suggestions_status ON reorder_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_reorder_suggestions_created ON reorder_suggestions(created_at DESC);

ALTER TABLE reorder_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reorder_suggestions read" ON reorder_suggestions;
DROP POLICY IF EXISTS "reorder_suggestions write" ON reorder_suggestions;
CREATE POLICY "reorder_suggestions read"  ON reorder_suggestions FOR SELECT TO authenticated USING (true);
CREATE POLICY "reorder_suggestions write" ON reorder_suggestions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =====================================================================
-- 7. TRANSFER SUGGESTIONS — Audit log of auto-generated transfer suggestions
-- =====================================================================

CREATE TABLE IF NOT EXISTS transfer_suggestions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  from_location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  to_location_id  UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  suggested_qty   NUMERIC NOT NULL,
  reason          TEXT,
  status          TEXT DEFAULT 'pending', -- pending | routed | cancelled
  created_by      TEXT NOT NULL DEFAULT 'system',
  created_at      TIMESTAMPTZ DEFAULT now(),
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  stock_transfer_id UUID REFERENCES stock_transfers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_transfer_suggestions_item ON transfer_suggestions(item_id);
CREATE INDEX IF NOT EXISTS idx_transfer_suggestions_status ON transfer_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_transfer_suggestions_created ON transfer_suggestions(created_at DESC);

ALTER TABLE transfer_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "transfer_suggestions read" ON transfer_suggestions;
DROP POLICY IF EXISTS "transfer_suggestions write" ON transfer_suggestions;
CREATE POLICY "transfer_suggestions read"  ON transfer_suggestions FOR SELECT TO authenticated USING (true);
CREATE POLICY "transfer_suggestions write" ON transfer_suggestions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =====================================================================
-- 8. INVENTORY FORECASTS — 14-day predictive stock levels
-- =====================================================================

CREATE TABLE IF NOT EXISTS inventory_forecasts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  location_id     UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  forecast_date   DATE NOT NULL,
  forecast_qty    NUMERIC NOT NULL DEFAULT 0,
  confidence_level NUMERIC DEFAULT 100, -- 0-100%
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (item_id, location_id, forecast_date)
);

CREATE INDEX IF NOT EXISTS idx_inventory_forecasts_item_location ON inventory_forecasts(item_id, location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_forecasts_date ON inventory_forecasts(forecast_date);

ALTER TABLE inventory_forecasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inventory_forecasts read" ON inventory_forecasts;
DROP POLICY IF EXISTS "inventory_forecasts write" ON inventory_forecasts;
CREATE POLICY "inventory_forecasts read"  ON inventory_forecasts FOR SELECT TO authenticated USING (true);
CREATE POLICY "inventory_forecasts write" ON inventory_forecasts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =====================================================================
-- 9. NOTIFY PostgREST to reload schema
-- =====================================================================

NOTIFY pgrst 'reload schema';
