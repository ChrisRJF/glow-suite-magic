import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "https://esm.sh/zod@3.23.8";
import { createVivaOrder, vivaCheckoutUrl, isVivaConfigured } from "../_shared/viva.ts";

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
      accepted_glowsuite_terms: z.boolean().optional().default(false),
      accepted_salon_terms: z.boolean().optional().default(false),
      accepted_terms_at: z.string().datetime().optional().nullable(),
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
    .select("id, user_id, salon_name, opening_hours, demo_mode, is_demo, deposit_new_client, deposit_percentage, full_prepay_threshold, skip_prepay_vip, deposit_noshow_risk, group_bookings_enabled, mollie_mode, whitelabel_branding, public_slug, show_prices_online, public_employees_enabled, cancellation_notice, payment_provider")
    .or(`public_slug.eq.${normalized},public_slug.eq.${slug}`)
    .limit(1);

  if (error) throw error;
  let settings = settingsRows?.[0];

  if (!settings) {
    const { data: fallbackRows } = await supabase
      .from("settings")
      .select("id, user_id, salon_name, opening_hours, demo_mode, is_demo, deposit_new_client, deposit_percentage, full_prepay_threshold, skip_prepay_vip, deposit_noshow_risk, group_bookings_enabled, mollie_mode, whitelabel_branding, public_slug, show_prices_online, public_employees_enabled, cancellation_notice, payment_provider")
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

async function sendWhiteLabelEmail(supabase: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const { error } = await supabase.functions.invoke("send-white-label-email", { body });
  if (error) console.error("White-label email failed", error.message);
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

async function createMolliePayment(args: { req: Request; supabase: ReturnType<typeof createClient>; amount: number; paymentType: string; method: string; appointmentId: string; customerId: string; salonId: string; salonOwnerId: string; settingsId: string; bookingToken: string; isDemo: boolean }) {
  if (args.isDemo) {
    return { demo: true, status: "paid", mollieId: `demo_${crypto.randomUUID().slice(0, 8)}`, checkoutUrl: null };
  }

  const { data: connection } = await args.supabase
    .from("mollie_connections")
    .select("*")
    .eq("user_id", args.salonOwnerId)
    .eq("salon_id", args.settingsId)
    .eq("is_active", true)
    .is("disconnected_at", null)
    .maybeSingle();
  if (!connection) {
    return { setupError: "Mollie is nog niet gekoppeld. Je afspraak is opgeslagen, maar betaling kon niet worden gestart." };
  }

  const origin = args.req.headers.get("origin") || "https://glowsuite.nl";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const mollieResponse = await fetch("https://api.mollie.com/v2/payments", {
    method: "POST",
    headers: { Authorization: `Bearer ${(connection as any).mollie_access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: { currency: "EUR", value: args.amount.toFixed(2) },
      description: `GlowSuite ${args.paymentType === "deposit" ? "aanbetaling" : "betaling"}`,
      redirectUrl: `${origin}/boeken/${args.salonId}?status=payment-return&booking=${args.bookingToken}`,
      webhookUrl: `${supabaseUrl}/functions/v1/mollie-webhook`,
      method: args.method,
      metadata: {
        appointment_id: args.appointmentId,
        customer_id: args.customerId,
        salon_id: args.salonOwnerId,
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
          is_demo: Boolean(ctx.settings.is_demo || ctx.settings.demo_mode),
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
        is_demo: Boolean(ctx.settings.is_demo || ctx.settings.demo_mode),
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
        accepted_glowsuite_terms: Boolean(data.customer.accepted_glowsuite_terms),
        accepted_salon_terms: Boolean(data.customer.accepted_salon_terms),
        accepted_terms_at: data.customer.accepted_terms_at ?? ((data.customer.accepted_glowsuite_terms && data.customer.accepted_salon_terms) ? new Date().toISOString() : null),
      };
    });

    const stillAvailable = await assertAvailability(supabase, ctx.settings.user_id, data.date, bookingRows.map((row) => ({ time: row.time, duration: row.service.duration_minutes, employee: row.employee })));
    if (!stillAvailable) return json({ error: "Deze tijd is net volgeboekt. Kies een nieuw moment.", code: "slot_unavailable" }, 409);

    const { data: appointments, error: appointmentError } = await supabase
      .from("appointments")
      .insert(appointmentsToInsert)
      .select("id, booking_token, booking_reference, appointment_date, start_time, end_time, employee_id, service_id, payment_status, status");
    if (appointmentError) {
      // Postgres unique violation (23505) on the slot index = race-condition double-book.
      if ((appointmentError as any).code === "23505") {
        console.error("Slot taken (race condition)", { user_id: ctx.settings.user_id, date: data.date, time: data.time, detail: appointmentError.message });
        return json({ error: "Dit tijdslot is net geboekt. Kies een andere tijd.", code: "slot_unavailable" }, 409);
      }
      console.error("appointment insert error", appointmentError);
      return json({ error: "Boeking kon niet worden opgeslagen. Probeer het opnieuw of kies een ander tijdstip." }, 500);
    }

    const primaryAppointment = appointments?.[0];
    let checkoutUrl: string | null = null;
    let paymentStatus = primaryAppointment?.payment_status || "unpaid";
    let paymentInitError: string | null = null;

    if (data.payment.required && primaryAppointment) {
      const provider = ((ctx.settings as any).payment_provider as string) || "mollie";
      const isDemo = Boolean(ctx.settings.demo_mode);
      const salonSlugForMeta = ctx.settings.public_slug || slugify(ctx.settings.salon_name || "salon");

      if (provider === "viva") {
        // Viva flow
        if (isDemo) {
          const fakeOrderCode = `demo_viva_${crypto.randomUUID().slice(0, 8)}`;
          checkoutUrl = `/boeken/${salonSlugForMeta}?status=demo-viva-payment&booking=${primaryAppointment.booking_token}`;
          paymentStatus = "paid";
          await supabase.from("payments").insert({
            user_id: ctx.settings.user_id,
            appointment_id: primaryAppointment.id,
            customer_id: customerId,
            mollie_payment_id: fakeOrderCode,
            checkout_reference: fakeOrderCode,
            amount: data.payment.amount,
            currency: "EUR",
            payment_type: data.payment.type,
            status: "paid",
            method: "viva",
            is_demo: true,
            provider: "viva",
            metadata: {
              provider: "viva",
              source: "public_booking",
              viva_order_code: fakeOrderCode,
              appointment_id: primaryAppointment.id,
              customer_id: customerId,
              salon_id: salonSlugForMeta,
              booking_token: primaryAppointment.booking_token,
              payment_type: data.payment.type,
              simulated: true,
            },
          });
        } else if (!isVivaConfigured()) {
          paymentInitError = "Viva is nog niet gekoppeld. Je afspraak is opgeslagen, maar betaling kon niet worden gestart.";
          paymentStatus = "payment_pending";
        } else {
          try {
            const origin = req.headers.get("origin") || "https://glowsuite.nl";
            const returnUrl = `${origin}/boeken/${salonSlugForMeta}?status=payment-return&booking=${primaryAppointment.booking_token}`;
            const order = await createVivaOrder({
              amountCents: Math.round(Number(data.payment.amount) * 100),
              description: `GlowSuite ${data.payment.type === "deposit" ? "aanbetaling" : "betaling"}`,
              customerEmail: email,
              customerFullName: data.customer.name,
              customerPhone: data.customer.phone,
              successUrl: returnUrl,
              failureUrl: returnUrl,
              source: "public_booking",
              paymentType: data.payment.type === "deposit" ? "deposit" : "full",
            });
            checkoutUrl = vivaCheckoutUrl(order.orderCode);
            paymentStatus = "pending";
            await supabase.from("payments").insert({
              user_id: ctx.settings.user_id,
              appointment_id: primaryAppointment.id,
              customer_id: customerId,
              mollie_payment_id: order.orderCode,
              checkout_reference: order.orderCode,
              amount: data.payment.amount,
              currency: "EUR",
              payment_type: data.payment.type,
              status: "pending",
              method: "viva",
              is_demo: false,
              provider: "viva",
              metadata: {
                provider: "viva",
                source: "public_booking",
                viva_order_code: order.orderCode,
                appointment_id: primaryAppointment.id,
                customer_id: customerId,
                salon_id: salonSlugForMeta,
                booking_token: primaryAppointment.booking_token,
                payment_type: data.payment.type,
                checkout_url: checkoutUrl,
              },
            });
          } catch (e) {
            console.error("Viva order failed (public booking)", e);
            paymentInitError = "Betaling kon niet worden gestart. Je afspraak is opgeslagen met betaalstatus in afwachting.";
            paymentStatus = "payment_pending";
          }
        }
      } else {
        // Mollie (default) — unchanged
        const payment = await createMolliePayment({
          req,
          supabase,
          amount: data.payment.amount,
          paymentType: data.payment.type,
          method: data.payment.method,
          appointmentId: primaryAppointment.id,
          customerId,
          salonId: salonSlugForMeta,
          salonOwnerId: ctx.settings.user_id,
          settingsId: ctx.settings.id,
          bookingToken: primaryAppointment.booking_token,
          isDemo,
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
            mollie_method: data.payment.method,
            is_demo: isDemo,
            provider: Boolean(ctx.settings.is_demo || ctx.settings.demo_mode) ? "demo" : "mollie",
            checkout_reference: primaryAppointment.booking_reference,
            metadata: {
              appointment_id: primaryAppointment.id,
              customer_id: customerId,
              salon_id: salonSlugForMeta,
              booking_token: primaryAppointment.booking_token,
              payment_type: data.payment.type,
            },
          });
        }
      }

      const nextPaymentStatus = paymentStatus === "paid" ? "paid" : paymentInitError ? "payment_failed" : "pending";
      await supabase.from("appointments").update({ payment_status: nextPaymentStatus, status: paymentStatus === "paid" ? "confirmed" : "pending_confirmation" }).eq("booking_group_id", groupId);
      await supabase.from("appointments").update({ payment_status: nextPaymentStatus, status: paymentStatus === "paid" ? "confirmed" : "pending_confirmation" }).eq("id", primaryAppointment.id);
    }

    if (primaryAppointment) {
      const salonSlug = ctx.settings.public_slug || slugify(ctx.settings.salon_name || "salon");
      const serviceSlug = slugify(mainService.name || "service");
      const calendarUrl = `https://${salonSlug}.glowsuite.nl/calendar/${serviceSlug}/booking_confirmation.ics?date=${encodeURIComponent(data.date)}&time=${encodeURIComponent(data.time)}&duration=${encodeURIComponent(String(mainService.duration_minutes || 30))}&ref=${encodeURIComponent(primaryAppointment.booking_reference || primaryAppointment.id)}`;
      await sendWhiteLabelEmail(supabase, {
        user_id: ctx.settings.user_id,
        salon_slug: salonSlug,
        salon_name: ctx.settings.salon_name || "Salon",
        recipient_email: email,
        recipient_name: data.customer.name,
        template_key: "booking_confirmation",
        idempotency_key: `booking-confirmation-${primaryAppointment.id}`,
        template_data: {
          customer_name: data.customer.name,
          service_name: mainService.name,
          appointment_date: primaryAppointment.appointment_date,
          date: data.date,
          time: data.time,
          employee: primaryAppointment.employee_id,
          reference: primaryAppointment.booking_reference,
          total_amount: data.payment.required ? data.payment.amount : Number(mainService.price || 0),
          calendar_url: calendarUrl,
        },
      });

      // Fire-and-forget WhatsApp confirmation (does not block booking flow).
      // Skip if payment is required and not yet paid — confirmation is then sent by mollie-webhook.
      try {
        const { data: waSettings } = await supabase
          .from("whatsapp_settings")
          .select("enabled, send_booking_confirmation")
          .eq("user_id", ctx.settings.user_id)
          .maybeSingle();

        const shouldSendNow = !data.payment.required || paymentStatus === "paid";

        if (shouldSendNow && waSettings?.enabled && waSettings?.send_booking_confirmation && data.customer.phone) {
          // Load template
          const { data: tpl } = await supabase
            .from("whatsapp_templates")
            .select("content, is_active")
            .eq("user_id", ctx.settings.user_id)
            .eq("template_type", "booking_confirmation")
            .maybeSingle();

          const DEFAULT_TPL = `Beste {{customer_name}},\n\nHierbij bevestigen we je afspraak op {{appointment_date}} om {{appointment_time}} voor de volgende behandeling(en):\n\n{{services}}\n\nLet op: de afspraak kan kosteloos tot uiterlijk 12 uur van tevoren worden verplaatst via deze link:\n{{reschedule_link}}\n\nTot dan!\n\n{{salon_name}}`;
          const templateContent = (tpl?.is_active === false ? null : tpl?.content) || DEFAULT_TPL;

          const dateStr = new Date(data.date).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
          const servicesList = bookingRows.map((r) => `• ${r.service.name}`).join("\n");
          const origin = req.headers.get("origin") || "https://glowsuite.nl";
          const rescheduleLink = primaryAppointment.booking_token
            ? `${origin}/afspraak/${primaryAppointment.booking_token}`
            : `${origin}/afspraak`;
          if (!primaryAppointment.booking_token) {
            console.warn("WhatsApp: missing booking_token for reschedule link", primaryAppointment.id);
          }

          const waMessage = templateContent
            .replace(/\{\{\s*customer_name\s*\}\}/g, data.customer.name)
            .replace(/\{\{\s*salon_name\s*\}\}/g, ctx.settings.salon_name || "ons salon")
            .replace(/\{\{\s*appointment_date\s*\}\}/g, dateStr)
            .replace(/\{\{\s*appointment_time\s*\}\}/g, data.time)
            .replace(/\{\{\s*services\s*\}\}/g, servicesList)
            .replace(/\{\{\s*reschedule_link\s*\}\}/g, rescheduleLink)
            .replace(/\{\{\s*review_link\s*\}\}/g, "");

          const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-send`;
          fetch(fnUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({
              user_id: ctx.settings.user_id,
              to: data.customer.phone,
              message: waMessage,
              customer_id: customerId,
              appointment_id: primaryAppointment.id,
              kind: "confirmation",
              meta: { trigger: "booking_created", payment_status: paymentStatus },
            }),
          }).catch((e) => console.error("WhatsApp send failed", e));
        }
      } catch (waErr) {
        console.error("WhatsApp dispatch error (non-blocking)", waErr);
      }
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
    console.error("public-booking unexpected error", error);
    const msg = (error as Error)?.message || "";
    // Map common DB errors to friendly Dutch text — never leak constraint names.
    if (/duplicate key|23505|idx_appointments_unique/i.test(msg)) {
      return json({ error: "Dit tijdslot is net geboekt. Kies een andere tijd.", code: "slot_unavailable" }, 409);
    }
    return json({ error: "Er ging iets mis bij het opslaan van je boeking. Probeer het opnieuw." }, 500);
  }
});
