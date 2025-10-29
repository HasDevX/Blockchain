BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chain_endpoints'
      AND column_name = 'label'
  ) THEN
    EXECUTE 'ALTER TABLE public.chain_endpoints RENAME TO chain_endpoints_legacy_20251029';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.chain_endpoints (
  id BIGSERIAL PRIMARY KEY,
  chain_id INT NOT NULL REFERENCES public.chain_configs (chain_id),
  url TEXT NOT NULL,
  label TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  qps INT NOT NULL DEFAULT 1,
  min_span INT NOT NULL DEFAULT 8,
  max_span INT NOT NULL DEFAULT 1000,
  weight INT NOT NULL DEFAULT 1,
  order_index INT NOT NULL DEFAULT 0,
  last_health TEXT,
  last_checked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'chain_endpoints_legacy_20251029'
  ) THEN
    EXECUTE $$
      INSERT INTO public.chain_endpoints (
        chain_id,
        url,
        label,
        is_primary,
        enabled,
        qps,
        min_span,
        max_span,
        weight,
        order_index,
        last_health,
        last_checked_at,
        updated_at
      )
      SELECT
        chain_id,
        url,
        NULL,
        FALSE,
        enabled,
        qps,
        8,
        1000,
        weight,
        0,
        NULL,
        NULL,
        COALESCE(updated_at, NOW())
      FROM public.chain_endpoints_legacy_20251029
    $$;
  END IF;
END $$;

DROP TABLE IF EXISTS public.chain_endpoints_legacy_20251029;

CREATE INDEX IF NOT EXISTS chain_endpoints_chain_enabled_idx
  ON public.chain_endpoints (chain_id, enabled);

CREATE INDEX IF NOT EXISTS chain_endpoints_primary_order_idx
  ON public.chain_endpoints (chain_id, is_primary DESC, order_index ASC);

COMMIT;
