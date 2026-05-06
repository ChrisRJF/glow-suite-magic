export type WhatsAppTemplateType =
  | "booking_confirmation"
  | "reminder"
  | "review"
  | "no_show"
  | "waitlist_offer"
  | "revenue_boost";

export const DEFAULT_WHATSAPP_TEMPLATES: Record<WhatsAppTemplateType, string> = {
  booking_confirmation: `Beste {{customer_name}},

Hierbij bevestigen we je afspraak op {{appointment_date}} om {{appointment_time}} voor de volgende behandeling(en):

{{services}}

Let op: de afspraak kan kosteloos tot uiterlijk 12 uur van tevoren worden verplaatst via deze link:
{{reschedule_link}}

Tot dan!

{{salon_name}}`,
  reminder: `Hi {{customer_name}} 👋

Herinnering: je afspraak bij {{salon_name}} is op {{appointment_date}} om {{appointment_time}}.

Tot dan!`,
  review: `Bedankt voor je bezoek aan {{salon_name}}, {{customer_name}}!

We horen graag je ervaring. Laat hier een korte review achter:
{{review_link}}`,
  no_show: `Hi {{customer_name}}, jammer dat je je afspraak bij {{salon_name}} hebt gemist. Je kunt makkelijk een nieuwe afspraak plannen via {{booking_link}}.`,
  waitlist_offer: `Hey {{customer_name}} 👋

Er is net een plek vrijgekomen op {{appointment_date}} om {{appointment_time}} voor {{service}}.

Wil je 'm hebben? Reageer met JA, dan reserveer ik de plek voor je.

– {{salon_name}}`,
  revenue_boost: `Hi {{customer_name}}, het is alweer even geleden sinds je laatste behandeling bij {{salon_name}}. Deze week hebben we nog enkele plekken vrij. Boek hier je afspraak: {{booking_link}}`,
};

export const TEMPLATE_LABELS: Record<WhatsAppTemplateType, string> = {
  booking_confirmation: "Boekingsbevestiging",
  reminder: "Herinnering",
  review: "Review verzoek",
  no_show: "No-show follow-up",
  waitlist_offer: "Wachtlijst aanbieding",
  revenue_boost: "Revenue Boost",
};

export function renderTemplate(
  template: string,
  vars: Record<string, string | undefined | null>,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v == null ? "" : String(v);
  });
}

export const SAMPLE_VARS: Record<string, string> = {
  customer_name: "Sophie Jansen",
  salon_name: "Salon Glow",
  appointment_date: "vrijdag 12 juli",
  appointment_time: "14:30",
  services: "• Knippen & föhnen\n• Kleuring",
  service: "Knippen & föhnen",
  reschedule_link: "https://glowsuite.nl/afspraak/voorbeeld",
  review_link: "https://g.page/r/voorbeeld/review",
  booking_link: "https://glowsuite.nl/boek/voorbeeld",
};
