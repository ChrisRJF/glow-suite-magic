// INACTIVE: send-white-label-email templates with server-validated links only.
// Ported 1:1 from the active renderer (layout, copy, colors); only the link logic changed:
// every button comes from templateActions(buildSafeEmailLinks(...)). No subdomains, no .ics,
// no generic route/terms/receipt pages, no caller-supplied URLs. Missing link = no button.
import { emailStrings, formatCurrency, formatDateLong, formatDateShort, type EmailLang } from "../emailTranslations.ts";
import { templateActions, allowedLinksIn, type SafeEmailLinks, type TemplateKey } from "./customerEmailRender.ts";

export type TemplateResult = { subject: string; preview: string; html: string; text: string; links: string[] };
type Action = { label: string; url?: string };

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
export function validEmail(value: unknown): string | undefined {
  const email = String(value || "").trim().toLowerCase();
  return email.length <= 255 && EMAIL.test(email) ? email : undefined;
}

function hexColor(value: unknown, fallback: string) {
  const color = String(value || "").trim();
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : fallback;
}

function shell(args: { salonName: string; title: string; intro: string; body: string; primaryAction?: Action; secondaryAction?: Action; logoUrl?: string; accent?: string; secondary?: string; lang: EmailLang; footerText: string }) {
  const accent = hexColor(args.accent, "#7B61FF");
  const secondary = hexColor(args.secondary, "#C850C0");
  const logo = args.logoUrl ? `<img src="${escapeHtml(args.logoUrl)}" width="56" height="56" alt="${escapeHtml(args.salonName)}" style="border-radius:16px;display:block;margin:0 auto 18px;object-fit:cover;border:1px solid #F1EEF7;" />` : `<div style="width:56px;height:56px;border-radius:16px;margin:0 auto 18px;background:${accent};color:#ffffff;text-align:center;line-height:56px;font-size:20px;font-weight:800;">${escapeHtml(args.salonName.slice(0, 1).toUpperCase())}</div>`;
  const primaryCta = args.primaryAction?.url ? `<a href="${escapeHtml(args.primaryAction.url)}" style="display:block;background:${accent};color:#ffffff;text-decoration:none;border-radius:14px;padding:15px 18px;font-size:15px;font-weight:800;text-align:center;margin:18px 0 10px;">${escapeHtml(args.primaryAction.label)}</a>` : "";
  const secondaryCta = args.secondaryAction?.url ? `<a href="${escapeHtml(args.secondaryAction.url)}" style="display:block;background:#ffffff;color:${secondary};text-decoration:none;border:1px solid #E9DFF7;border-radius:14px;padding:13px 18px;font-size:14px;font-weight:750;text-align:center;margin:0 0 8px;">${escapeHtml(args.secondaryAction.label)}</a>` : "";
  return `<!doctype html><html lang="${args.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(args.title)}</title></head><body style="margin:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111827;-webkit-font-smoothing:antialiased;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(args.intro)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;"><tr><td align="center" style="padding:22px 12px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:584px;border:1px solid #EEE7F8;border-radius:24px;overflow:hidden;background:#ffffff;"><tr><td style="padding:30px 24px 18px;text-align:center;background:linear-gradient(180deg,#FFFFFF 0%,#FCFAFF 100%);">${logo}<p style="margin:0 0 9px;color:${accent};font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;">${escapeHtml(args.salonName)}</p><h1 style="margin:0;color:#111827;font-size:26px;line-height:1.16;font-weight:800;letter-spacing:0;">${escapeHtml(args.title)}</h1><p style="margin:14px auto 0;color:#5F6673;font-size:16px;line-height:1.62;max-width:480px;">${escapeHtml(args.intro)}</p></td></tr><tr><td style="padding:8px 24px 30px;">${args.body}${primaryCta}${secondaryCta}<hr style="border:none;border-top:1px solid #F1EEF7;margin:26px 0 16px;" /><p style="margin:0;color:#8A8F98;font-size:12px;line-height:1.55;text-align:center;">${escapeHtml(args.footerText)}</p></td></tr></table></td></tr></table></body></html>`;
}

function infoRows(rows: Array<[string, unknown]>) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #F1EEF7;border-radius:18px;overflow:hidden;margin:16px 0 18px;background:#ffffff;">${rows.filter(([, value]) => value !== undefined && value !== null && String(value) !== "").map(([label, value]) => `<tr><td style="padding:13px 15px;border-bottom:1px solid #F7F3FB;color:#6B7280;font-size:13px;line-height:1.35;">${escapeHtml(label)}</td><td align="right" style="padding:13px 15px;border-bottom:1px solid #F7F3FB;color:#111827;font-size:14px;line-height:1.35;font-weight:750;">${escapeHtml(value)}</td></tr>`).join("")}</table>`;
}

function noteBlock(title: string, items: unknown[]) {
  const lines = items.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (!lines.length) return "";
  return `<div style="background:#FCFAFF;border:1px solid #F1EEF7;border-radius:18px;padding:16px 16px;margin:16px 0;"><p style="margin:0 0 10px;color:#111827;font-size:14px;font-weight:800;">${escapeHtml(title)}</p>${lines.map((item) => `<p style="margin:7px 0;color:#5F6673;font-size:14px;line-height:1.55;">• ${escapeHtml(item)}</p>`).join("")}</div>`;
}

function amountSummary(args: { amount?: unknown; vatAmount?: unknown; vatRate?: unknown; total?: unknown; totalLabel: string; vatLine?: string }) {
  return `<div style="background:#111827;border-radius:20px;padding:18px;margin:16px 0;color:#ffffff;"><p style="margin:0 0 8px;color:#D1D5DB;font-size:13px;font-weight:700;">${escapeHtml(args.totalLabel)}</p><p style="margin:0;color:#ffffff;font-size:30px;line-height:1;font-weight:850;">${escapeHtml(args.total as string)}</p>${args.vatLine ? `<p style="margin:12px 0 0;color:#D1D5DB;font-size:13px;">${escapeHtml(args.vatLine)}</p>` : ""}</div>`;
}


// Auto Rebook e-mail (kanaalfallback wanneer WhatsApp niet kan). Compacte,
// zelfstandige copy zodat we de gedeelde vertalingen niet hoeven te wijzigen.
const AUTO_REBOOK_STRINGS: Record<string, { subject: (s: string) => string; title: string; intro: (n: string, s: string) => string; body: string; cta: string }> = {
  nl: {
    subject: (s) => `Tijd voor je volgende afspraak bij ${s}`,
    title: "Klaar voor je volgende afspraak?",
    intro: (n, s) => `${n ? n + ", h" : "H"}et is alweer even geleden. Bij ${s} staat een moment voor je klaar.`,
    body: "Kies zelf een dag en tijd die je uitkomt. Je hoeft niets opnieuw in te vullen.",
    cta: "Afspraak inplannen",
  },
  en: {
    subject: (s) => `Time for your next appointment at ${s}`,
    title: "Ready for your next appointment?",
    intro: (n, s) => `${n ? n + ", i" : "I"}t has been a while. ${s} has a spot ready for you.`,
    body: "Pick a day and time that suits you. No need to fill in anything again.",
    cta: "Book appointment",
  },
  de: {
    subject: (s) => `Zeit für deinen nächsten Termin bei ${s}`,
    title: "Bereit für deinen nächsten Termin?",
    intro: (n, s) => `${n ? n + ", e" : "E"}s ist schon eine Weile her. Bei ${s} wartet ein Termin auf dich.`,
    body: "Wähle einfach einen passenden Tag und eine Uhrzeit.",
    cta: "Termin buchen",
  },
  fr: {
    subject: (s) => `Il est temps de reprendre rendez-vous chez ${s}`,
    title: "Prêt pour votre prochain rendez-vous ?",
    intro: (n, s) => `${n ? n + ", c" : "C"}ela fait un moment. ${s} vous réserve un créneau.`,
    body: "Choisissez le jour et l'heure qui vous conviennent.",
    cta: "Prendre rendez-vous",
  },
  es: {
    subject: (s) => `Es hora de tu próxima cita en ${s}`,
    title: "¿Listo para tu próxima cita?",
    intro: (n, s) => `${n ? n + ", h" : "H"}ace tiempo que no nos vemos. ${s} tiene un hueco para ti.`,
    body: "Elige el día y la hora que mejor te venga.",
    cta: "Reservar cita",
  },
};

const btn = (accent: string, url: string, label: string) => `<a href="${escapeHtml(url)}" style="display:block;background:${accent};color:#ffffff;text-decoration:none;border-radius:14px;padding:15px 18px;font-size:15px;font-weight:800;text-align:center;margin:0 0 10px;">${escapeHtml(label)}</a>`;

export function renderTemplate(key: TemplateKey, data: Record<string, unknown>, salonName: string, branding: any, lang: EmailLang, links: SafeEmailLinks): TemplateResult {
  const s = emailStrings(lang);
  const sh = s.shared;
  const firstName = String(data.customer_name || data.recipient_name || "").trim().split(/\s+/)[0] || "";
  const accent = hexColor(branding?.primary_color, "#7B61FF");
  const secondary = hexColor(branding?.secondary_color, "#C850C0");
  const base = { salonName, logoUrl: branding?.logo_url || "", accent, secondary, lang, footerText: sh.footer(salonName) };
  const acts = templateActions(key, links);
  const allowed = allowedLinksIn(acts);
  const act = (label: string, slot: "primary" | "secondary"): Action | undefined => acts[slot] ? { label, url: acts[slot]!.url } : undefined;
  const supportEmail = validEmail(data.support_email) || validEmail(data.salon_contact_email) || validEmail(branding?.contact_email) || "";
  const out = (subject: string, preview: string, html: string, text: string): TemplateResult => ({ subject, preview, html, text, links: allowed });

  if (key === "booking_confirmation") {
    const t = s.booking_confirmation;
    const dateShort = formatDateShort(data.appointment_date || data.date, lang);
    const intro = firstName ? t.intro_named(firstName, salonName) : t.intro(salonName);
    const rows = infoRows([
      [sh.row_customer, data.customer_name || data.recipient_name],
      [sh.row_date, formatDateLong(data.appointment_date || data.date, lang)],
      [sh.row_time, data.time || data.start_time],
      [sh.row_service, data.service_name],
      [sh.row_staff, data.employee || data.staff_name],
      [sh.row_location, data.location || data.address],
      [sh.row_reference, data.reference],
      [sh.row_total, data.total_amount ? formatCurrency(data.total_amount, lang) : undefined],
    ]);
    const body = rows + noteBlock(t.note_title, [t.note_1, t.note_2]);
    const manage = act(t.cta_manage, "primary");
    return out(dateShort ? t.subject(salonName, dateShort) : t.subject_no_date(salonName), intro,
      shell({ ...base, title: t.title, intro, body, primaryAction: manage }),
      `${t.title}\n${intro}\n${String(data.service_name || "")}\n${formatDateLong(data.appointment_date || data.date, lang)} ${String(data.time || data.start_time || "")}${manage?.url ? `\n${t.cta_manage}: ${manage.url}` : ""}`);
  }

  if (key === "payment_receipt") {
    const t = s.payment_receipt;
    const intro = t.intro(salonName);
    const totalStr = formatCurrency(data.total_amount || data.amount, lang);
    const vatStr = data.vat_amount ? formatCurrency(data.vat_amount, lang) : "";
    const vatLine = vatStr ? (data.vat_rate ? t.vat_line(vatStr, String(data.vat_rate)) : t.vat_no_rate(vatStr)) : undefined;
    const rows = infoRows([
      [sh.row_method, data.method || data.payment_method],
      [sh.row_description, data.description || data.service_name || data.membership_name],
      [sh.row_date, formatDateLong(data.paid_at || data.date, lang)],
      [sh.row_reference, data.reference || data.receipt_number],
      [sh.row_vat, data.vat_amount ? formatCurrency(data.vat_amount, lang) : data.vat_enabled ? sh.row_vat_active : undefined],
    ]);
    const body = amountSummary({ total: totalStr, totalLabel: t.total_label, vatLine }) + rows;
    return out(t.subject(salonName, String(data.reference || "")).trim(), intro,
      shell({ ...base, title: t.title, intro, body, primaryAction: act(t.cta_appointment, "primary") }),
      `${t.title}\n${intro}\n${totalStr}\n${String(data.method || data.payment_method || "")}`);
  }

  if (key === "appointment_reminder") {
    const t = s.appointment_reminder;
    const dateShort = formatDateShort(data.appointment_date || data.date, lang);
    const intro = firstName ? t.intro_named(firstName, salonName) : t.intro(salonName);
    const rows = infoRows([
      [sh.row_date, formatDateLong(data.appointment_date || data.date, lang)],
      [sh.row_time, data.time || data.start_time],
      [sh.row_service, data.service_name],
      [sh.row_staff, data.employee || data.staff_name],
      [sh.row_location, data.location || data.address],
    ]);
    const cf = acts.confirmFlow;
    const confirmBlock = cf ? `<div style="margin:18px 0 10px;"><p style="margin:0 0 10px;color:#111827;font-size:14px;font-weight:700;text-align:center;">${escapeHtml(t.confirm_intro)}</p>${btn(accent, cf.confirmUrl, t.cta_confirm)}<a href="${escapeHtml(cf.declineUrl)}" style="display:block;background:#ffffff;color:#111827;text-decoration:none;border:1px solid #E5E7EB;border-radius:14px;padding:13px 18px;font-size:14px;font-weight:700;text-align:center;margin:0;">${escapeHtml(t.cta_decline)}</a></div>` : "";
    const body = rows + confirmBlock + noteBlock(t.note_title, [data.preparation_tip || t.note_default_tip, t.note_reschedule, data.aftercare_note]);
    const manage = act(t.cta_manage, "primary");
    return out(t.subject(salonName, dateShort || ""), intro,
      shell({ ...base, title: t.title, intro, body, primaryAction: cf ? undefined : manage, secondaryAction: cf ? manage : undefined }),
      `${t.title}\n${intro}\n${formatDateLong(data.appointment_date || data.date, lang)} ${String(data.time || data.start_time || "")}${cf ? `\n\n${t.confirm_intro}\n${t.cta_confirm}: ${cf.confirmUrl}\n${t.cta_decline}: ${cf.declineUrl}` : ""}${manage?.url ? `\n${t.cta_manage}: ${manage.url}` : ""}`);
  }

  if (key === "booking_cancellation") {
    const t = s.booking_cancellation;
    const intro = t.intro(salonName);
    const rows = infoRows([
      [sh.row_status, t.status_cancelled],
      [sh.row_service, data.service_name],
      [sh.row_date, formatDateLong(data.appointment_date || data.date, lang)],
      [sh.row_time, data.time || data.start_time],
      [sh.row_reference, data.reference],
      [sh.row_support, supportEmail],
    ]);
    const body = rows + noteBlock(t.note_title, [t.note_check, supportEmail ? t.note_contact(supportEmail) : t.note_help]);
    return out(t.subject(salonName), intro, shell({ ...base, title: t.title, intro, body, primaryAction: act(t.cta_new, "primary") }), `${t.title}\n${intro}`);
  }

  if (key === "membership_notification") {
    const t = s.membership_notification;
    const intro = firstName ? t.intro_named(firstName, salonName) : t.intro(salonName);
    const benefits = Array.isArray(data.benefits) ? data.benefits : [data.benefit_1, data.benefit_2, data.benefit_3];
    const rows = infoRows([
      [sh.row_membership, data.membership_name],
      [sh.row_status, data.status || t.status_active],
      [sh.row_credits, data.credits ?? data.credits_status],
      [sh.row_next_payment, formatDateLong(data.next_payment_at, lang)],
      [sh.row_monthly, data.amount ? formatCurrency(data.amount, lang) : undefined],
    ]);
    const labels = { membership: t.cta_manage, booking: t.cta_book } as Record<string, string>;
    const p = acts.primary ? { label: labels[acts.primary.slot], url: acts.primary.url } : undefined;
    const sc = acts.secondary ? { label: labels[acts.secondary.slot], url: acts.secondary.url } : undefined;
    return out(t.subject(salonName), intro, shell({ ...base, title: t.title, intro, body: rows + noteBlock(t.benefits_title, benefits), primaryAction: p, secondaryAction: sc }), `${t.title}\n${intro}\n${String(data.membership_name || "")}`);
  }

  if (key === "auto_rebook") {
    const t = AUTO_REBOOK_STRINGS[lang] || AUTO_REBOOK_STRINGS.nl;
    const intro = t.intro(firstName, salonName);
    const rows = infoRows([[sh.row_service, data.service_name], [sh.row_date, formatDateLong(data.last_visit_date, lang)]]);
    const body = rows + `<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.65;">${escapeHtml(t.body)}</p>`;
    const p = act(t.cta, "primary");
    return out(t.subject(salonName), intro, shell({ ...base, title: t.title, intro, body, primaryAction: p }), `${t.title}\n${intro}${p?.url ? `\n${p.url}` : ""}`);
  }

  const t = s.review_request;
  const intro = firstName ? t.intro_named(firstName, salonName) : t.intro(salonName);
  const body = infoRows([
    [sh.row_service, data.service_name],
    [sh.row_date, formatDateLong(data.appointment_date || data.completed_at || data.date, lang)],
    [sh.row_staff, data.employee || data.staff_name],
  ]) + `<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.65;">${escapeHtml(t.body_text)}</p>`;
  const labels = { review: t.cta_review, booking: t.cta_rebook } as Record<string, string>;
  const p = acts.primary ? { label: labels[acts.primary.slot], url: acts.primary.url } : undefined;
  const sc = acts.secondary ? { label: labels[acts.secondary.slot], url: acts.secondary.url } : undefined;
  return out(t.subject(salonName), intro, shell({ ...base, title: t.title, intro, body, primaryAction: p, secondaryAction: sc }), `${t.title}\n${intro}`);
}
