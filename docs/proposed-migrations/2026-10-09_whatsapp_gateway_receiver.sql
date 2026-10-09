-- PROPOSED, NOT APPLIED. Lives outside supabase/migrations on purpose.
-- Matches Gateway docs/glowsuite-dispatch-contract.md v1 (sections 3 and 5).
-- Apply only after separate approval, first in a test salon.

-- 3. Tenant allow-list. Gateway tenant_id is external; salon_id is GlowSuite's own.
create table if not exists public.gateway_tenant_links (
  tenant_id text primary key,
  salon_id uuid not null unique,
  enabled boolean not null default false,
  allowed_action_types text[] not null default '{}'::text[],
  updated_at timestamptz not null default now(),
  constraint allowed_actions_valid check (allowed_action_types <@ array[
    'opt_out_signal','inbound_message_record','delivery_status_record','confirmation_token_received']::text[])
);
alter table public.gateway_tenant_links enable row level security;
revoke all on public.gateway_tenant_links from anon, authenticated;
grant select on public.gateway_tenant_links to authenticated;
create policy "salon reads own gateway link" on public.gateway_tenant_links
  for select to authenticated using (salon_id = auth.uid());

-- 5. Receipts. Retention >= 400 days (cleanup job must respect this).
create table if not exists public.gateway_command_receipts (
  idempotency_key text primary key check (idempotency_key ~ '^[0-9a-f]{64}$'),
  tenant_id text not null,
  salon_id uuid not null,
  action_type text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('applied','accepted_noop','business_rejected')),
  response_code int not null,
  response_body_min jsonb not null default '{}'::jsonb,  -- codes only, no text/phones/tokens
  created_at timestamptz not null default now()
);
alter table public.gateway_command_receipts enable row level security;
revoke all on public.gateway_command_receipts from anon, authenticated;

-- Opt-out per salon, by hashed contact ref only (no phone number stored here).
create table if not exists public.whatsapp_opt_outs (
  salon_id uuid not null,
  contact_ref text not null,
  opted_out_at timestamptz not null default now(),
  primary key (salon_id, contact_ref)
);
alter table public.whatsapp_opt_outs enable row level security;
revoke all on public.whatsapp_opt_outs from anon, authenticated;
grant select on public.whatsapp_opt_outs to authenticated;
create policy "salon reads own opt-outs" on public.whatsapp_opt_outs
  for select to authenticated using (salon_id = auth.uid());

-- Delivery status per outbound message, forward-only.
create table if not exists public.whatsapp_delivery_status (
  salon_id uuid not null,
  outbound_ref text not null,
  status text not null check (status in ('sent','delivered','read','failed')),
  updated_at timestamptz not null default now(),
  primary key (salon_id, outbound_ref)
);
alter table public.whatsapp_delivery_status enable row level security;
revoke all on public.whatsapp_delivery_status from anon, authenticated;
grant select on public.whatsapp_delivery_status to authenticated;
create policy "salon reads own delivery status" on public.whatsapp_delivery_status
  for select to authenticated using (salon_id = auth.uid());

create or replace function public.gateway_status_rank(s text) returns int
language sql immutable set search_path = public as $$
  select case s when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 when 'failed' then 4 else 0 end
$$;

-- Atomic receipt + business write. service_role only. One transaction.
-- Returns jsonb {result, code}. Confirmation tokens are NOT handled here: they
-- go through the existing appointment-confirm validation (signature, expiry,
-- ownership, state) in a separate approved step.
create or replace function public.gateway_process_command(
  _idempotency_key text, _tenant_id text, _action_type text, _request_hash text,
  _contact_ref text default null, _outbound_ref text default null, _status text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  _link gateway_tenant_links%rowtype;
  _existing gateway_command_receipts%rowtype;
  _result text := 'applied';
  _code int := 200;
  _n int;
begin
  select * into _link from gateway_tenant_links where tenant_id = _tenant_id;
  if not found or not _link.enabled or not (_action_type = any(_link.allowed_action_types)) then
    return jsonb_build_object('result','tenant_not_authorized','code',403);
  end if;

  -- Serialise concurrent identical keys.
  perform pg_advisory_xact_lock(hashtextextended(_idempotency_key, 0));
  select * into _existing from gateway_command_receipts where idempotency_key = _idempotency_key;
  if found then
    if _existing.request_hash = _request_hash and _existing.tenant_id = _tenant_id then
      return jsonb_build_object('result','duplicate','code',200,'stored_code',_existing.response_code);
    end if;
    return jsonb_build_object('result','conflict','code',409);
  end if;

  if _action_type = 'opt_out_signal' then
    insert into whatsapp_opt_outs(salon_id, contact_ref) values (_link.salon_id, _contact_ref)
      on conflict do nothing;
    get diagnostics _n = row_count;
    if _n = 0 then _result := 'accepted_noop'; _code := 202; end if;
  elsif _action_type = 'delivery_status_record' then
    insert into whatsapp_delivery_status(salon_id, outbound_ref, status)
      values (_link.salon_id, _outbound_ref, _status)
      on conflict (salon_id, outbound_ref) do update
        set status = excluded.status, updated_at = now()
        where gateway_status_rank(excluded.status) > gateway_status_rank(whatsapp_delivery_status.status);
    get diagnostics _n = row_count;
    if _n = 0 then _result := 'accepted_noop'; _code := 202; end if;
  elsif _action_type = 'inbound_message_record' then
    _result := 'accepted_noop'; _code := 202;  -- metadata only; no body stored
  else
    return jsonb_build_object('result','business_rejected','code',422,'reason','not_enabled_in_this_step');
  end if;

  insert into gateway_command_receipts(idempotency_key, tenant_id, salon_id, action_type, request_hash,
    status, response_code, response_body_min)
  values (_idempotency_key, _tenant_id, _link.salon_id, _action_type, _request_hash,
    _result, _code, jsonb_build_object('code', _result));
  return jsonb_build_object('result', _result, 'code', _code);
end $$;
revoke all on function public.gateway_process_command(text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.gateway_process_command(text,text,text,text,text,text,text) to service_role;
