ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS free_period_starts_at timestamptz;
INSERT INTO public.subscriptions (user_id, plan_slug, status, trial_started_at, trial_ends_at, free_period_starts_at, welcome_sent_at, day3_sent_at, day7_sent_at, day10_sent_at, day14_sent_at)
VALUES ('1c6c885e-c944-4717-b2ef-9cfdb9fa15ae', 'growth', 'trialing', '2026-10-09T00:00:00+02', '2026-12-01T00:00:00+01', '2026-11-01T00:00:00+01', now(), now(), now(), now(), now())
ON CONFLICT (user_id) DO NOTHING;