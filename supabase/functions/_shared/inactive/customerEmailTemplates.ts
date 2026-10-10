// INACTIVE: send-white-label-email templates with server-validated links only.
// Ported 1:1 from the active renderer (layout, copy, colors); only the link logic changed:
// every button comes from templateActions(buildSafeEmailLinks(...)). No subdomains, no .ics,
// no generic route/terms/receipt pages, no caller-supplied URLs. Missing link = no button.
import { emailStrings, formatCurrency, formatDateLong, formatDateShort, type EmailLang } from "../emailTranslations.ts";
import { templateActions, allowedLinksIn, type SafeEmailLinks, type TemplateKey } from "./customerEmailRender.ts";

export type TemplateResult = { subject: string; preview: string; html: string; text: string; links: string[] };
type Action = { label: string; url?: string };

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function validReplyTo(value: unknown) {
  const email = String(value || "").trim().toLowerCase();
  return z.string().email().safeParse(email).success ? email : undefined;
}

function hexColor(value: unknown, fallback: string) {
  const color = String(value || "").trim();
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : fallback;
}

function firstFilled(...values: unknown[]) {
  return values.map((value) => String(value ?? "").trim()).find(Boolean) || "";
}

function absoluteUrl(value: unknown, fallbackPath: string, baseUrl: string) {
  const raw = String(value ?? "").trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  const path = raw && raw !== "#" ? raw : fallbackPath;
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
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
