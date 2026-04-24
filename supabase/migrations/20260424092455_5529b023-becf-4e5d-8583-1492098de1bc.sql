CREATE TABLE IF NOT EXISTS public.refund_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  payment_id UUID NOT NULL,
  customer_id UUID NULL,
  appointment_id UUID NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  reason TEXT NOT NULL,
  custom_reason TEXT NULL,
  internal_note TEXT NULL,
  notify_customer BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'requested',
  mollie_refund_id TEXT NULL,
  failure_reason TEXT NULL,
  idempotency_key TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  requested_by UUID NULL,
  approved_by UUID NULL,
  executed_by UUID NULL,
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  approved_at TIMESTAMP WITH TIME ZONE NULL,
  executed_at TIMESTAMP WITH TIME ZONE NULL,
  processed_at TIMESTAMP WITH TIME ZONE NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT refund_requests_amount_positive CHECK (amount > 0),
  CONSTRAINT refund_requests_status_check CHECK (status IN ('requested','needs_approval','approved','queued','pending','processing','refunded','failed','cancelled','rejected'))
);

CREATE TABLE IF NOT EXISTS public.refund_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  refund_request_id UUID NULL,
  payment_id UUID NULL,
  actor_user_id UUID NULL,
  event_type TEXT NOT NULL,
  amount NUMERIC NULL,
  reason TEXT NULL,
  notes TEXT NULL,
  ip_address TEXT NULL,
  user_agent TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.refund_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  refund_request_id UUID NOT NULL,
  approver_user_id UUID NOT NULL,
  approval_level INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'approved',
  note TEXT NULL,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT refund_approvals_status_check CHECK (status IN ('approved','rejected'))
);

ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_approvals ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_refund_requests_user_status ON public.refund_requests(user_id, is_demo, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refund_requests_payment ON public.refund_requests(payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refund_requests_idempotency ON public.refund_requests(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_refund_events_request ON public.refund_events(refund_request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refund_events_user ON public.refund_events(user_id, is_demo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refund_approvals_request ON public.refund_approvals(refund_request_id, created_at DESC);

DROP POLICY IF EXISTS "Finance roles can view refund requests in active mode" ON public.refund_requests;
CREATE POLICY "Finance roles can view refund requests in active mode"
ON public.refund_requests
FOR SELECT
USING (user_row_matches_active_mode(user_id, is_demo) AND can_view_finance(auth.uid()));

DROP POLICY IF EXISTS "Managers can create refund requests in active mode" ON public.refund_requests;
CREATE POLICY "Managers can create refund requests in active mode"
ON public.refund_requests
FOR INSERT
WITH CHECK ((auth.uid() = user_id) AND (is_demo = current_account_is_demo()) AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'manager'::app_role, 'admin'::app_role]));

DROP POLICY IF EXISTS "Admins can update refund requests in active mode" ON public.refund_requests;
CREATE POLICY "Admins can update refund requests in active mode"
ON public.refund_requests
FOR UPDATE
USING (user_row_matches_active_mode(user_id, is_demo) AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'admin'::app_role]))
WITH CHECK ((auth.uid() = user_id) AND (is_demo = current_account_is_demo()) AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'admin'::app_role]));

DROP POLICY IF EXISTS "Finance roles can view refund events in active mode" ON public.refund_events;
CREATE POLICY "Finance roles can view refund events in active mode"
ON public.refund_events
FOR SELECT
USING (user_row_matches_active_mode(user_id, is_demo) AND can_view_finance(auth.uid()));

DROP POLICY IF EXISTS "Admins can create refund events in active mode" ON public.refund_events;
CREATE POLICY "Admins can create refund events in active mode"
ON public.refund_events
FOR INSERT
WITH CHECK ((auth.uid() = user_id) AND (is_demo = current_account_is_demo()) AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'manager'::app_role, 'admin'::app_role]));

DROP POLICY IF EXISTS "Finance roles can view refund approvals in active mode" ON public.refund_approvals;
CREATE POLICY "Finance roles can view refund approvals in active mode"
ON public.refund_approvals
FOR SELECT
USING (user_row_matches_active_mode(user_id, is_demo) AND can_view_finance(auth.uid()));

DROP POLICY IF EXISTS "Admins can create refund approvals in active mode" ON public.refund_approvals;
CREATE POLICY "Admins can create refund approvals in active mode"
ON public.refund_approvals
FOR INSERT
WITH CHECK ((auth.uid() = user_id) AND (is_demo = current_account_is_demo()) AND has_any_role(auth.uid(), ARRAY['eigenaar'::app_role, 'admin'::app_role]));

DROP TRIGGER IF EXISTS update_refund_requests_updated_at ON public.refund_requests;
CREATE TRIGGER update_refund_requests_updated_at
BEFORE UPDATE ON public.refund_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();