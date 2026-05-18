// Shared premium layout for GlowSuite *platform/system* emails.
// IMPORTANT: this is platform branding only — do NOT use this for salon→customer mails.
// Designed for Gmail/Outlook/iPhone Mail. Light bg + dark-mode tolerant.

export const GLOWSUITE_FROM = "GlowSuite <noreply@email.glowsuite.nl>";
export const GLOWSUITE_FROM_SUPPORT = "GlowSuite Support <support@email.glowsuite.nl>";
export const GLOWSUITE_REPLY_TO = "support@email.glowsuite.nl";
// Transparent primary GlowSuite logo — must never render inside a square/box.
export const GLOWSUITE_LOGO_URL = "https://glowsuite.nl/glowsuite-logo.png";
export const GLOWSUITE_APP_URL = "https://glowsuite.nl";

/** Footer context presets — explains *why* the recipient got the mail. */
export const FOOTER_REASON = {
  account: "Je ontvangt deze e-mail omdat je een GlowSuite account hebt.",
  trial: "Je ontvangt deze e-mail omdat je een GlowSuite proefperiode hebt gestart.",
  demo: "Je ontvangt deze e-mail omdat je een demo bij GlowSuite hebt aangevraagd.",
  lead: "Je ontvangt deze e-mail omdat je interesse hebt getoond in GlowSuite.",
  billing: "Je ontvangt deze e-mail omdat je een actief GlowSuite abonnement hebt.",
  security: "Je ontvangt deze e-mail vanwege beveiligingsactiviteit op je GlowSuite account.",
} as const;
export type FooterReasonKey = keyof typeof FOOTER_REASON;

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
}

export interface GlowSuiteEmailOptions {
  /** Browser tab + accessible title */
  title: string;
  /** Hidden inbox preview text */
  preheader: string;
  /** H1 in the email */
  heading: string;
  /** Optional small intro line above the heading (e.g. "Welkom bij GlowSuite") */
  eyebrow?: string;
  /** Main paragraph(s) — plain text; line breaks become paragraphs */
  intro: string;
  /** Optional secondary HTML block (e.g. a list / verificatiecode / receipt) — caller MUST escape */
  bodyHtml?: string;
  /** Primary CTA */
  ctaLabel?: string;
  ctaUrl?: string;
  /** Subtle helper text under the CTA */
  helper?: string;
  /** Extra paragraph under helper (still inside the card) */
  outro?: string;
  /** Optional footer note (above the standard footer) */
  footerNote?: string;
  /** Footer reason preset — explains why the user got this email. Default: "account". */
  footerReason?: FooterReasonKey;
  /** Override footer reason text entirely (takes precedence over footerReason). */
  footerText?: string;
}

function paragraphs(text: string): string {
  return esc(text)
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#475569;">${p.replace(/\n/g, "<br/>")}</p>`,
    )
    .join("");
}

/**
 * Render a fully-branded GlowSuite system email.
 * Premium · calm · mobile-first · Linear/Stripe/Notion inspired.
 */
export function renderGlowSuiteEmail(opts: GlowSuiteEmailOptions): string {
  const {
    title,
    preheader,
    heading,
    eyebrow,
    intro,
    bodyHtml,
    ctaLabel,
    ctaUrl,
    helper,
    outro,
    footerNote,
  } = opts;

  const cta =
    ctaLabel && ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;"><tr>
           <td align="center" style="border-radius:12px;background:#7B61FF;background-image:linear-gradient(135deg,#7B61FF 0%,#A974FF 60%,#C850C0 100%);">
             <a href="${esc(ctaUrl)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;letter-spacing:-0.005em;">${esc(ctaLabel)}</a>
           </td>
         </tr></table>`
      : "";

  const fallbackLink =
    ctaUrl
      ? `<p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#94a3b8;word-break:break-all;">Werkt de knop niet? Kopieer deze link:<br/><a href="${esc(ctaUrl)}" style="color:#7B61FF;text-decoration:none;">${esc(ctaUrl)}</a></p>`
      : "";

  return `<!doctype html>
<html lang="nl" dir="ltr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light dark"/>
<meta name="supported-color-schemes" content="light dark"/>
<title>${esc(title)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .gs-bg { background:#0b0b10 !important; }
    .gs-card { background:#15151c !important; box-shadow:0 1px 0 rgba(255,255,255,0.04) !important; }
    .gs-heading, .gs-eyebrow { color:#f5f5f7 !important; }
    .gs-text { color:#c7c7cf !important; }
    .gs-muted { color:#8a8a96 !important; }
    .gs-divider { border-top-color:#262630 !important; }
    .gs-link { color:#b39bff !important; }
  }
  @media only screen and (max-width:520px){
    .gs-card { border-radius:16px !important; }
    .gs-pad { padding:28px 22px !important; }
    .gs-pad-top { padding:28px 22px 0 !important; }
    .gs-pad-foot { padding:22px !important; }
  }
</style>
</head>
<body class="gs-bg" style="margin:0;padding:0;background:#f6f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="gs-bg" style="background:#f6f5f2;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="gs-card" style="max-width:560px;background:#ffffff;border-radius:20px;box-shadow:0 1px 2px rgba(15,23,42,0.04),0 8px 32px rgba(15,23,42,0.06);overflow:hidden;">
      <tr><td class="gs-pad-top" style="padding:36px 36px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle;">
            <img src="${GLOWSUITE_LOGO_URL}" width="28" height="28" alt="" style="display:block;border:0;outline:none;width:28px;height:28px;"/>
          </td>
          <td style="vertical-align:middle;padding-left:10px;">
            <span class="gs-heading" style="font-size:16px;font-weight:600;letter-spacing:-0.01em;color:#0f172a;">GlowSuite</span>
          </td>
        </tr></table>
      </td></tr>
      <tr><td class="gs-pad" style="padding:28px 36px 8px;">
        ${eyebrow ? `<p class="gs-eyebrow" style="margin:0 0 10px;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#7B61FF;">${esc(eyebrow)}</p>` : ""}
        <h1 class="gs-heading" style="margin:0 0 14px;font-size:26px;line-height:1.22;font-weight:700;letter-spacing:-0.022em;color:#0f172a;">${esc(heading)}</h1>
        <div class="gs-text">${paragraphs(intro)}</div>
        ${bodyHtml ?? ""}
        ${cta}
        ${helper ? `<p class="gs-muted" style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#94a3b8;">${esc(helper)}</p>` : ""}
        ${outro ? `<p class="gs-text" style="margin:18px 0 0;font-size:14px;line-height:1.65;color:#475569;">${esc(outro)}</p>` : ""}
        ${fallbackLink}
      </td></tr>
      <tr><td style="padding:0 36px;"><div class="gs-divider" style="border-top:1px solid #f1f5f9;margin-top:32px;"></div></td></tr>
      <tr><td class="gs-pad-foot" style="padding:24px 36px 32px;">
        ${footerNote ? `<p class="gs-muted" style="margin:0 0 14px;font-size:12px;line-height:1.6;color:#94a3b8;">${esc(footerNote)}</p>` : ""}
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle;">
            <img src="${GLOWSUITE_LOGO_URL}" width="20" height="20" alt="" style="display:block;border:0;outline:none;width:20px;height:20px;opacity:0.85;"/>
          </td>
          <td style="vertical-align:middle;padding-left:8px;">
            <span class="gs-muted" style="font-size:12px;font-weight:600;color:#64748b;">GlowSuite</span>
            <span class="gs-muted" style="font-size:12px;color:#94a3b8;"> · Salon platform met AI</span>
          </td>
        </tr></table>
        <p class="gs-muted" style="margin:10px 0 0;font-size:12px;line-height:1.6;color:#94a3b8;">
          Vragen? Mail <a href="mailto:support@email.glowsuite.nl" class="gs-link" style="color:#7B61FF;text-decoration:none;">support@email.glowsuite.nl</a>
        </p>
      </td></tr>
    </table>
    <p class="gs-muted" style="max-width:560px;margin:18px auto 0;font-size:11px;line-height:1.6;color:#a3a3ad;text-align:center;">
      Je ontvangt deze e-mail omdat je een GlowSuite account hebt.
    </p>
  </td></tr>
</table>
</body></html>`;
}

/** Convenience: render a styled bullet list block. Strings are escaped. */
export function bulletListHtml(items: string[]): string {
  const rows = items
    .map(
      (i) =>
        `<tr><td style="padding:6px 0;font-size:14px;line-height:1.6;color:#475569;" class="gs-text">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#7B61FF;vertical-align:middle;margin-right:10px;"></span>${esc(i)}
        </td></tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;">${rows}</table>`;
}

/** Convenience: soft purple-tinted info card for receipts, codes, checklists. */
export function softCardHtml(innerHtml: string): string {
  return `<div style="margin:18px 0 6px;padding:18px 20px;background:#f6f4ff;border:1px solid #ece6ff;border-radius:14px;">${innerHtml}</div>`;
}
