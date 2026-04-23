ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS online_visible boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS image_url text DEFAULT '';

ALTER TABLE public.settings
ADD COLUMN IF NOT EXISTS webshop_enabled boolean DEFAULT false;

CREATE TABLE IF NOT EXISTS public.webshop_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  customer_id uuid NULL,
  order_number text NOT NULL UNIQUE,
  customer_name text DEFAULT '',
  customer_email text DEFAULT '',
  customer_phone text DEFAULT '',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  payment_status text NOT NULL DEFAULT 'open',
  status text NOT NULL DEFAULT 'open',
  mollie_payment_id text NULL,
  payment_id uuid NULL,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.webshop_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view webshop orders in active mode"
ON public.webshop_orders
FOR SELECT
USING (public.user_row_matches_active_mode(user_id, is_demo));

CREATE POLICY "Finance roles can update webshop orders in active mode"
ON public.webshop_orders
FOR UPDATE
USING (public.user_row_matches_active_mode(user_id, is_demo) AND public.can_view_finance(auth.uid()))
WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo() AND public.can_view_finance(auth.uid()));

CREATE POLICY "Owners can delete webshop orders in active mode"
ON public.webshop_orders
FOR DELETE
USING (public.user_row_matches_active_mode(user_id, is_demo) AND public.has_role(auth.uid(), 'eigenaar'::public.app_role));

CREATE INDEX IF NOT EXISTS idx_products_online_visible ON public.products(user_id, is_demo, online_visible, is_active);
CREATE INDEX IF NOT EXISTS idx_webshop_orders_user_created ON public.webshop_orders(user_id, is_demo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webshop_orders_mollie_payment ON public.webshop_orders(mollie_payment_id);

CREATE OR REPLACE FUNCTION public.set_webshop_order_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
    NEW.order_number := 'WS-' || upper(left(replace(NEW.id::text, '-', ''), 8));
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_webshop_order_number_trigger ON public.webshop_orders;
CREATE TRIGGER set_webshop_order_number_trigger
BEFORE INSERT OR UPDATE ON public.webshop_orders
FOR EACH ROW
EXECUTE FUNCTION public.set_webshop_order_number();