import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMPLOYEES = [
  { id: "bas", name: "Bas", role: "Kapper" },
  { id: "roos", name: "Roos", role: "Kapster" },
  { id: "lisa", name: "Lisa", role: "Allround stylist" },
  { id: "emma", name: "Emma", role: "Junior stylist" },
];

const RequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get_salon"), slug: z.string().trim().min(1).max(120) }),
  z.object({ action: z.literal("get_booking"), slug: z.string().trim().min(1).max(120), booking_token: z.string().uuid() }),
  z.object({ action: z.literal("lookup_customer"), slug: z.string().trim().min(1).max(120), email: z.string().trim().email().max(255) }),
  z.object({
    action: z.literal("create_booking"),
    slug: z.string().trim().min(1).max(120),
    customer: z.object({
      name: z.string().trim().min(2).max(120),
      email: z.string().trim().email().max(255),
      phone: z.string().trim().min(6).max(40),
      marketing_consent: z.boolean().optional().default(false),
      privacy_consent: z.boolean().optional().default(true),
    }),
    date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().trim().regex(/^\d{2}:\d{2}$/),
    service_id: z.string().uuid(),
    employee: z.string().trim().max(80).optional().nullable(),
    group_members: z.array(z.object({
      name: z.string().trim().min(1).max(120),
      service_id: z.string().uuid(),
      time: z.string().trim().regex(/^\d{2}:\d{2}$/).optional(),
      employee: z.string().trim().max(80).optional().nullable(),
    })).max(8).optional().default([]),
    payment: z.object({ required: z.boolean(), amount: z.number().min(0).max(100000), type: z.enum(["deposit", "full", "remainder"]).optional().default("deposit"), method: z.enum(["ideal", "bancontact", "creditcard", "applepay", "paypal"]).optional().default("ideal") }),
    notes: z.string().trim().max(1000).optional().default(""),
  }),
]);

type ServiceRow = { id: string; name: string; duration_minutes: number; price: number; color?: string | null; description?: string | null; user_id: string };

type SalonContext = {
  settings: any;
  services: ServiceRow[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function getSalon(supabase: ReturnType<typeof createClient>, slug: string): Promise<SalonContext | null> {
  const normalized = slugify(slug);
  const { data: settingsRows, error } = await supabase
    .from("settings")
    .select("user_id, salon_name, opening_hours, demo_mode, deposit_new_client, deposit_percentage, full_prepay_threshold, skip_prepay_vip, deposit_noshow_risk, group_bookings_enabled, mollie_mode, whitelabel_branding, public_slug, show_prices_online, public_employees_enabled, cancellation_notice")
    .or(`public_slug.eq.${normalized},public_slug.eq.${slug}`)
    .limit(1);

  if (error) throw error;
  let settings = settingsRows?.[0];

  if (!settings) {
    const { data: fallbackRows } = await supabase
      .from("settings")
      .select("user_id, salon_name, opening_hours, demo_mode, deposit_new_client, deposit_percentage, full_prepay_threshold, skip_prepay_vip, deposit_noshow_risk, group_bookings_enabled, mollie_mode, whitelabel_branding, public_slug, show_prices_online, public_employees_enabled, cancellation_notice")
      .limit(200);
    settings = fallbackRows?.find((row: any) => slugify(row.salon_name || "") === normalized);
  }

  if (!settings) return null;

  const { data: services, error: serviceError } = await supabase
    .from("services")
    .select("id, user_id, name, duration_minutes, price, color, description")
    .eq("user_id", settings.user_id)
    .eq("is_active", true)
    .eq("is_online_bookable", true)
    .eq("is_internal_only", false)
    .order("name", { ascending: true });

  if (serviceError) throw serviceError;
  return { settings, services: services || [] };
}

function safeSalonPayload(ctx: SalonContext) {
  const branding = ctx.settings.whitelabel_branding || {};
  return {
    salon: {
      slug: ctx.settings.public_slug,
      name: ctx.settings.salon_name || branding.salon_name || "Salon",
      logo_url: branding.logo_url || "",
      primary_color: branding.primary_color || "#7B61FF",
      secondary_color: branding.secondary_color || "#C850C0",
      opening_hours: ctx.settings.opening_hours,
      demo_mode: Boolean(ctx.settings.demo_mode),
      group_bookings_enabled: Boolean(ctx.settings.group_bookings_enabled),
      show_prices_online: ctx.settings.show_prices_online !== false,
      public_employees_enabled: ctx.settings.public_employees_enabled !== false,
      cancellation_notice: ctx.settings.cancellation_notice || "Annuleer of verplaats je afspraak minimaal 24 uur van tevoren.",
      booking_rules: {
        deposit_new_client: ctx.settings.deposit_new_client ?? true,
        deposit_percentage: ctx.settings.deposit_percentage ?? 50,
        full_prepay_threshold: Number(ctx.settings.full_prepay_threshold || 150),
        skip_prepay_vip: ctx.settings.skip_prepay_vip ?? false,
        deposit_noshow_risk: ctx.settings.deposit_noshow_risk ?? true,
        mollie_mode: ctx.settings.mollie_mode || "test",
      },
    },
    services: ctx.services.map((service) => ({
      id: service.id,
      name: service.name,
      duration: service.duration_minutes,
      price: ctx.settings.show_prices_online === false ? 0 : Number(service.price || 0),
      color: service.color,
      description: service.description,
    })),
    employees: ctx.settings.public_employees_enabled === false ? [] : EMPLOYEES,
  };
}

function combineDateTime(date: string, time: string) {
  return new Date(`${date}T${time}:00+01:00`);
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && startB < endA;
}

function addMinutesToTime(time: string, minutes: number) {
  const [hour, minute] = time.split(":").map(Number);
  const total = hour * 60 + minute + minutes;
  const nextHour = Math.floor(total / 60) % 24;
  const nextMinute = total % 60;
  return `${String(nextHour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}:00`;
}

async function assertAvailability(supabase: ReturnType<typeof createClient>, userId: string, date: string, bookings: Array<{ time: string; duration: number; employee: string | null }>) {
  const dayStart = `${date}T00:00:00+01:00`;
  const dayEnd = `${date}T23:59:59+01:00`;
  const { data: existing, error } = await supabase
    .from("appointments")
    .select("appointment_date, end_time, employee_id, status")
    .eq("user_id", userId)
    .gte("appointment_date", dayStart)
    .lte("appointment_date", dayEnd)
    .not("status", "in", "(geannuleerd,cancelled)");
  if (error) throw error;

  for (const booking of bookings) {
    const start = combineDateTime(date, booking.time);
    const end = new Date(start.getTime() + booking.duration * 60000);
    const sameEmployee = (existing || []).filter((item: any) => !booking.employee || !item.employee_id || item.employee_id === booking.employee);
    const taken = sameEmployee.some((item: any) => {
      const itemStart = new Date(item.appointment_date);
      const [h, m] = String(item.end_time || "00:00").split(":").map(Number);
      const itemEnd = new Date(itemStart);
      itemEnd.setHours(h || itemStart.getHours(), m || itemStart.getMinutes(), 0, 0);
      return overlaps(start, end, itemStart, itemEnd);
    });
    if (taken) return false;
  }
  return true;
}

async function createMolliePayment(args: { req: Request; amount: number; paymentType: string; method: string; appointmentId: string; customerId: string; salonId: string; bookingToken: string; isDemo: boolean }) {
  if (args.isDemo) {
    return { demo: true, status: "paid", mollieId: `demo_${crypto.randomUUID().slice(0, 8)}`, checkoutUrl: null };
  }

  const mollieApiKey = Deno.env.get("MOLLIE_API_KEY");
  if (!mollieApiKey) {
    return { setupError: "Mollie is nog niet geconfigureerd. Je afspraak is opgeslagen, maar betaling kon niet worden gestart." };
  }

  const origin = args.req.headers.get("origin") || "https://glowsuite.nl";
  const mollieResponse = await fetch("https://api.mollie.com/v2/payments", {
    method: "POST",
    headers: { Authorization: `Bearer ${mollieApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: { currency: "EUR", value: args.amount.toFixed(2) },
      description: `GlowSuite ${args.paymentType === "deposit" ? "aanbetaling" : "betaling"}`,
      redirectUrl: `${origin}/boeken/${args.salonId}?status=payment-return&booking=${args.bookingToken}`,
      method: args.method,
      metadata: {
        appointment_id: args.appointmentId,
        customer_id: args.customerId,
        salon_id: args.salonId,
        booking_token: args.bookingToken,
        payment_type: args.paymentType,
      },
    }),
  });
  const mollieData = await mollieResponse.json();
  if (!mollieResponse.ok) return { setupError: "Betaling kon niet worden gestart. Je afspraak is opgeslagen met betaalstatus in afwachting.", raw: mollieData };
  return { demo: false, status: "pending", mollieId: mollieData.id, checkoutUrl: mollieData._links?.checkout?.href || null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Methode niet toegestaan" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const parsed = RequestSchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: "Ongeldige invoer", details: parsed.error.flatten().fieldErrors }, 400);

    const ctx = await getSalon(supabase, parsed.data.slug);
    if (!ctx) return json({ error: "Deze boekingspagina bestaat niet." }, 404);

    if (parsed.data.action === "get_salon") return json(safeSalonPayload(ctx));

    if (parsed.data.action === "get_booking") {
      const { data: appointment, error: appointmentError } = await supabase
        .from("appointments")
        .select("id, booking_reference, booking_token, appointment_date, start_time, employee_id, payment_status, status, service_id, services(name)")
        .eq("user_id", ctx.settings.user_id)
        .eq("booking_token", parsed.data.booking_token)
        .maybeSingle();
      if (appointmentError) throw appointmentError;
      if (!appointment) return json({ error: "Boeking niet gevonden." }, 404);
      return json({
        appointment,
        confirmation: {
          salon_name: ctx.settings.salon_name,
          service_name: (appointment as any).services?.name || "Behandeling",
          employee: appointment.employee_id,
          date: String(appointment.appointment_date).slice(0, 10),
          time: String(appointment.start_time || "").slice(0, 5),
          reference: appointment.booking_reference,
          payment_status: appointment.payment_status,
          status: appointment.status,
        },
      });
    }

    if (parsed.data.action === "lookup_customer") {
      const email = parsed.data.email.toLowerCase();
      const { data: customer } = await supabase
        .from("customers")
        .select("id, name, phone")
        .eq("user_id", ctx.settings.user_id)
        .ilike("email", email)
        .maybeSingle();
      if (!customer) return json({ customer: null, recentAppointments: [] });
      const { data: appts } = await supabase
        .from("appointments")
        .select("id, service_id, appointment_date")
        .eq("user_id", ctx.settings.user_id)
        .eq("customer_id", customer.id)
        .order("appointment_date", { ascending: false })
        .limit(3);
      return json({ customer: { name: customer.name, phone: customer.phone || "" }, recentAppointments: appts || [] });
    }

    const data = parsed.data;
    const serviceMap = new Map(ctx.services.map((service) => [service.id, service]));
    const mainService = serviceMap.get(data.service_id);
    if (!mainService) return json({ error: "Deze behandeling is niet meer beschikbaar." }, 410);

    const groupId = crypto.randomUUID();
    const bookingRows = [
      { name: data.customer.name, service: mainService, time: data.time, employee: data.employee || null },
      ...data.group_members.map((member) => {
        const memberService = serviceMap.get(member.service_id);
        if (!memberService) throw new Error("Een gekozen groepsbehandeling is niet meer beschikbaar.");
        return { name: member.name, service: memberService, time: member.time || data.time, employee: member.employee || null };
      }),
    ];

    const available = await assertAvailability(supabase, ctx.settings.user_id, data.date, bookingRows.map((row) => ({ time: row.time, duration: row.service.duration_minutes, employee: row.employee })));
    if (!available) return json({ error: "Deze tijd is net volgeboekt. Kies een nieuw moment.", code: "slot_unavailable" }, 409);

    const email = data.customer.email.toLowerCase();
    const { data: existingCustomer } = await supabase
      .from("customers")
      .select("id")
      .eq("user_id", ctx.settings.user_id)
      .ilike("email", email)
      .maybeSingle();

    let customerId = existingCustomer?.id;
    if (!customerId) {
      const { data: newCustomer, error: customerError } = await supabase
        .from("customers")
        .insert({
          user_id: ctx.settings.user_id,
          name: data.customer.name,
          email,
          phone: data.customer.phone,
          marketing_consent: data.customer.marketing_consent,
          privacy_consent: data.customer.privacy_consent,
          notes: ctx.settings.demo_mode ? "Demo boeking via online boeken" : "Aangemaakt via online boeken",
        })
        .select("id")
        .single();
      if (customerError) throw customerError;
      customerId = newCustomer.id;
    }

    const appointmentsToInsert = bookingRows.map((row, index) => {
      const start = combineDateTime(data.date, row.time);
      const end = new Date(start.getTime() + row.service.duration_minutes * 60000);
      return {
        user_id: ctx.settings.user_id,
        customer_id: customerId,
        service_id: row.service.id,
        appointment_date: start.toISOString(),
        start_time: row.time,
        end_time: addMinutesToTime(row.time, row.service.duration_minutes),
        employee_id: row.employee,
        price: Number(row.service.price || 0),
        notes: [data.notes, index > 0 ? `Groepsboeking voor ${row.name}` : "Online boeking"].filter(Boolean).join(" · "),
        status: data.payment.required ? "pending_confirmation" : "confirmed",
        payment_status: data.payment.required ? "pending" : "unpaid",
        payment_required: data.payment.required,
        deposit_amount: data.payment.required ? data.payment.amount : 0,
        source: "online_booking",
        booking_group_id: bookingRows.length > 1 ? groupId : null,
        payment_type: data.payment.type,
      };
    });

    const stillAvailable = await assertAvailability(supabase, ctx.settings.user_id, data.date, bookingRows.map((row) => ({ time: row.time, duration: row.service.duration_minutes, employee: row.employee })));
    if (!stillAvailable) return json({ error: "Deze tijd is net volgeboekt. Kies een nieuw moment.", code: "slot_unavailable" }, 409);

    const { data: appointments, error: appointmentError } = await supabase
      .from("appointments")
      .insert(appointmentsToInsert)
      .select("id, booking_token, booking_reference, appointment_date, start_time, end_time, employee_id, service_id, payment_status, status");
    if (appointmentError) throw appointmentError;

    const primaryAppointment = appointments?.[0];
    let checkoutUrl: string | null = null;
    let paymentStatus = primaryAppointment?.payment_status || "unpaid";
    let paymentInitError: string | null = null;

    if (data.payment.required && primaryAppointment) {
      const payment = await createMolliePayment({
        req,
        amount: data.payment.amount,
        paymentType: data.payment.type,
        method: data.payment.method,
        appointmentId: primaryAppointment.id,
        customerId,
        salonId: ctx.settings.public_slug || slugify(ctx.settings.salon_name || "salon"),
        bookingToken: primaryAppointment.booking_token,
        isDemo: Boolean(ctx.settings.demo_mode),
      });
      if (payment.setupError) {
        paymentInitError = payment.setupError;
        paymentStatus = "payment_pending";
      } else {
        paymentStatus = payment.demo ? "paid" : "pending";
        checkoutUrl = payment.checkoutUrl;
        await supabase.from("payments").insert({
          user_id: ctx.settings.user_id,
          appointment_id: primaryAppointment.id,
          customer_id: customerId,
          mollie_payment_id: payment.mollieId,
          amount: data.payment.amount,
          currency: "EUR",
          payment_type: data.payment.type,
          status: paymentStatus,
          method: data.payment.method,
          is_demo: Boolean(ctx.settings.demo_mode),
          provider: "mollie",
          checkout_reference: primaryAppointment.booking_reference,
          metadata: {
            appointment_id: primaryAppointment.id,
            customer_id: customerId,
            salon_id: ctx.settings.public_slug || slugify(ctx.settings.salon_name || "salon"),
            booking_token: primaryAppointment.booking_token,
            payment_type: data.payment.type,
          },
        });
      }
      const nextPaymentStatus = paymentStatus === "paid" ? "paid" : paymentInitError ? "payment_failed" : "pending";
      await supabase.from("appointments").update({ payment_status: nextPaymentStatus, status: paymentStatus === "paid" ? "confirmed" : "pending_confirmation" }).eq("booking_group_id", groupId);
      await supabase.from("appointments").update({ payment_status: nextPaymentStatus, status: paymentStatus === "paid" ? "confirmed" : "pending_confirmation" }).eq("id", primaryAppointment.id);
    }

    return json({
      success: true,
      appointment: primaryAppointment,
      appointments,
      customer_id: customerId,
      checkoutUrl,
      paymentInitError,
      confirmation: {
        salon_name: ctx.settings.salon_name,
        service_name: mainService.name,
        employee: primaryAppointment?.employee_id,
        date: data.date,
        time: data.time,
        reference: primaryAppointment?.booking_reference,
        payment_status: paymentStatus,
      },
    });
  } catch (error) {
    return json({ error: (error as Error).message || "Boeking kon niet worden opgeslagen." }, 500);
  }
});
