ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.sub_appointments ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.payment_links ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.discounts ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.automation_rules ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.feedback_entries ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.rebook_actions ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.gift_cards ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.waitlist_entries ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.checkout_items ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

UPDATE public.settings SET is_demo = COALESCE(demo_mode, false) WHERE is_demo IS DISTINCT FROM COALESCE(demo_mode, false);
UPDATE public.payments SET is_demo = true WHERE mollie_payment_id LIKE 'demo_%' OR provider = 'glowpay';

CREATE OR REPLACE FUNCTION public.current_account_is_demo()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((
    SELECT s.is_demo OR COALESCE(s.demo_mode, false)
    FROM public.settings s
    WHERE s.user_id = auth.uid()
    ORDER BY s.created_at DESC
    LIMIT 1
  ), false)
$$;

CREATE OR REPLACE FUNCTION public.user_row_matches_active_mode(_row_user_id uuid, _row_is_demo boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() = _row_user_id AND COALESCE(_row_is_demo, false) = public.current_account_is_demo()
$$;

CREATE OR REPLACE FUNCTION public.prevent_live_demo_reset(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((
    SELECT s.is_demo OR COALESCE(s.demo_mode, false)
    FROM public.settings s
    WHERE s.user_id = _user_id
    ORDER BY s.created_at DESC
    LIMIT 1
  ), false)
$$;

DROP POLICY IF EXISTS "Users can view own customers" ON public.customers;
DROP POLICY IF EXISTS "Users can insert own customers" ON public.customers;
DROP POLICY IF EXISTS "Users can update own customers" ON public.customers;
DROP POLICY IF EXISTS "Users can delete own customers" ON public.customers;
CREATE POLICY "Users can view customers in active mode" ON public.customers FOR SELECT USING (public.user_row_matches_active_mode(user_id, is_demo));
CREATE POLICY "Users can insert customers in active mode" ON public.customers FOR INSERT WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo());
CREATE POLICY "Users can update customers in active mode" ON public.customers FOR UPDATE USING (public.user_row_matches_active_mode(user_id, is_demo)) WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo());
CREATE POLICY "Users can delete customers in active mode" ON public.customers FOR DELETE USING (public.user_row_matches_active_mode(user_id, is_demo));

DROP POLICY IF EXISTS "Users can view own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Users can insert own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Users can update own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Users can delete own appointments" ON public.appointments;
CREATE POLICY "Users can view appointments in active mode" ON public.appointments FOR SELECT USING (public.user_row_matches_active_mode(user_id, is_demo));
CREATE POLICY "Users can insert appointments in active mode" ON public.appointments FOR INSERT WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo());
CREATE POLICY "Users can update appointments in active mode" ON public.appointments FOR UPDATE USING (public.user_row_matches_active_mode(user_id, is_demo)) WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo());
CREATE POLICY "Users can delete appointments in active mode" ON public.appointments FOR DELETE USING (public.user_row_matches_active_mode(user_id, is_demo));

DROP POLICY IF EXISTS "Users can view own payments" ON public.payments;
DROP POLICY IF EXISTS "Users can insert own payments" ON public.payments;
DROP POLICY IF EXISTS "Users can update own payments" ON public.payments;
DROP POLICY IF EXISTS "Users can delete own payments" ON public.payments;
CREATE POLICY "Users can view payments in active mode" ON public.payments FOR SELECT USING (public.user_row_matches_active_mode(user_id, is_demo));
CREATE POLICY "Users can insert payments in active mode" ON public.payments FOR INSERT WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo());
CREATE POLICY "Users can update payments in active mode" ON public.payments FOR UPDATE USING (public.user_row_matches_active_mode(user_id, is_demo)) WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo());
CREATE POLICY "Users can delete payments in active mode" ON public.payments FOR DELETE USING (public.user_row_matches_active_mode(user_id, is_demo));

CREATE INDEX IF NOT EXISTS idx_settings_user_mode ON public.settings(user_id, is_demo);
CREATE INDEX IF NOT EXISTS idx_customers_user_mode ON public.customers(user_id, is_demo);
CREATE INDEX IF NOT EXISTS idx_appointments_user_mode ON public.appointments(user_id, is_demo, appointment_date);
CREATE INDEX IF NOT EXISTS idx_payments_user_mode ON public.payments(user_id, is_demo, created_at);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, email, salon_name)
  VALUES (NEW.id, COALESCE(NEW.email, ''), 'Mijn Salon')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;