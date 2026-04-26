-- ============================================================
-- GROWTH PACK MIGRATION
-- ============================================================

-- 1. Extend profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS google_review_url text,
  ADD COLUMN IF NOT EXISTS city text;

-- 2. Extend subscriptions (credit balance for referral rewards)
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS credit_months_balance integer NOT NULL DEFAULT 0;

-- ============================================================
-- 3. ANALYTICS EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text NOT NULL,
  user_id uuid,
  session_id text,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  url text,
  referrer text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_name_created
  ON public.analytics_events (event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user
  ON public.analytics_events (user_id, created_at DESC);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert analytics events"
  ON public.analytics_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    length(event_name) BETWEEN 1 AND 80
  );

CREATE POLICY "Admins can view analytics events"
  ON public.analytics_events
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'eigenaar'::public.app_role));

-- ============================================================
-- 4. REVIEW PROMPTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.review_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  shown_at timestamptz,
  dismissed_at timestamptz,
  responded_at timestamptz,
  rating integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.review_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own review prompt"
  ON public.review_prompts
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_review_prompts_updated_at
  BEFORE UPDATE ON public.review_prompts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 5. TESTIMONIALS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.testimonials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  salon_name text NOT NULL,
  city text,
  quote text NOT NULL,
  rating integer NOT NULL DEFAULT 5,
  status text NOT NULL DEFAULT 'pending',
  featured boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT testimonials_rating_chk CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT testimonials_status_chk CHECK (status IN ('pending','approved','rejected')),
  CONSTRAINT testimonials_quote_len CHECK (length(quote) BETWEEN 5 AND 500),
  CONSTRAINT testimonials_salon_len CHECK (length(salon_name) BETWEEN 1 AND 120)
);

CREATE INDEX IF NOT EXISTS idx_testimonials_status_featured
  ON public.testimonials (status, featured, created_at DESC);

ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view approved testimonials"
  ON public.testimonials
  FOR SELECT
  TO anon, authenticated
  USING (status = 'approved');

CREATE POLICY "Users insert own testimonial"
  ON public.testimonials
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users view own testimonial"
  ON public.testimonials
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins manage testimonials"
  ON public.testimonials
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'eigenaar'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'eigenaar'::public.app_role));

CREATE TRIGGER trg_testimonials_updated_at
  BEFORE UPDATE ON public.testimonials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 6. REFERRAL CODES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.referral_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  code text NOT NULL UNIQUE,
  total_referred integer NOT NULL DEFAULT 0,
  total_converted integer NOT NULL DEFAULT 0,
  total_credit_months integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON public.referral_codes (code);

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own referral code"
  ON public.referral_codes
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Anyone can lookup code on signup"
  ON public.referral_codes
  FOR SELECT
  TO anon
  USING (true);

CREATE TRIGGER trg_referral_codes_updated_at
  BEFORE UPDATE ON public.referral_codes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 7. REFERRALS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id uuid NOT NULL,
  referred_user_id uuid NOT NULL UNIQUE,
  code text NOT NULL,
  status text NOT NULL DEFAULT 'signed_up',
  credit_months integer NOT NULL DEFAULT 1,
  signed_up_at timestamptz NOT NULL DEFAULT now(),
  converted_at timestamptz,
  credited_at timestamptz,
  CONSTRAINT referrals_status_chk CHECK (status IN ('signed_up','converted','credited'))
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals (referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON public.referrals (referred_user_id);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view referrals as referrer"
  ON public.referrals
  FOR SELECT
  TO authenticated
  USING (auth.uid() = referrer_user_id OR auth.uid() = referred_user_id);

-- (Inserts happen via edge function with service role; no client INSERT policy.)

-- ============================================================
-- 8. HELPER: generate referral code
-- ============================================================
CREATE OR REPLACE FUNCTION public.ensure_referral_code(_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _code text;
  _existing text;
BEGIN
  SELECT code INTO _existing FROM public.referral_codes WHERE user_id = _user_id;
  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;

  LOOP
    _code := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.referral_codes WHERE code = _code);
  END LOOP;

  INSERT INTO public.referral_codes (user_id, code) VALUES (_user_id, _code);
  RETURN _code;
END;
$$;