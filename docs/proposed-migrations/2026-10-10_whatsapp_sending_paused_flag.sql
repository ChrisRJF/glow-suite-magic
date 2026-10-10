-- PROPOSED, NOT APPLIED (Send Security 1.0). Never run without separate approval.
-- Emergency stop for the future whatsapp-send. Default TRUE: every salon starts paused and is
-- released individually by a platform admin. Missing row = paused (enforced in the adapter).
-- tenant_feature_flags is already read-only for app users (see AGENTS.md); no new grants.

alter table public.tenant_feature_flags
  add column if not exists whatsapp_sending_paused boolean not null default true;

comment on column public.tenant_feature_flags.whatsapp_sending_paused is
  'Emergency stop for WhatsApp sending. true = no claim, no provider contact. Set by platform admins only.';
