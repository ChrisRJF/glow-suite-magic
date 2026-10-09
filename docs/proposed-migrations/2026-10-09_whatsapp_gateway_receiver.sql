-- PROPOSED, NOT APPLIED. Lives outside supabase/migrations on purpose.
-- Review and apply only after separate approval.

create table if not exists public.whatsapp_gateway_tenant_links (
  gateway_tenant_ref text primary key,
  tenant_id uuid not null unique,
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.whatsapp_gateway_tenant_links enable row level security;
revoke all on public.whatsapp_gateway_tenant_links from anon, authenticated;
grant select on public.whatsapp_gateway_tenant_links to authenticated;
create policy "tenant reads own link" on public.whatsapp_gateway_tenant_links
  for select to authenticated using (tenant_id = auth.uid());

create table if not exists public.whatsapp_gateway_receipts (
  tenant_id uuid not null,
  event_id text not null,
  effect_kind text not null,
  received_at timestamptz not null default now(),
  primary key (tenant_id, event_id)
);
alter table public.whatsapp_gateway_receipts enable row level security;
revoke all on public.whatsapp_gateway_receipts from anon, authenticated;

create table if not exists public.whatsapp_stop_list (
  tenant_id uuid not null,
  phone_e164 text not null,
  stopped_at timestamptz not null default now(),
  primary key (tenant_id, phone_e164)
);
alter table public.whatsapp_stop_list enable row level security;
revoke all on public.whatsapp_stop_list from anon, authenticated;
grant select on public.whatsapp_stop_list to authenticated;
create policy "tenant reads own stops" on public.whatsapp_stop_list
  for select to authenticated using (tenant_id = auth.uid());

-- Receipt + business write in one transaction (service_role only).
create or replace function public.gateway_apply_stop(_tenant uuid, _event text, _phone text)
returns text language plpgsql security definer set search_path = public as $$
begin
  insert into whatsapp_gateway_receipts(tenant_id, event_id, effect_kind)
  values (_tenant, _event, 'stop') on conflict do nothing;
  if not found then return 'duplicate'; end if;
  insert into whatsapp_stop_list(tenant_id, phone_e164) values (_tenant, _phone)
  on conflict do nothing;
  return 'applied';
end $$;
revoke all on function public.gateway_apply_stop(uuid, text, text) from public, anon, authenticated;
