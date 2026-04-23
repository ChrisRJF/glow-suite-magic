import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = 'Chrisrjfrancois@hotmail.com';
const password = 'Huisbaas1234';

if (!url || !serviceKey) throw new Error('Missing backend admin env');
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: list, error: listError } = await admin.auth.admin.listUsers();
if (listError) throw listError;
let user = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

if (!user) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: 'Chris Francois' },
  });
  if (error) throw error;
  user = data.user;
} else {
  const { data, error } = await admin.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
    user_metadata: { ...(user.user_metadata ?? {}), name: user.user_metadata?.name ?? 'Chris Francois' },
  });
  if (error) throw error;
  user = data.user;
}

const userId = user.id;
await admin.from('profiles').upsert({ user_id: userId, email, salon_name: 'Mijn Salon' }, { onConflict: 'user_id' }).throwOnError();
await admin.from('user_roles').delete().eq('user_id', userId).throwOnError();
await admin.from('user_roles').insert({ user_id: userId, role: 'eigenaar' }).throwOnError();
await admin.from('settings').delete().eq('user_id', userId).eq('is_demo', true).throwOnError();
const { data: existingSettings, error: settingsReadError } = await admin.from('settings').select('id').eq('user_id', userId).eq('is_demo', false).limit(1);
if (settingsReadError) throw settingsReadError;
if (existingSettings?.length) {
  await admin.from('settings').update({ demo_mode: false, is_demo: false, mollie_mode: 'live', salon_name: 'Mijn Salon' }).eq('id', existingSettings[0].id).throwOnError();
} else {
  await admin.from('settings').insert({ user_id: userId, salon_name: 'Mijn Salon', demo_mode: false, is_demo: false, mollie_mode: 'live', language: 'nl', currency: 'EUR', timezone: 'Europe/Amsterdam' }).throwOnError();
}

const { data: verify, error: verifyError } = await admin
  .from('settings')
  .select('user_id,is_demo,demo_mode,mollie_mode')
  .eq('user_id', userId)
  .eq('is_demo', false);
if (verifyError) throw verifyError;
console.log(JSON.stringify({ created_or_updated: true, user_id: userId, live_settings_count: verify.length }));
