-- PROPOSED, NOT APPLIED. Lives outside supabase/migrations on purpose.
-- Matches Gateway docs/glowsuite-dispatch-contract.md v1 (sections 3 and 5)
-- plus supabase/functions/_shared/inactive/CONTRACT-ADDENDUM.md.
-- Round 7: tested ONLY in a throwaway local PostgreSQL 17 (src/test/sql/run-local-pg.sh). Apply only after separate approval, and
-- first in a separate, empty test database (see bottom of file).

-- Tenant allow-list. Gateway tenant_id is external; salon_id is GlowSuite's own.
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
-- Round 7.1: GlowSuite tenant = owner's user id. public.current_tenant_id() (existing,
-- unchanged) returns it for an owner (role eigenaar) or for a member with exactly ONE
-- active user_access row; revoked/ambiguous/missing -> NULL -> no rows.
-- Role gate: management info (links) only eigenaar/admin; delivery status also manager.
create or replace function public.gateway_tenant_role_allows(_salon uuid, _roles public.app_role[])
returns boolean language plpgsql stable security definer set search_path = public as $$
declare _uid uuid := auth.uid(); _t uuid;
begin
  if _uid is null or _salon is null then return false; end if;
  _t := public.current_tenant_id();
  if _t is null or _t <> _salon then return false; end if;
  if _uid = _salon then  -- the owner of this salon
    return 'eigenaar'::public.app_role = any(_roles)
       and exists (select 1 from user_roles where user_id = _uid and role = 'eigenaar');
  end if;
  return exists (select 1 from user_access ua
    where ua.member_user_id = _uid and ua.owner_user_id = _salon
      and ua.status = 'active' and ua.role = any(_roles));
end $$;
revoke all on function public.gateway_tenant_role_allows(uuid, public.app_role[]) from public, anon;
grant execute on function public.gateway_tenant_role_allows(uuid, public.app_role[]) to authenticated, service_role;

create policy "salon managers read own gateway link" on public.gateway_tenant_links
  for select to authenticated
  using (public.gateway_tenant_role_allows(salon_id, array['eigenaar','admin']::public.app_role[]));

-- Receipts. Global PK on idempotency_key; tenant mismatch on the same key is a conflict.
-- Retention >= 400 days, enforced by gateway_receipts_retention().
create table if not exists public.gateway_command_receipts (
  idempotency_key text primary key check (idempotency_key ~ '^[0-9a-f]{64}$'),
  tenant_id text not null,
  salon_id uuid not null,
  action_type text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('processing','applied','accepted_noop','business_rejected')),
  response_code int not null,
  response_body_min jsonb not null default '{}'::jsonb,  -- codes only, never numbers/refs/tokens
  created_at timestamptz not null default now()
);
create index if not exists gateway_command_receipts_created_idx on public.gateway_command_receipts(created_at);
alter table public.gateway_command_receipts enable row level security;
revoke all on public.gateway_command_receipts from anon, authenticated;

-- STOP per salon, by keyed contact_ref only (never the phone number).
create table if not exists public.whatsapp_opt_outs (
  salon_id uuid not null,
  contact_ref text not null check (contact_ref ~ '^c1\.[a-z0-9]{1,16}\.[0-9a-f]{64}$'),
  opted_out_at timestamptz not null default now(),
  primary key (salon_id, contact_ref)
);
alter table public.whatsapp_opt_outs enable row level security;
revoke all on public.whatsapp_opt_outs from anon, authenticated;

-- Outbound messages sent via the Gateway (created by a FUTURE send path).
-- Status lives here, bound to (salon_id, outbound_ref).
create table if not exists public.whatsapp_outbound_messages (
  salon_id uuid not null,
  outbound_ref text not null,
  status text check (status in ('sent','delivered','read','failed')),
  failed_attempts int not null default 0,
  last_failed_at timestamptz,
  status_conflict boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (salon_id, outbound_ref)
);
alter table public.whatsapp_outbound_messages enable row level security;
revoke all on public.whatsapp_outbound_messages from anon, authenticated;
grant select on public.whatsapp_outbound_messages to authenticated;
create policy "salon staff read own outbound status" on public.whatsapp_outbound_messages
  for select to authenticated
  using (public.gateway_tenant_role_allows(salon_id, array['eigenaar','admin','manager']::public.app_role[]));

-- Send-time STOP check (future whatsapp-send wiring). refs = ref under every active key version.
create or replace function public.whatsapp_is_opted_out(_salon uuid, _refs text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from whatsapp_opt_outs where salon_id = _salon and contact_ref = any(_refs))
$$;
revoke all on function public.whatsapp_is_opted_out(uuid, text[]) from public, anon, authenticated;
grant execute on function public.whatsapp_is_opted_out(uuid, text[]) to service_role;

-- Atomic receipt + business write. One call = one transaction.
--  * Receipt row is inserted FIRST. A concurrent call with the same key blocks
--    on the PK until the first commits or rolls back, then sees the committed
--    row (duplicate/conflict) or inserts itself (after a rollback).
--  * Any exception rolls back receipt AND effect together; the Gateway retries.
create or replace function public.gateway_process_command(
  _idempotency_key text, _tenant_id text, _action_type text, _request_hash text,
  _contact_ref text default null, _outbound_ref text default null, _status text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  _link gateway_tenant_links%rowtype;
  _existing gateway_command_receipts%rowtype;
  _msg whatsapp_outbound_messages%rowtype;
  _inserted int;
  _result text := 'applied';
  _code int := 200;
  _reason text := null;
  _n int;
  _cur_rank int;
  _new_rank int;
begin
  select * into _link from gateway_tenant_links where tenant_id = _tenant_id;
  if not found or not _link.enabled or not (_action_type = any(_link.allowed_action_types)) then
    return jsonb_build_object('result','tenant_not_authorized','code',403);
  end if;
  -- Round 7.1: malformed business input -> 422 BEFORE any write, so no receipt and no
  -- effect (consistent with confirmation 422). The Gateway may retry with the same key
  -- after correcting its input. Reasons are codes only; never echo the input.
  if _idempotency_key is null or _idempotency_key !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('result','business_rejected','code',422,'reason','invalid_idempotency_key');
  end if;
  if _request_hash is null or _request_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('result','business_rejected','code',422,'reason','invalid_request_hash');
  end if;
  if _action_type = 'opt_out_signal' then
    if _contact_ref is null then
      return jsonb_build_object('result','business_rejected','code',422,'reason','missing_contact_ref');
    elsif _contact_ref !~ '^c1\.[a-z0-9]{1,16}\.[0-9a-f]{64}$' then
      return jsonb_build_object('result','business_rejected','code',422,'reason','invalid_contact_ref');
    end if;
  end if;
  if _action_type = 'delivery_status_record' then
    if _outbound_ref is null or length(_outbound_ref) = 0 or length(_outbound_ref) > 128 then
      return jsonb_build_object('result','business_rejected','code',422,'reason','invalid_outbound_ref');
    end if;
    if _status is null or _status not in ('sent','delivered','read','failed') then
      return jsonb_build_object('result','business_rejected','code',422,'reason','invalid_status');
    end if;
  end if;
  if _action_type = 'confirmation_token_received' then
    return jsonb_build_object('result','business_rejected','code',422,'reason','confirmation_not_enabled');
  end if;

  insert into gateway_command_receipts(idempotency_key, tenant_id, salon_id, action_type, request_hash, status, response_code)
  values (_idempotency_key, _tenant_id, _link.salon_id, _action_type, _request_hash, 'processing', 0)
  on conflict (idempotency_key) do nothing;
  get diagnostics _inserted = row_count;

  if _inserted = 0 then
    select * into _existing from gateway_command_receipts where idempotency_key = _idempotency_key;
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
    select * into _msg from whatsapp_outbound_messages
      where salon_id = _link.salon_id and outbound_ref = _outbound_ref
      for update;
    -- Round 7 fix: CASE inside an ELSIF condition broke PL/pgSQL parsing (THEN).
    _cur_rank := coalesce(array_position(array['sent','delivered','read'], _msg.status), 0);
    _new_rank := coalesce(array_position(array['sent','delivered','read'], _status), 0);
    if not found then
      _result := 'business_rejected'; _code := 422; _reason := 'unknown_outbound_ref';
    elsif _status = 'failed' then
      if _msg.status in ('delivered','read') then
        update whatsapp_outbound_messages
          set failed_attempts = failed_attempts + 1, last_failed_at = now(), status_conflict = true, updated_at = now()
          where salon_id = _link.salon_id and outbound_ref = _outbound_ref;
      elsif _msg.status = 'failed' then
        _result := 'accepted_noop'; _code := 202;
      else
        update whatsapp_outbound_messages
          set status = 'failed', failed_attempts = failed_attempts + 1, last_failed_at = now(), updated_at = now()
          where salon_id = _link.salon_id and outbound_ref = _outbound_ref;
      end if;
    elsif _msg.status = 'failed' and _status = 'sent' then
      _result := 'accepted_noop'; _code := 202;
    elsif _msg.status = 'failed' or _cur_rank < _new_rank then
      update whatsapp_outbound_messages set status = _status, updated_at = now()
        where salon_id = _link.salon_id and outbound_ref = _outbound_ref;
    else
      _result := 'accepted_noop'; _code := 202;
    end if;

  elsif _action_type = 'inbound_message_record' then
    _result := 'accepted_noop'; _code := 202;  -- metadata only; nothing stored, no body
  end if;

  update gateway_command_receipts
    set status = _result, response_code = _code,
        response_body_min = jsonb_strip_nulls(jsonb_build_object('code', _result, 'reason', _reason))
    where idempotency_key = _idempotency_key;
  return jsonb_strip_nulls(jsonb_build_object('result', _result, 'code', _code, 'reason', _reason));
end $$;
revoke all on function public.gateway_process_command(text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.gateway_process_command(text,text,text,text,text,text,text) to service_role;

-- Retention: never deletes receipts younger than 400 days.
create or replace function public.gateway_receipts_retention(_keep_days int default 400)
returns int language plpgsql security definer set search_path = public as $$
declare _n int;
begin
  if _keep_days is null or _keep_days < 400 then  /* round 7: null refused */ raise exception 'retention must be >= 400 days'; end if;
  delete from gateway_command_receipts where created_at < now() - make_interval(days => _keep_days);
  get diagnostics _n = row_count;
  return _n;
end $$;
revoke all on function public.gateway_receipts_retention(int) from public, anon, authenticated;
grant execute on function public.gateway_receipts_retention(int) to service_role;

-- ---------------------------------------------------------------------------
-- LATER (not done): real integration tests in a separate, throwaway Postgres
-- (local container or a separate empty Cloud project), never GlowSuite's DB:
--  1. apply this file to the empty DB; seed two fictitious tenant links;
--  2. two parallel sessions calling gateway_process_command with the same key
--     (same hash -> one applied + one duplicate; different hash -> 409);
--  3. kill a session mid-transaction (pg_terminate_backend) -> no receipt, no effect;
--  4. status orderings and failed-after-delivered against whatsapp_outbound_messages;
--  5. cross-tenant: tenant B never reads/writes rows of salon A;
--  6. retention: rows of 399 days survive, < 400 argument raises.
