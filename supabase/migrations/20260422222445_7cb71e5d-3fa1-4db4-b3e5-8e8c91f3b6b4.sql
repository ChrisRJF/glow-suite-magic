DO $$
DECLARE
  table_name text;
  policy_prefix text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'services', 'campaigns', 'discounts', 'products', 'automation_rules',
    'feedback_entries', 'rebook_actions', 'gift_cards', 'waitlist_entries',
    'checkout_items', 'payment_links', 'sub_appointments', 'leads'
  ]
  LOOP
    policy_prefix := replace(table_name, '_', ' ');
    EXECUTE format('DROP POLICY IF EXISTS "Users can view own %s" ON public.%I', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Users can insert own %s" ON public.%I', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Users can update own %s" ON public.%I', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Users can delete own %s" ON public.%I', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Users can view own waitlist" ON public.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Users can insert own waitlist" ON public.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Users can update own waitlist" ON public.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Users can delete own waitlist" ON public.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Users can view %s in active mode" ON public.%I', policy_prefix, table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Users can insert %s in active mode" ON public.%I', policy_prefix, table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Users can update %s in active mode" ON public.%I', policy_prefix, table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Users can delete %s in active mode" ON public.%I', policy_prefix, table_name);

    EXECUTE format('CREATE POLICY "Users can view %s in active mode" ON public.%I FOR SELECT USING (public.user_row_matches_active_mode(user_id, is_demo))', policy_prefix, table_name);
    EXECUTE format('CREATE POLICY "Users can insert %s in active mode" ON public.%I FOR INSERT WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo())', policy_prefix, table_name);
    EXECUTE format('CREATE POLICY "Users can update %s in active mode" ON public.%I FOR UPDATE USING (public.user_row_matches_active_mode(user_id, is_demo)) WITH CHECK (auth.uid() = user_id AND is_demo = public.current_account_is_demo())', policy_prefix, table_name);
    EXECUTE format('CREATE POLICY "Users can delete %s in active mode" ON public.%I FOR DELETE USING (public.user_row_matches_active_mode(user_id, is_demo))', policy_prefix, table_name);

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(user_id, is_demo)', 'idx_' || table_name || '_user_mode', table_name);
  END LOOP;
END $$;