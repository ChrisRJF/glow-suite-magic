import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type TemplateKey =
  | "booking_confirmation"
  | "payment_receipt"
  | "appointment_reminder"
  | "booking_cancellation"
  | "membership_notification"
  | "review_request";

type SalonFixture = {
  name: string;
  slug: string;
  branding: { primary_color: string; secondary_color: string; logo_url: string };
};

type ServiceFixture = {
  name: string;
  slug: string;
  preparation_tip: string;
};

const source = readFileSync("supabase/functions/send-white-label-email/index.ts", "utf8");
const helpersStart = source.indexOf("function escapeHtml");
const helpersEnd = source.indexOf("async function logEmail");

if (helpersStart === -1 || helpersEnd === -1) {
  throw new Error("Email template helpers could not be extracted for link coverage tests.");
}

const compiled = ts.transpileModule(
  `${source.slice(helpersStart, helpersEnd)}\n(globalThis as any).__renderTemplate = template;`,
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

const context = vm.createContext({ Intl, globalThis: {} });
vm.runInContext(compiled, context);

const renderTemplate = (context.globalThis as { __renderTemplate: (key: TemplateKey, data: Record<string, unknown>, salonName: string, branding: SalonFixture["branding"]) => { html: string; subject: string; text: string } }).__renderTemplate;

const salons: SalonFixture[] = [
  {
    name: "Beauty Studio Sara",
    slug: "beautystudiosara",
    branding: { primary_color: "#7B61FF", secondary_color: "#C850C0", logo_url: "https://cdn.glowsuite.nl/sara.png" },
  },
  {
    name: "House of Beauty",
    slug: "houseofbeauty",
    branding: { primary_color: "#1F9D8A", secondary_color: "#B65FCF", logo_url: "https://cdn.glowsuite.nl/house.png" },
  },
];

const services: ServiceFixture[] = [
  { name: "Glow Facial", slug: "glow-facial", preparation_tip: "Kom zonder make-up voor het mooiste resultaat." },
  { name: "Lash Lift", slug: "lash-lift", preparation_tip: "Gebruik 24 uur vooraf geen waterproof mascara." },
  { name: "Brow Styling", slug: "brow-styling", preparation_tip: "Laat je wenkbrauwen vooraf zoveel mogelijk met rust." },
];

const templateCoverage: Record<TemplateKey, Array<"manage" | "calendar" | "contact" | "review">> = {
  booking_confirmation: ["manage", "calendar"],
  payment_receipt: ["manage"],
  appointment_reminder: ["contact", "manage"],
  booking_cancellation: ["manage", "contact"],
  membership_notification: ["manage"],
  review_request: ["review"],
};

function dataFor(templateKey: TemplateKey, salon: SalonFixture, service: ServiceFixture = services[0]) {
  const baseUrl = `https://${salon.slug}.glowsuite.nl`;
  return {
    customer_name: "Sophie de Vries",
    appointment_date: "2026-05-12T10:00:00.000Z",
    time: "10:00",
    service_name: service.name,
    preparation_tip: service.preparation_tip,
    employee: "Nina",
    location: "Keizersgracht 12, Amsterdam",
    reference: `${salon.slug}-A100`,
    amount: 89,
    total_amount: 89,
    method: "iDEAL",
    membership_name: "Glow Premium",
    credits: "3 van 5 beschikbaar",
    next_payment_at: "2026-06-01T00:00:00.000Z",
    benefits: ["Priority booking", "10% korting", "Maandelijkse glow treatment"],
    manage_url: `${baseUrl}/afspraak/${templateKey}/beheer`,
    appointment_url: `${baseUrl}/afspraak/${templateKey}/details`,
    calendar_url: `${baseUrl}/calendar/${service.slug}/${templateKey}.ics`,
    contact_url: `${baseUrl}/route-contact/${templateKey}`,
    route_url: `${baseUrl}/route/${templateKey}`,
    new_booking_url: `${baseUrl}/boeken/nieuw`,
    membership_url: `${baseUrl}/membership/beheer`,
    review_url: `${baseUrl}/review/${templateKey}`,
    booking_url: `${baseUrl}/boeken`,
  };
}

function expectedUrl(kind: "manage" | "calendar" | "contact" | "review", templateKey: TemplateKey, salon: SalonFixture) {
  const data = dataFor(templateKey, salon);
  if (templateKey === "booking_cancellation" && kind === "manage") return data.new_booking_url;
  if (templateKey === "membership_notification" && kind === "manage") return data.membership_url;
  if (kind === "manage") return data.manage_url;
  if (kind === "calendar") return data.calendar_url;
  if (kind === "contact") return data.contact_url;
  return data.review_url;
}

describe("white-label transactional email CTA link coverage", () => {
  it.each(salons)("renders required CTA URLs for every template for $name", (salon) => {
    for (const templateKey of Object.keys(templateCoverage) as TemplateKey[]) {
      const rendered = renderTemplate(templateKey, dataFor(templateKey, salon), salon.name, salon.branding);

      expect(rendered.subject).toContain(salon.name);
      expect(rendered.html).not.toContain("{{");
      expect(rendered.html).not.toContain("}}");

      for (const cta of templateCoverage[templateKey]) {
        expect(rendered.html).toContain(`href="${expectedUrl(cta, templateKey, salon)}"`);
      }

      for (const otherSalon of salons.filter((candidate) => candidate.slug !== salon.slug)) {
        expect(rendered.html).not.toContain(`https://${otherSalon.slug}.glowsuite.nl`);
      }
    }
  });

  it.each(salons)("renders a salon-specific .ics calendar link in appointment reminders for every service for $name", (salon) => {
    for (const service of services) {
      const rendered = renderTemplate("appointment_reminder", dataFor("appointment_reminder", salon, service), salon.name, salon.branding);
      const expectedCalendarUrl = `https://${salon.slug}.glowsuite.nl/calendar/${service.slug}/appointment_reminder.ics`;

      expect(rendered.subject).toContain(salon.name);
      expect(rendered.html).toContain(service.name);
      expect(rendered.html).toContain(service.preparation_tip);
      expect(rendered.html).toContain(`href="${expectedCalendarUrl}"`);
      expect(new URL(expectedCalendarUrl).pathname.endsWith(".ics")).toBe(true);

      for (const otherSalon of salons.filter((candidate) => candidate.slug !== salon.slug)) {
        expect(rendered.html).not.toContain(`https://${otherSalon.slug}.glowsuite.nl/calendar/`);
      }
    }
  });
});