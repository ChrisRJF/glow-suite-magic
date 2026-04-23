import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const email = 'Chrisrjfrancois@hotmail.com';
const password = 'Huisbaas1234';

if (!url || !anon) throw new Error('Missing client env');
const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: auth, error: loginError } = await client.auth.signInWithPassword({ email, password });
if (loginError || !auth.user) throw loginError ?? new Error('No user');
const { error: bootstrapError } = await client.rpc('bootstrap_current_user');
if (bootstrapError) throw bootstrapError;
const { data: roles, error: rolesError } = await client.from('user_roles').select('role').eq('user_id', auth.user.id);
if (rolesError) throw rolesError;
const { data: settings, error: settingsError } = await client.from('settings').select('is_demo,demo_mode,mollie_mode').eq('user_id', auth.user.id);
if (settingsError) throw settingsError;
console.log(JSON.stringify({ login_ok: true, owner: roles.some(r => r.role === 'eigenaar'), non_demo: settings.some(s => s.is_demo === false && s.demo_mode === false), mollie_live_ready: settings.some(s => s.mollie_mode === 'live') }));
