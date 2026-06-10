CREATE TABLE public.payment_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  source text NOT NULL CHECK (source IN ('poll', 'webhook', 'manual')),
  "timestamp" timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.payment_status_history TO authenticated;
GRANT ALL ON public.payment_status_history TO service_role;

ALTER TABLE public.payment_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view payment status history for their payments"
ON public.payment_status_history
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.id = payment_status_history.payment_id
      AND p.user_id = auth.uid()
  )
);

CREATE INDEX payment_status_history_payment_id_idx
ON public.payment_status_history (payment_id, "timestamp" DESC);

CREATE INDEX payment_status_history_source_idx
ON public.payment_status_history (source, "timestamp" DESC);