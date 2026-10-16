-- DRAFT / PROPOSED ONLY. NOT APPLIED. Requires a separate explicit GO.
-- Purpose: new salons get Viva (GlowPay) as their payment provider by default.
-- Scope: only the column DEFAULT for future INSERTs. No existing row is touched,
-- no other column, constraint, policy or grant is changed. Existing stored
-- 'mollie' rows stay legacy and keep working until the owner switches.

ALTER TABLE public.settings ALTER COLUMN payment_provider SET DEFAULT 'viva';

-- Rollback:
-- ALTER TABLE public.settings ALTER COLUMN payment_provider SET DEFAULT 'mollie';
