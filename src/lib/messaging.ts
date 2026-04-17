import { supabase } from "@/integrations/supabase/client";

export type Channel = "whatsapp" | "sms";
export type MessageType = "lead_reminder" | "lead_booklink" | "lead_incentive" | "empty_slot" | "rebook" | "payment" | "custom";

export interface MessageSettings {
  whatsappEnabled: boolean;
  smsEnabled: boolean;
  preferredChannel: Channel;
  maxPerDay: number;
  incentiveEnabled: boolean;
  abandonedFollowupEnabled: boolean;
}

export interface MessageTemplate {
  id: MessageType;
  label: string;
  channel: Channel;
  body: string;
}

const SETTINGS_KEY = "glowsuite_message_settings";
const TEMPLATES_KEY = "glowsuite_message_templates";
const SENT_TODAY_KEY = "glowsuite_messages_sent_today";

export const DEFAULT_SETTINGS: MessageSettings = {
  whatsappEnabled: true,
  smsEnabled: true,
  preferredChannel: "whatsapp",
  maxPerDay: 100,
  incentiveEnabled: true,
  abandonedFollowupEnabled: true,
};

export const DEFAULT_TEMPLATES: MessageTemplate[] = [
  { id: "lead_reminder", label: "Lead herinnering (1u)", channel: "whatsapp",
    body: "Hi {{naam}}, je was bezig met het boeken van {{dienst}}. Wil je je afspraak afronden? Boek hier eenvoudig verder: {{boeklink}}" },
  { id: "lead_booklink", label: "Lead boeklink (24u)", channel: "sms",
    body: "Hi {{naam}}, gisteren ben je gestart met een boeking. Hier is je directe boeklink: {{boeklink}}" },
  { id: "lead_incentive", label: "Lead incentive (3d)", channel: "whatsapp",
    body: "Speciaal voor jou {{naam}}: boek vandaag nog en ontvang 10% korting op je volgende behandeling. {{boeklink}}" },
  { id: "empty_slot", label: "Lege plek vullen", channel: "whatsapp",
    body: "Hi {{naam}}, we hebben morgen nog plek vrij voor {{dienst}}. Wil je deze plek claimen? {{boeklink}}" },
  { id: "rebook", label: "Herboeking", channel: "whatsapp",
    body: "Hi {{naam}}, het is alweer even geleden sinds je laatste afspraak. Wil je direct een nieuw moment plannen? {{boeklink}}" },
  { id: "payment", label: "Betaalherinnering", channel: "sms",
    body: "Hi {{naam}}, je betaling voor je afspraak staat nog open. Betaal eenvoudig via deze link: {{betaallink}}" },
];

export function getMessageSettings(): MessageSettings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; }
  catch { return DEFAULT_SETTINGS; }
}
export function saveMessageSettings(s: MessageSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
export function getTemplates(): MessageTemplate[] {
  try {
    const stored = JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "[]");
    if (Array.isArray(stored) && stored.length > 0) {
      return DEFAULT_TEMPLATES.map(d => stored.find((t: any) => t.id === d.id) || d);
    }
  } catch {/* */}
  return DEFAULT_TEMPLATES;
}
export function saveTemplates(t: MessageTemplate[]) {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(t));
}

function todayKey() { return new Date().toISOString().split("T")[0]; }
function sentToday(): number {
  try {
    const obj = JSON.parse(localStorage.getItem(SENT_TODAY_KEY) || "{}");
    return obj.date === todayKey() ? Number(obj.count || 0) : 0;
  } catch { return 0; }
}
function bumpSentToday() {
  const c = sentToday() + 1;
  localStorage.setItem(SENT_TODAY_KEY, JSON.stringify({ date: todayKey(), count: c }));
}

export function pickChannel(contact: { phone?: string | null; email?: string | null }): Channel | null {
  const s = getMessageSettings();
  const hasPhone = !!(contact.phone && contact.phone.trim());
  if (!hasPhone) return null; // both wa/sms need phone
  if (s.preferredChannel === "whatsapp" && s.whatsappEnabled) return "whatsapp";
  if (s.preferredChannel === "sms" && s.smsEnabled) return "sms";
  if (s.whatsappEnabled) return "whatsapp";
  if (s.smsEnabled) return "sms";
  return null;
}

export function renderTemplate(body: string, vars: Record<string, string>) {
  return body.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

/**
 * Simulated send — logs message as a row in `campaigns` table so it shows up in
 * the existing message log UI. Returns true if sent.
 */
export async function sendMessage(opts: {
  userId: string;
  channel?: Channel;
  type: MessageType;
  recipient: { name?: string; phone?: string | null; email?: string | null };
  vars?: Record<string, string>;
  leadId?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const settings = getMessageSettings();
  if (sentToday() >= settings.maxPerDay) return { ok: false, reason: "daily_limit" };

  const channel = opts.channel || pickChannel(opts.recipient);
  if (!channel) return { ok: false, reason: "no_channel" };
  if (channel === "whatsapp" && !settings.whatsappEnabled) return { ok: false, reason: "whatsapp_off" };
  if (channel === "sms" && !settings.smsEnabled) return { ok: false, reason: "sms_off" };

  const tpl = getTemplates().find(t => t.id === opts.type) || DEFAULT_TEMPLATES[0];
  const body = renderTemplate(tpl.body, {
    naam: opts.recipient.name || "klant",
    boeklink: `${window.location.origin}/boeken`,
    betaallink: `${window.location.origin}/betalen`,
    dienst: opts.vars?.dienst || "een behandeling",
    ...(opts.vars || {}),
  });

  const recipient = opts.recipient.phone || opts.recipient.email || opts.recipient.name || "onbekend";
  const title = `[${channel.toUpperCase()}] ${tpl.label}`;
  // Simulate delivery progression
  const status = "afgeleverd";

  await supabase.from("campaigns").insert({
    user_id: opts.userId,
    title,
    type: channel,
    audience: recipient,
    message: body,
    status,
    sent_count: 1,
  });

  bumpSentToday();
  return { ok: true };
}

export const MESSAGE_AUDIT_KEYS: Record<MessageType, string> = {
  lead_reminder: "[AUTO-1H]",
  lead_booklink: "[AUTO-24H]",
  lead_incentive: "[AUTO-3D]",
  empty_slot: "[AUTO-SLOT]",
  rebook: "[AUTO-REBOOK]",
  payment: "[AUTO-PAY]",
  custom: "[AUTO-CUSTOM]",
};
