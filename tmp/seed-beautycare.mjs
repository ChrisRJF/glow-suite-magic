// One-off: create the isolated Beautycare Groningen demo tenant (is_demo = true).
// Fictional data only. No real messaging, no real payments, no production data copied.
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('missing admin env');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const EMAIL = 'beautycare.demo@glowsuite.nl';
const SALON = 'Beautycare Groningen';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const canonicalJson = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
};
const ok = (r, label) => { if (r.error) throw new Error(`${label}: ${r.error.message}`); return r.data; };

// ---------------------------------------------------------------- auth user
const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
let user = list.users.find((u) => u.email?.toLowerCase() === EMAIL);
const password = `Bc-${randomBytes(9).toString('base64url')}`;
if (!user) {
  user = ok(await db.auth.admin.createUser({
    email: EMAIL, password, email_confirm: true,
    user_metadata: { name: 'Danica (demo)', salon_name: SALON },
  }), 'createUser').user;
} else {
  user = ok(await db.auth.admin.updateUserById(user.id, { password, email_confirm: true }), 'updateUser').user;
}
const uid = user.id;

// ------------------------------------------------------- clean previous seed
const wipe = [
  'clinical_media', 'treatment_records', 'treatment_record_templates', 'customer_alerts',
  'form_submissions', 'form_requests', 'form_template_versions', 'service_form_requirements',
  'form_templates', 'customer_consents', 'payments', 'appointments', 'treatment_journeys',
  'customers', 'services', 'employees', 'settings',
];
for (const t of wipe) {
  const r = await db.from(t).delete().eq('user_id', uid);
  if (r.error && !/immutab|append|not allowed|blocked/i.test(r.error.message)) console.warn(`wipe ${t}: ${r.error.message}`);
}
await db.storage.from('clinical-files').list(uid).then(async ({ data }) => {
  if (data?.length) await db.storage.from('clinical-files').remove(data.map((f) => `${uid}/${f.name}`));
});

// ------------------------------------------------------------------ identity
ok(await db.from('profiles').upsert({ user_id: uid, email: EMAIL, salon_name: SALON, city: 'Groningen' }, { onConflict: 'user_id' }), 'profiles');
await db.from('user_roles').delete().eq('user_id', uid);
ok(await db.from('user_roles').insert({ user_id: uid, role: 'eigenaar' }), 'user_roles');

ok(await db.from('settings').insert({
  user_id: uid, salon_name: SALON, demo_mode: true, is_demo: true,
  language: 'nl', currency: 'EUR', timezone: 'Europe/Amsterdam',
  mollie_mode: 'test', payment_provider: 'mollie', viva_demo_enabled: true, viva_live_enabled: false,
  whatsapp_enabled: false, email_enabled: false,
  buffer_minutes: 10, cancellation_notice: 'Annuleer of verplaats je afspraak minimaal 24 uur van tevoren.',
  whitelabel_branding: { salon_name: SALON, show_logo: false, logo_url: '', primary_color: '#7B61FF', secondary_color: '#C850C0', sales_demo_access: true },
  opening_hours: {
    ma: { open: '09:00', close: '17:30', enabled: true }, di: { open: '09:00', close: '17:30', enabled: true },
    wo: { open: '09:00', close: '20:00', enabled: true }, do: { open: '09:00', close: '17:30', enabled: true },
    vr: { open: '09:00', close: '17:00', enabled: true }, za: { open: '09:00', close: '15:00', enabled: true },
    zo: { open: '09:00', close: '17:00', enabled: false },
  },
}), 'settings');

// ----------------------------------------------------------------- employees
const employees = ok(await db.from('employees').insert([
  { user_id: uid, is_demo: true, name: 'Danica', role: 'Eigenaresse / behandelaar', color: '#7B61FF', sort_order: 1, working_days: [1, 2, 3, 4, 5], is_active: true },
  { user_id: uid, is_demo: true, name: 'Sophie', role: 'Behandelaar', color: '#C850C0', sort_order: 2, working_days: [1, 2, 3, 4, 5], is_active: true },
  { user_id: uid, is_demo: true, name: 'Mila', role: 'Receptie', color: '#45B7D1', sort_order: 3, working_days: [1, 2, 3, 4, 5], is_active: true },
]).select('id, name'), 'employees');
const emp = Object.fromEntries(employees.map((e) => [e.name, e.id]));

// ------------------------------------------------------------------ services
const services = ok(await db.from('services').insert([
  { user_id: uid, is_demo: true, name: 'Gezichtsbehandeling', duration_minutes: 60, price: 79.5, category: 'Huidverzorging', color: '#7B61FF', rebook_interval_days: 42, aftercare_text: 'Vermijd de eerste 24 uur zon, sauna en make-up. Reinig mild en gebruik dagelijks SPF 30 of hoger.' },
  { user_id: uid, is_demo: true, name: 'Microneedling', duration_minutes: 75, price: 145, category: 'Huidverbetering', color: '#C850C0', rebook_interval_days: 28, aftercare_text: 'De eerste 48 uur geen make-up, sporten of sauna. Gebruik alleen de meegegeven milde verzorging en dagelijks SPF 50.' },
  { user_id: uid, is_demo: true, name: 'Laserontharing', duration_minutes: 30, price: 69, category: 'Ontharing', color: '#9B59B6', rebook_interval_days: 42, aftercare_text: 'Koel de huid bij warm gevoel, vermijd 48 uur zon en scrub. Niet epileren tussen sessies door, scheren mag wel.' },
  { user_id: uid, is_demo: true, name: 'Huidanalyse', duration_minutes: 30, price: 39.5, category: 'Intake', color: '#45B7D1', rebook_interval_days: 180 },
  { user_id: uid, is_demo: true, name: 'Peeling', duration_minutes: 45, price: 89, category: 'Huidverbetering', color: '#E91E8C', rebook_interval_days: 35, aftercare_text: 'Huid kan enkele dagen vervellen. Niet krabben of scrubben en dagelijks SPF 50 gebruiken.' },
  { user_id: uid, is_demo: true, name: 'Controle', duration_minutes: 20, price: 0, category: 'Nazorg', color: '#4ECDC4', rebook_interval_days: null },
]).select('id, name, price, duration_minutes'), 'services');
const svc = Object.fromEntries(services.map((s) => [s.name, s]));

// ----------------------------------------------------------------- customers
const customerRows = [
  ['Sanne de Jong', '+31600000101', 620, true],
  ['Nina Vermeer', '+31600000102', 145, false],
  ['Lisa Jansen', '+31600000103', 318, false],
  ['Eva Brouwer', '+31600000104', 483, false],
  ['Marieke Postma', '+31600000105', 238, false],
  ['Fatima el Amrani', '+31600000106', 396, false],
  ['Ilse Kuipers', '+31600000107', 79, false],
  ['Joyce Hoekstra', '+31600000108', 512, true],
  ['Karin Veldman', '+31600000109', 168, false],
  ['Wouter Timmer', '+31600000110', 207, false],
];
const customers = ok(await db.from('customers').insert(customerRows.map(([name, phone, spent, vip]) => ({
  user_id: uid, is_demo: true, name, phone,
  email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@voorbeeld.demo`,
  total_spent: spent, is_vip: vip, whatsapp_opt_in: true, preferred_language: 'nl',
}))).select('id, name'), 'customers');
const cus = Object.fromEntries(customers.map((c) => [c.name, c.id]));

// ------------------------------------------------------------------- helpers
const day = (offset, hhmm) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const [h, m] = hhmm.split(':');
  d.setHours(Number(h), Number(m), 0, 0);
  return d;
};
const iso = (d) => d.toISOString();
const endTime = (hhmm, mins) => {
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + mins;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}:00`;
};
const appt = (offset, hhmm, customer, service, employee, extra = {}) => ({
  user_id: uid, is_demo: true, customer_id: cus[customer], service_id: svc[service].id,
  appointment_date: iso(day(offset, hhmm)), start_time: `${hhmm}:00`,
  end_time: endTime(hhmm, svc[service].duration_minutes), employee_id: emp[employee],
  price: svc[service].price, status: offset < 0 ? 'voltooid' : 'gepland',
  payment_status: offset < 0 ? 'betaald' : 'none', amount_paid: offset < 0 ? svc[service].price : 0,
  confirmation_status: 'pending', source: 'manual', ...extra,
});

// ------------------------------------------------------------------ journeys
const journeys = ok(await db.from('treatment_journeys').insert([
  { user_id: uid, is_demo: true, customer_id: cus['Eva Brouwer'], service_id: svc['Laserontharing'].id, name: 'Laserontharing traject', status: 'actief', planned_sessions: 6, started_on: iso(day(-84, '10:00')).slice(0, 10), notes: 'Sessie 1 en 2 afgerond, sessie 3 gepland, controle nog te plannen.' },
  { user_id: uid, is_demo: true, customer_id: cus['Sanne de Jong'], service_id: svc['Gezichtsbehandeling'].id, name: 'Huidverbetering traject', status: 'actief', planned_sessions: 4, started_on: iso(day(-42, '10:00')).slice(0, 10), notes: 'Gezichtsbehandeling elke 6 weken.' },
]).select('id, name'), 'journeys');
const jrn = Object.fromEntries(journeys.map((j) => [j.name, j.id]));

// -------------------------------------------------------------- appointments
const appointments = ok(await db.from('appointments').insert([
  // history
  appt(-42, '10:00', 'Sanne de Jong', 'Gezichtsbehandeling', 'Danica', { journey_id: jrn['Huidverbetering traject'], journey_session_number: 1, confirmation_status: 'confirmed' }),
  appt(-84, '11:00', 'Eva Brouwer', 'Laserontharing', 'Sophie', { journey_id: jrn['Laserontharing traject'], journey_session_number: 1, confirmation_status: 'confirmed' }),
  appt(-42, '11:00', 'Eva Brouwer', 'Laserontharing', 'Sophie', { journey_id: jrn['Laserontharing traject'], journey_session_number: 2, confirmation_status: 'confirmed' }),
  appt(-21, '13:30', 'Joyce Hoekstra', 'Peeling', 'Danica', { confirmation_status: 'confirmed' }),
  appt(-7, '09:30', 'Fatima el Amrani', 'Gezichtsbehandeling', 'Sophie', { confirmation_status: 'confirmed' }),
  // today
  appt(0, '09:00', 'Marieke Postma', 'Huidanalyse', 'Danica', { status: 'voltooid', payment_status: 'betaald', amount_paid: svc['Huidanalyse'].price, confirmation_status: 'confirmed' }),
  appt(0, '10:00', 'Sanne de Jong', 'Gezichtsbehandeling', 'Danica', { journey_id: jrn['Huidverbetering traject'], journey_session_number: 2, confirmation_status: 'confirmed' }),
  appt(0, '11:30', 'Nina Vermeer', 'Microneedling', 'Danica'),
  appt(0, '09:30', 'Lisa Jansen', 'Peeling', 'Sophie', { confirmation_status: 'confirmed' }),
  appt(0, '11:00', 'Eva Brouwer', 'Laserontharing', 'Sophie', { journey_id: jrn['Laserontharing traject'], journey_session_number: 3 }),
  appt(0, '14:00', 'Ilse Kuipers', 'Huidanalyse', 'Sophie'),
  appt(0, '15:00', 'Joyce Hoekstra', 'Gezichtsbehandeling', 'Danica', { confirmation_status: 'confirmed' }),
  // coming days
  appt(1, '09:30', 'Karin Veldman', 'Gezichtsbehandeling', 'Danica'),
  appt(1, '11:00', 'Wouter Timmer', 'Laserontharing', 'Sophie'),
  appt(1, '13:00', 'Fatima el Amrani', 'Peeling', 'Danica'),
  appt(2, '10:00', 'Marieke Postma', 'Microneedling', 'Danica'),
  appt(2, '11:30', 'Joyce Hoekstra', 'Controle', 'Sophie'),
  appt(3, '09:00', 'Ilse Kuipers', 'Gezichtsbehandeling', 'Sophie'),
  appt(3, '14:00', 'Lisa Jansen', 'Controle', 'Danica'),
  appt(4, '10:30', 'Karin Veldman', 'Laserontharing', 'Sophie'),
]).select('id, customer_id, service_id, appointment_date, status, journey_session_number'), 'appointments');

const byDate = (name, offset) => appointments.find((a) => a.customer_id === cus[name] && a.appointment_date.startsWith(iso(day(offset, '12:00')).slice(0, 10)));
const sannePast = byDate('Sanne de Jong', -42);
const sanneToday = byDate('Sanne de Jong', 0);
const ninaToday = byDate('Nina Vermeer', 0);
const evaS1 = byDate('Eva Brouwer', -84);
const evaS2 = byDate('Eva Brouwer', -42);
const lisaToday = byDate('Lisa Jansen', 0);

// ---------------------------------------------------------------- form setup
async function makeTemplate({ title, kind, requireSignature, schema, consentScope = null, versions = 1 }) {
  const tpl = ok(await db.from('form_templates').insert({
    user_id: uid, is_demo: true, title, kind, require_signature: requireSignature,
    is_active: true, current_version: versions, draft_schema: schema, consent_scope: consentScope,
  }).select('id').single(), `tpl ${title}`);
  const rows = [];
  for (let v = 1; v <= versions; v++) {
    rows.push({
      user_id: uid, is_demo: true, template_id: tpl.id, version: v, title, kind,
      require_signature: requireSignature,
      schema: v === versions ? schema : { ...schema, fields: schema.fields.slice(0, Math.max(2, schema.fields.length - 1)) },
      published_at: iso(day(-60 + v * 10, '10:00')),
    });
  }
  const vers = ok(await db.from('form_template_versions').insert(rows).select('id, version'), `ver ${title}`);
  return { id: tpl.id, latest: vers.find((x) => x.version === versions), title, kind, requireSignature, schema };
}

const intake = await makeTemplate({
  title: 'Algemene intake', kind: 'intake', requireSignature: false, versions: 2,
  schema: {
    intro: 'Vul dit formulier in voor je eerste behandeling. Geef wijzigingen door voor een volgende afspraak.',
    fields: [
      { key: 'volledige_naam', label: 'Volledige naam', type: 'text', required: true },
      { key: 'geboortedatum', label: 'Geboortedatum', type: 'date', required: true },
      { key: 'huidtype', label: 'Hoe omschrijf je je huid?', type: 'radio', options: ['Droog', 'Normaal', 'Vet', 'Gecombineerd'], required: true },
      { key: 'allergieen', label: 'Heb je allergieen?', type: 'radio', options: ['Ja', 'Nee'], required: true, alert_when: 'Ja', alert_label: 'Klant geeft allergie aan' },
      { key: 'toelichting', label: 'Waar moeten wij rekening mee houden?', type: 'textarea', required: false },
    ],
  },
});
const consentFacial = await makeTemplate({
  title: 'Toestemming Gezichtsbehandeling', kind: 'consent', requireSignature: true,
  schema: {
    intro: 'Ik ga akkoord met het uitvoeren van de gezichtsbehandeling en heb de nazorginstructies ontvangen.',
    fields: [
      { key: 'volledige_naam', label: 'Volledige naam', type: 'text', required: true },
      { key: 'nazorg_ontvangen', label: 'Ik heb de nazorginstructies ontvangen', type: 'checkbox', required: true },
      { key: 'akkoord', label: 'Ik ga akkoord met de behandeling', type: 'checkbox', required: true },
    ],
  },
});
const intakeNeedling = await makeTemplate({
  title: 'Intake Microneedling', kind: 'intake', requireSignature: true,
  schema: {
    intro: 'Vul dit formulier in voor je microneedling behandeling.',
    fields: [
      { key: 'volledige_naam', label: 'Volledige naam', type: 'text', required: true },
      { key: 'retinol', label: 'Gebruik je producten met retinol?', type: 'radio', options: ['Ja', 'Nee'], required: true, alert_when: 'Ja', alert_label: 'Klant meldt gebruik van retinol' },
      { key: 'zonvakantie', label: 'Ben je de afgelopen twee weken in de zon geweest?', type: 'radio', options: ['Ja', 'Nee'], required: true },
      { key: 'akkoord', label: 'Ik ga akkoord met de behandeling', type: 'checkbox', required: true },
    ],
  },
});
const marketingPhoto = await makeTemplate({
  title: 'Marketingfoto toestemming', kind: 'consent', requireSignature: true, consentScope: 'marketing_general',
  schema: {
    intro: 'Toestemming voor het gebruik van behandelfotos voor marketingdoeleinden. Je kunt dit altijd intrekken.',
    fields: [
      { key: 'volledige_naam', label: 'Volledige naam', type: 'text', required: true },
      { key: 'akkoord_marketing', label: 'Ik geef toestemming voor gebruik van mijn fotos in marketing', type: 'checkbox', required: true },
    ],
  },
});
const aftercareForm = await makeTemplate({
  title: 'Nazorgvragenlijst', kind: 'questionnaire', requireSignature: false,
  schema: {
    intro: 'Hoe gaat het na je behandeling? Laat het ons weten.',
    fields: [
      { key: 'klachten', label: 'Heb je klachten na de behandeling?', type: 'radio', options: ['Ja', 'Nee'], required: true, alert_when: 'Ja', alert_label: 'Klant meldt klachten na behandeling' },
      { key: 'toelichting', label: 'Toelichting', type: 'textarea', required: false },
      { key: 'tevredenheid', label: 'Hoe tevreden ben je? (1 tot 10)', type: 'number', required: false },
    ],
  },
});

ok(await db.from('service_form_requirements').insert([
  { user_id: uid, is_demo: true, service_id: svc['Gezichtsbehandeling'].id, template_id: intake.id, validity_mode: 'months', validity_months: 12, reissue_on_new_version: true, auto_send: true, reminder_hours: 24 },
  { user_id: uid, is_demo: true, service_id: svc['Gezichtsbehandeling'].id, template_id: consentFacial.id, validity_mode: 'months', validity_months: 12, reissue_on_new_version: true, auto_send: true, reminder_hours: 24 },
  { user_id: uid, is_demo: true, service_id: svc['Microneedling'].id, template_id: intakeNeedling.id, validity_mode: 'months', validity_months: 6, reissue_on_new_version: true, auto_send: true, reminder_hours: 24 },
  { user_id: uid, is_demo: true, service_id: svc['Peeling'].id, template_id: intake.id, validity_mode: 'months', validity_months: 12, reissue_on_new_version: true, auto_send: false, reminder_hours: 24 },
]), 'service_form_requirements');

async function completeForm({ tpl, customer, appointment, answers, signerName, whenOffset }) {
  const token = randomBytes(32).toString('hex');
  const req = ok(await db.from('form_requests').insert({
    user_id: uid, is_demo: true, customer_id: cus[customer], appointment_id: appointment ?? null,
    template_id: tpl.id, template_version_id: tpl.latest.id, token_hash: sha(token),
    status: 'completed', channel: 'whatsapp', expires_at: iso(day(whenOffset + 14, '10:00')),
    sent_at: iso(day(whenOffset, '09:00')), opened_at: iso(day(whenOffset, '09:05')),
    completed_at: iso(day(whenOffset, '09:10')),
  }).select('id').single(), 'form_request');

  const ordered = tpl.schema.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, value: answers[f.key] ?? (f.type === 'checkbox' ? false : null) }));
  const snapshot = {
    schema_version: 2, template_id: tpl.id, template_version_id: tpl.latest.id, version: tpl.latest.version,
    title: tpl.title, kind: tpl.kind, require_signature: tpl.requireSignature,
    signer_name: tpl.requireSignature ? signerName : null,
    fields: ordered,
    explicit_consent: Boolean(tpl.requireSignature),
    signature_method: tpl.requireSignature ? 'typed' : null,
  };
  const sub = ok(await db.from('form_submissions').insert({
    user_id: uid, is_demo: true, request_id: req.id, customer_id: cus[customer], appointment_id: appointment ?? null,
    template_id: tpl.id, template_version_id: tpl.latest.id,
    answers: Object.fromEntries(ordered.map((o) => [o.key, o.value])),
    rendered_snapshot: snapshot,
    document_hash: createHash('sha256').update(canonicalJson(snapshot)).digest('hex'),
    signer_name: tpl.requireSignature ? signerName : null,
    signed_at: tpl.requireSignature ? iso(day(whenOffset, '09:10')) : null,
    audit_metadata: { fingerprint: 'demo', submitted_via: 'public_link', explicit_consent: tpl.requireSignature, signature_method: tpl.requireSignature ? 'typed' : null },
    submitted_at: iso(day(whenOffset, '09:10')),
  }).select('id').single(), 'form_submission');

  for (const f of tpl.schema.fields) {
    if (f.alert_when && String(answers[f.key]) === f.alert_when) {
      await db.from('customer_alerts').insert({
        user_id: uid, is_demo: true, customer_id: cus[customer], source_type: 'form_answer',
        source_id: req.id, label: f.alert_label ?? f.label, review_status: 'unreviewed',
      });
    }
  }
  return { requestId: req.id, submissionId: sub.id };
}

// Showcase: Sanne de Jong
await completeForm({ tpl: intake, customer: 'Sanne de Jong', appointment: sannePast.id, whenOffset: -44, answers: { volledige_naam: 'Sanne de Jong', geboortedatum: '1991-04-18', huidtype: 'Gecombineerd', allergieen: 'Nee', toelichting: 'Huid reageert snel op geparfumeerde producten.' } });
await completeForm({ tpl: consentFacial, customer: 'Sanne de Jong', appointment: sannePast.id, whenOffset: -44, signerName: 'Sanne de Jong', answers: { volledige_naam: 'Sanne de Jong', nazorg_ontvangen: true, akkoord: true } });
const sanneMarketing = await completeForm({ tpl: marketingPhoto, customer: 'Sanne de Jong', appointment: sannePast.id, whenOffset: -43, signerName: 'Sanne de Jong', answers: { volledige_naam: 'Sanne de Jong', akkoord_marketing: true } });
ok(await db.from('customer_consents').insert({
  user_id: uid, is_demo: true, customer_id: cus['Sanne de Jong'], consent_type: 'marketing_media',
  scope: 'marketing_general', event: 'granted', source: 'form', source_reference: sanneMarketing.requestId,
  version: 1, proof_reference: sanneMarketing.submissionId, occurred_at: iso(day(-43, '09:10')),
}), 'consent sanne');
await completeForm({ tpl: aftercareForm, customer: 'Sanne de Jong', appointment: sannePast.id, whenOffset: -40, answers: { klachten: 'Nee', toelichting: 'Huid voelt rustig aan.', tevredenheid: 9 } });

// Eva: journey forms
await completeForm({ tpl: intake, customer: 'Eva Brouwer', appointment: evaS1.id, whenOffset: -86, answers: { volledige_naam: 'Eva Brouwer', geboortedatum: '1988-09-02', huidtype: 'Normaal', allergieen: 'Nee' } });

// Nina Vermeer: consent present, intake missing (open request)
await completeForm({ tpl: consentFacial, customer: 'Nina Vermeer', appointment: ninaToday.id, whenOffset: -3, signerName: 'Nina Vermeer', answers: { volledige_naam: 'Nina Vermeer', nazorg_ontvangen: true, akkoord: true } });
const ninaToken = randomBytes(32).toString('hex');
ok(await db.from('form_requests').insert({
  user_id: uid, is_demo: true, customer_id: cus['Nina Vermeer'], appointment_id: ninaToday.id,
  template_id: intakeNeedling.id, template_version_id: intakeNeedling.latest.id, token_hash: sha(ninaToken),
  status: 'draft', channel: 'whatsapp', expires_at: iso(day(7, '10:00')),
}), 'nina open request');

// Lisa Jansen: administrative attention point
ok(await db.from('customer_alerts').insert({
  user_id: uid, is_demo: true, customer_id: cus['Lisa Jansen'], source_type: 'manual',
  label: 'Klant wil graag extra tijd bij inplannen en vraagt om milde producten', review_status: 'unreviewed',
}), 'lisa alert');

// --------------------------------------------------- treatment record setup
const trTemplates = ok(await db.from('treatment_record_templates').insert([
  { user_id: uid, is_demo: true, title: 'Verslag Gezichtsbehandeling', service_id: svc['Gezichtsbehandeling'].id, version: 1, is_active: true, schema: { fields: [
    { key: 'uitgevoerd', label: 'Uitgevoerde stappen', type: 'textarea', required: true },
    { key: 'producten', label: 'Gebruikte producten', type: 'text', required: false },
    { key: 'huidreactie', label: 'Reactie van de huid', type: 'radio', options: ['Rustig', 'Licht rood', 'Sterk rood'], required: true },
    { key: 'nazorg', label: 'Meegegeven nazorg', type: 'textarea', required: false },
  ] } },
  { user_id: uid, is_demo: true, title: 'Verslag Microneedling', service_id: svc['Microneedling'].id, version: 1, is_active: true, schema: { fields: [
    { key: 'naaldlengte', label: 'Ingestelde naaldlengte (mm)', type: 'number', required: true },
    { key: 'zones', label: 'Behandelde zones', type: 'text', required: true },
    { key: 'huidreactie', label: 'Reactie van de huid', type: 'radio', options: ['Rustig', 'Licht rood', 'Sterk rood'], required: true },
    { key: 'nazorg', label: 'Meegegeven nazorg', type: 'textarea', required: false },
  ] } },
  { user_id: uid, is_demo: true, title: 'Verslag Laserontharing', service_id: svc['Laserontharing'].id, version: 1, is_active: true, schema: { fields: [
    { key: 'zone', label: 'Behandelde zone', type: 'text', required: true },
    { key: 'energie', label: 'Energie-instelling (J/cm2)', type: 'number', required: true },
    { key: 'sessie', label: 'Sessienummer', type: 'number', required: true },
    { key: 'huidreactie', label: 'Reactie van de huid', type: 'radio', options: ['Rustig', 'Licht rood', 'Sterk rood'], required: true },
  ] } },
]).select('id, title, schema, version'), 'treatment templates');
const trt = Object.fromEntries(trTemplates.map((t) => [t.title, t]));

async function addRecord({ tplTitle, customer, appointmentId, values, whenOffset, employee = 'Danica' }) {
  const t = trt[tplTitle];
  return ok(await db.from('treatment_records').insert({
    user_id: uid, is_demo: true, customer_id: cus[customer], appointment_id: appointmentId,
    employee_id: emp[employee], service_id: null, template_id: t.id, template_version: t.version,
    template_snapshot: t.schema, values, status: 'completed',
    completed_at: iso(day(whenOffset, '11:00')), locked_at: iso(day(whenOffset, '11:00')),
  }).select('id').single(), `record ${tplTitle}`);
}

const sanneRecord = await addRecord({ tplTitle: 'Verslag Gezichtsbehandeling', customer: 'Sanne de Jong', appointmentId: sannePast.id, whenOffset: -42, values: { uitgevoerd: 'Reiniging, peeling, extractie en kalmerend masker.', producten: 'Milde enzympeeling en kalmerend masker', huidreactie: 'Licht rood', nazorg: '24 uur geen make-up, dagelijks SPF 30.' } });
const evaRecord1 = await addRecord({ tplTitle: 'Verslag Laserontharing', customer: 'Eva Brouwer', appointmentId: evaS1.id, whenOffset: -84, employee: 'Sophie', values: { zone: 'Onderbenen', energie: 12, sessie: 1, huidreactie: 'Licht rood' } });
const evaRecord2 = await addRecord({ tplTitle: 'Verslag Laserontharing', customer: 'Eva Brouwer', appointmentId: evaS2.id, whenOffset: -42, employee: 'Sophie', values: { zone: 'Onderbenen', energie: 13, sessie: 2, huidreactie: 'Rustig' } });
await addRecord({ tplTitle: 'Verslag Gezichtsbehandeling', customer: 'Joyce Hoekstra', appointmentId: byDate('Joyce Hoekstra', -21).id, whenOffset: -21, values: { uitgevoerd: 'Peeling en hydraterend masker.', producten: 'AHA peeling 10%', huidreactie: 'Licht rood', nazorg: 'Geen scrub gedurende 5 dagen.' } });

// -------------------------------------------------------- photo placeholders
const placeholder = readFileSync('/mnt/documents/demo-photo-placeholder.jpg');
async function addPhoto({ customer, appointmentId, recordId, category, caption }) {
  const path = `${uid}/${cus[customer]}/${appointmentId}/${crypto.randomUUID()}.jpg`;
  const up = await db.storage.from('clinical-files').upload(path, placeholder, { contentType: 'image/jpeg', upsert: true });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  ok(await db.from('clinical_media').insert({
    user_id: uid, is_demo: true, customer_id: cus[customer], appointment_id: appointmentId,
    treatment_record_id: recordId ?? null, category, storage_path: path, caption,
    mime_type: 'image/jpeg', size_bytes: placeholder.length,
  }), 'clinical_media');
}
await addPhoto({ customer: 'Sanne de Jong', appointmentId: sannePast.id, recordId: sanneRecord.id, category: 'before', caption: 'Voorfoto (demo placeholder)' });
await addPhoto({ customer: 'Sanne de Jong', appointmentId: sannePast.id, recordId: sanneRecord.id, category: 'after', caption: 'Nafoto (demo placeholder)' });
await addPhoto({ customer: 'Eva Brouwer', appointmentId: evaS1.id, recordId: evaRecord1.id, category: 'before', caption: 'Sessie 1 voorfoto (demo placeholder)' });
await addPhoto({ customer: 'Eva Brouwer', appointmentId: evaS2.id, recordId: evaRecord2.id, category: 'control', caption: 'Sessie 2 controlefoto (demo placeholder)' });

// -------------------------------------------------------------- demo payments
const paidAppointments = appointments.filter((a) => a.status === 'voltooid');
ok(await db.from('payments').insert(paidAppointments.map((a, i) => ({
  user_id: uid, is_demo: true, customer_id: a.customer_id, appointment_id: a.id,
  amount: services.find((s) => s.id === a.service_id)?.price ?? 0, currency: 'EUR',
  payment_type: 'full', status: 'paid', method: ['ideal', 'pin', 'creditcard'][i % 3],
  payment_method: ['ideal', 'pin', 'creditcard'][i % 3], provider: 'glowpay',
  paid_at: a.appointment_date,
}))), 'payments');

console.log(JSON.stringify({
  tenant: uid, email: EMAIL, password,
  employees: employees.length, services: services.length, customers: customers.length,
  appointments: appointments.length, journeys: journeys.length,
}, null, 2));
