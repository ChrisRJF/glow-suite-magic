-- PROPOSED, NOT APPLIED (round 8C). Never run against the GlowSuite or Gateway database
-- without separate approval. Tested only in a throwaway local PostgreSQL 17 (src/test/sql/run-local-pg-8c.sh).
--
-- Send claims (one per salon + send action) and one-time nonces for signed internal requests.
-- Stored: keyed HMAC fingerprints, masked phone, provider code. NOT stored: message text,
-- full phone numbers, booking tokens, signing secrets.
-- Access: service_role only, via SECURITY DEFINER functions. No client (anon/authenticated) access.

create table public.wa_send_claims (
  tenant_id     uuid        not null,
  claim_key     text        not null check (claim_key ~ '^[0-9a-f]{64}$'),
  fingerprint   text        not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  state         text        not null default 'claimed' check (state in ('claimed','sent','failed','unknown')),
  customer_id   uuid        not null,
  kind          text        not null check (kind ~ '^[a-z_]{1,32}$'),
  to_masked     text            null check (to_masked ~ '^\+[0-9]{2}\*{4}[0-9]{2}$'),
  provider_code integer         null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, claim_key)
);
create index wa_send_claims_created_idx on public.wa_send_claims (created_at);

create table public.wa_service_nonces (
  caller     text        not null check (caller in ('reminder-scheduler','automation-scheduler','auto-rebook',
                                                    'booking-confirmation','payment-webhook','customer-forms')),
  nonce      text        not null check (nonce ~ '^[0-9a-f]{32,64}$'),
  expires_at timestamptz not null,
  primary key (caller, nonce)
);
create index wa_service_nonces_exp_idx on public.wa_service_nonces (expires_at);

alter table public.wa_send_claims    enable row level security;
alter table public.wa_service_nonces enable row level security;
alter table public.wa_send_claims    force row level security;
alter table public.wa_service_nonces force row level security;
-- No policies: no client role can read or write. service_role uses the functions below.
revoke all on public.wa_send_claims, public.wa_service_nonces from public, anon, authenticated;

-- Atomic claim. Concurrent callers with the same key block on the unique index; after the
-- first commits the other gets created=false; if the first rolls back the other claims.
-- The stored fingerprint is never returned (only whether it matches).
create function public.wa_claim_send(_tenant uuid, _key text, _fp text, _customer uuid, _kind text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare r public.wa_send_claims%rowtype;
begin
  if _tenant is null or _customer is null or _key !~ '^[0-9a-f]{64}$' or _fp !~ '^[0-9a-f]{64}$'
     or _kind !~ '^[a-z_]{1,32}$' then
    return jsonb_build_object('result','invalid','code',422);
  end if;
  insert into public.wa_send_claims(tenant_id, claim_key, fingerprint, customer_id, kind)
  values (_tenant, _key, _fp, _customer, _kind)
  on conflict (tenant_id, claim_key) do nothing;
  if found then return jsonb_build_object('result','created','code',200); end if;
  select * into r from public.wa_send_claims where tenant_id = _tenant and claim_key = _key;
  if r.fingerprint <> _fp then return jsonb_build_object('result','conflict','code',409); end if;
  return jsonb_build_object('result','exists','code',409,'state',r.state);
end $$;

-- Only claimed -> sent | failed | unknown. Terminal states never change (no silent resend).
create function public.wa_finalize_send(_tenant uuid, _key text, _state text, _to_masked text, _provider_code integer)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
begin
  if _state not in ('sent','failed','unknown') then return false; end if;
  if _to_masked is not null and _to_masked !~ '^\+[0-9]{2}\*{4}[0-9]{2}$' then return false; end if;
  update public.wa_send_claims set state = _state, to_masked = _to_masked, provider_code = _provider_code, updated_at = now()
   where tenant_id = _tenant and claim_key = _key and state = 'claimed';
  return found;
end $$;

-- One-time nonce. true = stored now, false = replay. Expiry must be within the 10-minute window.
create function public.wa_remember_nonce(_caller text, _nonce text, _expires_at timestamptz)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
begin
  if _expires_at is null or _expires_at <= now() or _expires_at > now() + interval '15 minutes' then
    raise exception 'invalid_nonce_expiry' using errcode = '22023';
  end if;
  insert into public.wa_service_nonces(caller, nonce, expires_at) values (_caller, _nonce, _expires_at)
  on conflict (caller, nonce) do nothing;
  return found;
end $$;

-- Cleanup (round 8D). Nonces: once expired (replay window closed).
-- Claims: kept at least _retention_days (minimum 400). 'claimed'/'unknown' (outcome uncertain)
-- are kept 30 days longer for review. A row is deleted only when STRICTLY older than its limit.
-- Limitation: after deletion the same key can be claimed again. Callers must therefore never
-- retry a send action or business event older than 400 days (reminder/confirmation/form events
-- are far younger; retry backoff is minutes). Documented in the rollout plan.
create function public.wa_send_purge(_retention_days integer)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare n int; c int;
begin
  if _retention_days is null or _retention_days < 400 then
    raise exception 'retention_too_short' using errcode = '22023';
  end if;
  delete from public.wa_service_nonces where expires_at < now(); get diagnostics n = row_count;
  delete from public.wa_send_claims
   where (state in ('sent','failed') and created_at < now() - make_interval(days => _retention_days))
      or (state in ('claimed','unknown') and created_at < now() - make_interval(days => _retention_days + 30));
  get diagnostics c = row_count;
  return jsonb_build_object('nonces', n, 'claims', c);
end $$;

revoke all on function public.wa_claim_send(uuid,text,text,uuid,text),
                       public.wa_finalize_send(uuid,text,text,text,integer),
                       public.wa_remember_nonce(text,text,timestamptz),
                       public.wa_send_purge(integer) from public, anon, authenticated;
grant execute on function public.wa_claim_send(uuid,text,text,uuid,text),
                          public.wa_finalize_send(uuid,text,text,text,integer),
                          public.wa_remember_nonce(text,text,timestamptz),
                          public.wa_send_purge(integer) to service_role;
