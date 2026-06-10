
ALTER TABLE public.viva_terminals
  ADD COLUMN IF NOT EXISTS source_terminal_id text,
  ADD COLUMN IF NOT EXISTS virtual_id text,
  ADD COLUMN IF NOT EXISTS serial_number text,
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

-- Only one default per (user_id, is_demo)
CREATE UNIQUE INDEX IF NOT EXISTS uq_viva_terminals_default_per_mode
  ON public.viva_terminals (user_id, is_demo)
  WHERE is_default = true;

-- Idempotency for terminal payments via metadata->>'idempotency_key'
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_terminal_idempotency
  ON public.payments (user_id, ((metadata->>'idempotency_key')))
  WHERE method = 'terminal' AND metadata ? 'idempotency_key';
