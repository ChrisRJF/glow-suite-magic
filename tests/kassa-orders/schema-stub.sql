-- Minimal copies of existing tables (fictional). Mirrors production default grants incl. sandbox_exec.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE sandbox_exec;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT ON TABLES TO sandbox_exec;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, sandbox_exec;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;
CREATE TYPE public.app_role AS ENUM ('eigenaar','admin','medewerker','financieel','manager','receptie');
CREATE TABLE tenant_feature_flags (tenant_id uuid PRIMARY KEY, atomic_agenda_enabled boolean DEFAULT false);
CREATE TABLE settings (id uuid DEFAULT gen_random_uuid(), user_id uuid, is_demo boolean, demo_mode boolean, created_at timestamptz DEFAULT now());
CREATE TABLE user_roles (id uuid DEFAULT gen_random_uuid(), user_id uuid, role app_role);
CREATE TABLE user_access (owner_user_id uuid, member_user_id uuid, role text, status text, is_demo boolean);
CREATE TABLE glowpay_connected_merchants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, is_demo boolean, viva_account_id text,
  viva_merchant_id text, onboarding_status text, kyc_status text, payouts_enabled boolean, terminals_enabled boolean, online_payments_enabled boolean,
  viva_source_code text, reseller_source_code text, setup_complete boolean, business_name text);
CREATE TABLE payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, appointment_id uuid, amount numeric, is_demo boolean, provider text,
  status text, paid_at timestamptz, metadata jsonb DEFAULT '{}', refunded_amount numeric, mollie_payment_id text, method text);
CREATE TABLE products (id uuid PRIMARY KEY, user_id uuid, name text, price numeric, stock integer, is_active boolean, is_demo boolean, updated_at timestamptz);
CREATE TABLE services (id uuid PRIMARY KEY, user_id uuid, name text, price numeric, is_active boolean, is_demo boolean);
CREATE TABLE customers (id uuid PRIMARY KEY, user_id uuid, name text, total_spent numeric DEFAULT 0, is_demo boolean, updated_at timestamptz);
CREATE TABLE checkout_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, item_type text, item_id uuid, title text, price numeric,
  quantity integer, customer_id uuid, is_demo boolean);
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
