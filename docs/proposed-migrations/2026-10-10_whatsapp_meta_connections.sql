-- PROPOSAL, NOT APPLIED. Per-salon Meta WhatsApp connection. Holds NO tokens (credential_ref only).
-- Written only by server processes (future Embedded Signup function); salon users read nothing here.
create table if not exists public.whatsapp_meta_connections (
  tenant_id uuid primary key,                       -- one connection per salon
  waba_id text not null check (waba_id ~ '^\d{5,20}$'),
  phone_number_id text not null unique check (phone_number_id ~ '^\d{5,20}$'), -- a number serves one salon
  status text not null default 'pending' check (status in ('active','pending','revoked','expired','disabled')),
  app_id text not null check (app_id ~ '^\d{5,20}$'),
  credential_ref text not null unique check (credential_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  capabilities text[] not null default '{}',
  expires_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.whatsapp_meta_connections enable row level security;
revoke all on public.whatsapp_meta_connections from anon, authenticated;
grant select, insert, update, delete on public.whatsapp_meta_connections to service_role;
