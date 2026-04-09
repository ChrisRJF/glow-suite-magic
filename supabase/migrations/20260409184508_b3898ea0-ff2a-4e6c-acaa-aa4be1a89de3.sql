
-- Wachtlijst
CREATE TABLE public.waitlist_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  preferred_employee text DEFAULT '',
  preferred_day text DEFAULT '',
  preferred_time text DEFAULT '',
  flexibility text DEFAULT 'flexibel',
  status text NOT NULL DEFAULT 'wachtend',
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own waitlist" ON public.waitlist_entries FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own waitlist" ON public.waitlist_entries FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own waitlist" ON public.waitlist_entries FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own waitlist" ON public.waitlist_entries FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER update_waitlist_entries_updated_at BEFORE UPDATE ON public.waitlist_entries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Cadeaubonnen
CREATE TABLE public.gift_cards (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  code text NOT NULL,
  initial_amount numeric NOT NULL DEFAULT 0,
  remaining_amount numeric NOT NULL DEFAULT 0,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text DEFAULT '',
  status text NOT NULL DEFAULT 'actief',
  expires_at timestamptz,
  sold_via text DEFAULT 'salon',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gift_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own gift_cards" ON public.gift_cards FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own gift_cards" ON public.gift_cards FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own gift_cards" ON public.gift_cards FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own gift_cards" ON public.gift_cards FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER update_gift_cards_updated_at BEFORE UPDATE ON public.gift_cards FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Betaallinks
CREATE TABLE public.payment_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  amount numeric NOT NULL DEFAULT 0,
  description text DEFAULT '',
  status text NOT NULL DEFAULT 'open',
  type text NOT NULL DEFAULT 'link',
  link_url text DEFAULT '',
  expires_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own payment_links" ON public.payment_links FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own payment_links" ON public.payment_links FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own payment_links" ON public.payment_links FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own payment_links" ON public.payment_links FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER update_payment_links_updated_at BEFORE UPDATE ON public.payment_links FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
