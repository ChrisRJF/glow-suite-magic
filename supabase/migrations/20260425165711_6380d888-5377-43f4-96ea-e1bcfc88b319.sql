-- Subscription plans (publicly readable)
CREATE TABLE public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  price_eur numeric(10,2) NOT NULL,
  price_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  interval text NOT NULL DEFAULT '1 month',
  description text,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_highlighted boolean NOT NULL DEFAULT false,
  requires_demo boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Plans are publicly readable"
  ON public.subscription_plans FOR SELECT
  USING (is_active = true);

CREATE TRIGGER update_subscription_plans_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- User subscriptions
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  plan_slug text NOT NULL,
  status text NOT NULL DEFAULT 'trialing',
  trial_started_at timestamptz NOT NULL DEFAULT now(),
  trial_ends_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  current_period_start timestamptz,
  current_period_end timestamptz,
  mollie_customer_id text,
  mollie_mandate_id text,
  mollie_subscription_id text,
  last_payment_id text,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX idx_subscriptions_mollie_customer ON public.subscriptions(mollie_customer_id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own subscription"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own subscription"
  ON public.subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own subscription"
  ON public.subscriptions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed the three plans
INSERT INTO public.subscription_plans (slug, name, price_eur, price_cents, description, features, is_highlighted, requires_demo, sort_order) VALUES
('starter', 'Starter', 39.00, 3900,
  'Voor solo professionals die net beginnen.',
  '["Online agenda & boekingen","Klantendatabase","WhatsApp herinneringen","E-mail bevestigingen","1 medewerker","Basis rapportages","E-mail support"]'::jsonb,
  false, false, 1),
('growth', 'Growth', 79.00, 7900,
  'Voor groeiende salons die meer omzet willen halen.',
  '["Alles uit Starter","Tot 5 medewerkers","GlowPay online betalingen","Cadeaubonnen & memberships","Automatische no-show preventie","AI omzet-inzichten","Marketing automations","Prioritaire support"]'::jsonb,
  true, false, 2),
('premium', 'Premium', 129.00, 12900,
  'Voor salons met meerdere vestigingen en hoge volumes.',
  '["Alles uit Growth","Onbeperkt medewerkers","Multi-vestiging","White-label boekingspagina","Geavanceerde AI Auto Revenue Engine","Custom integraties","Persoonlijke onboarding","Dedicated account manager"]'::jsonb,
  false, true, 3);