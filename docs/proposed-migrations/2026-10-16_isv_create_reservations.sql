-- PROPOSED, NOT APPLIED. Requires separate explicit GO.
-- Durable per-(user_id, is_demo) reservation BEFORE any external Viva POST /isv/v1/accounts.
-- Does not touch public.glowpay_connected_merchants or uniq_glowpay_cm_user_demo.
-- States: reserved -> dispatching -> completed | reconciliation_required.
-- A dispatching/reconciliation_required row is NEVER auto-expired or retried (no second external account).
-- Only 'reserved' (never dispatched) rows may be taken over after expiry.

CREATE TABLE public.isv_create_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_demo boolean NOT NULL,
  attempt_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('reserved','dispatching','completed','reconciliation_required')),
  provider_account_id text,
  invitation_url text,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_isv_create_res_user_env UNIQUE (user_id, is_demo)
);
GRANT ALL ON public.isv_create_reservations TO service_role;
REVOKE ALL ON public.isv_create_reservations FROM anon, authenticated;
ALTER TABLE public.isv_create_reservations ENABLE ROW LEVEL SECURITY;
-- No policies: no client access.

-- Claim: one winner. Returns state + attempt_id; caller dispatches only if attempt_id equals its own and state='reserved'.
CREATE OR REPLACE FUNCTION public.isv_create_claim(_user uuid, _is_demo boolean, _attempt uuid, _expiry interval DEFAULT interval '2 minutes')
RETURNS TABLE(state text, attempt_id uuid, provider_account_id text, invitation_url text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO isv_create_reservations(user_id, is_demo, attempt_id, state)
  VALUES (_user, _is_demo, _attempt, 'reserved')
  ON CONFLICT (user_id, is_demo) DO UPDATE
    SET attempt_id = EXCLUDED.attempt_id, reserved_at = now(), updated_at = now()
    WHERE isv_create_reservations.state = 'reserved'
      AND isv_create_reservations.reserved_at < now() - _expiry;
  RETURN QUERY SELECT r.state, r.attempt_id, r.provider_account_id, r.invitation_url
    FROM isv_create_reservations r WHERE r.user_id = _user AND r.is_demo = _is_demo;
END $$;

-- Fence: persist 'dispatching' before POST. False = lost fence, do not POST.
CREATE OR REPLACE FUNCTION public.isv_create_mark_dispatching(_user uuid, _is_demo boolean, _attempt uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH u AS (UPDATE isv_create_reservations SET state='dispatching', dispatched_at=now(), updated_at=now()
    WHERE user_id=_user AND is_demo=_is_demo AND attempt_id=_attempt AND state='reserved' RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u);
$$;

-- Journal provider result (before merchant row persistence).
CREATE OR REPLACE FUNCTION public.isv_create_complete(_user uuid, _is_demo boolean, _attempt uuid, _account text, _invite text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH u AS (UPDATE isv_create_reservations SET state='completed', provider_account_id=_account,
      invitation_url=_invite, completed_at=now(), updated_at=now()
    WHERE user_id=_user AND is_demo=_is_demo AND attempt_id=_attempt AND state='dispatching' RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u);
$$;

-- Ambiguous outcome (timeout, unparseable, crash detected): hold for operator reconciliation.
CREATE OR REPLACE FUNCTION public.isv_create_hold(_user uuid, _is_demo boolean, _attempt uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH u AS (UPDATE isv_create_reservations SET state='reconciliation_required', updated_at=now()
    WHERE user_id=_user AND is_demo=_is_demo AND attempt_id=_attempt AND state='dispatching' RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u);
$$;

-- Definite provider rejection (4xx before account creation): release 'dispatching' back so a later claim may retry.
CREATE OR REPLACE FUNCTION public.isv_create_release(_user uuid, _is_demo boolean, _attempt uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (DELETE FROM isv_create_reservations
    WHERE user_id=_user AND is_demo=_is_demo AND attempt_id=_attempt AND state IN ('reserved','dispatching') RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM d);
$$;

REVOKE ALL ON FUNCTION public.isv_create_claim(uuid,boolean,uuid,interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.isv_create_mark_dispatching(uuid,boolean,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.isv_create_complete(uuid,boolean,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.isv_create_hold(uuid,boolean,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.isv_create_release(uuid,boolean,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.isv_create_claim(uuid,boolean,uuid,interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.isv_create_mark_dispatching(uuid,boolean,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.isv_create_complete(uuid,boolean,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.isv_create_hold(uuid,boolean,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.isv_create_release(uuid,boolean,uuid) TO service_role;

-- ROLLBACK (only if table unused):
-- DROP FUNCTION public.isv_create_release(uuid,boolean,uuid); DROP FUNCTION public.isv_create_hold(uuid,boolean,uuid);
-- DROP FUNCTION public.isv_create_complete(uuid,boolean,uuid,text,text); DROP FUNCTION public.isv_create_mark_dispatching(uuid,boolean,uuid);
-- DROP FUNCTION public.isv_create_claim(uuid,boolean,uuid,interval); DROP TABLE public.isv_create_reservations;
