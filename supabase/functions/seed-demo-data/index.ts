import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization");

    const anonClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader || "" } },
    });
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Niet geautoriseerd" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const uid = user.id;

    // Clear existing data
    const tables = ["sub_appointments", "payments", "checkout_items", "feedback_entries", "rebook_actions", "appointments", "campaigns", "discounts", "products", "customers", "services", "automation_rules", "settings"];
    for (const t of tables) {
      await supabase.from(t).delete().eq("user_id", uid);
    }

    // Seed settings with opening hours and group bookings enabled
    await supabase.from("settings").insert({
      user_id: uid,
      salon_name: "Studio Nova Amsterdam",
      demo_mode: true,
      mollie_mode: "test",
      deposit_new_client: true,
      deposit_percentage: 50,
      full_prepay_threshold: 150,
      skip_prepay_vip: true,
      deposit_noshow_risk: true,
      email_enabled: true,
      whatsapp_enabled: true,
      group_bookings_enabled: true,
      buffer_minutes: 15,
      opening_hours: {
        ma: { open: "09:00", close: "18:00", enabled: true },
        di: { open: "09:00", close: "18:00", enabled: true },
        wo: { open: "09:00", close: "18:00", enabled: true },
        do: { open: "09:00", close: "20:00", enabled: true },
        vr: { open: "09:00", close: "18:00", enabled: true },
        za: { open: "09:00", close: "17:00", enabled: true },
        zo: { open: "09:00", close: "17:00", enabled: false },
      },
    });

    // Seed customers
    const customersData = [
      { user_id: uid, name: "Lisa Jansen", phone: "+31612345678", email: "lisa@email.nl", total_spent: 890, is_vip: true, no_show_count: 0, cancellation_count: 0 },
      { user_id: uid, name: "Noor van Dijk", phone: "+31623456789", email: "noor@email.nl", total_spent: 420, is_vip: false, no_show_count: 1, cancellation_count: 2 },
      { user_id: uid, name: "Emma de Boer", phone: "+31634567890", email: "emma@email.nl", total_spent: 1250, is_vip: true, no_show_count: 0, cancellation_count: 0 },
      { user_id: uid, name: "Sophie Bakker", phone: "+31645678901", email: "sophie@email.nl", total_spent: 180, is_vip: false, no_show_count: 2, cancellation_count: 1 },
      { user_id: uid, name: "Fleur Visser", phone: "+31656789012", email: "fleur@email.nl", total_spent: 650, is_vip: false, no_show_count: 0, cancellation_count: 0 },
      { user_id: uid, name: "Mila Smit", phone: "+31667890123", email: "mila@email.nl", total_spent: 320, is_vip: false, no_show_count: 0, cancellation_count: 1 },
      { user_id: uid, name: "Olivia de Vries", phone: "+31678901234", email: "olivia@email.nl", total_spent: 75, is_vip: false, no_show_count: 0, cancellation_count: 0 },
      { user_id: uid, name: "Julia Mulder", phone: "+31689012345", email: "julia@email.nl", total_spent: 2100, is_vip: true, no_show_count: 0, cancellation_count: 0 },
      { user_id: uid, name: "Familie De Groot", phone: "+31690123456", email: "degroot@email.nl", total_spent: 340, is_vip: false, no_show_count: 0, cancellation_count: 0, notes: "Komt vaak met kinderen" },
    ];
    const { data: customers } = await supabase.from("customers").insert(customersData).select("id, name");

    // Seed services - including medewerker-specific services
    // Medewerkers: Bas (heren/kinder), Roos (dames/kleuren), Lisa (allround), Emma (junior)
    const servicesData = [
      { user_id: uid, name: "Kinder knippen", duration_minutes: 20, price: 18.50, category: "Knippen", color: "#4ECDC4", description: "Medewerkers: Bas, Lisa, Emma" },
      { user_id: uid, name: "Heren knippen", duration_minutes: 30, price: 27.50, category: "Knippen", color: "#45B7D1", description: "Medewerkers: Bas, Lisa" },
      { user_id: uid, name: "Dames knippen", duration_minutes: 45, price: 52.50, category: "Knippen", color: "#7B61FF", description: "Medewerkers: Roos, Lisa" },
      { user_id: uid, name: "Kleuren", duration_minutes: 90, price: 89.00, category: "Kleur", color: "#C850C0", description: "Medewerkers: Roos, Lisa" },
      { user_id: uid, name: "Knippen + föhnen", duration_minutes: 60, price: 67.50, category: "Knippen", color: "#7B61FF", description: "Medewerkers: Roos, Lisa, Emma" },
      { user_id: uid, name: "Full balayage", duration_minutes: 180, price: 195.00, category: "Kleur", color: "#C850C0", description: "Medewerkers: Roos" },
      { user_id: uid, name: "Brow treatment", duration_minutes: 30, price: 35.00, category: "Wenkbrauwen", color: "#FF6B6B", description: "Medewerkers: Lisa, Emma" },
      { user_id: uid, name: "Lash lift", duration_minutes: 45, price: 55.00, category: "Wimpers", color: "#45B7D1", description: "Medewerkers: Lisa" },
      { user_id: uid, name: "BIAB behandeling", duration_minutes: 75, price: 65.00, category: "Nagels", color: "#FF6B6B", description: "Medewerkers: Emma" },
      { user_id: uid, name: "Manicure", duration_minutes: 45, price: 42.00, category: "Nagels", color: "#FF6B6B", description: "Medewerkers: Emma, Lisa" },
      { user_id: uid, name: "Heren baard trimmen", duration_minutes: 20, price: 15.00, category: "Baard", color: "#45B7D1", description: "Medewerkers: Bas" },
    ];
    const { data: services } = await supabase.from("services").insert(servicesData).select("id, name, price, duration_minutes");

    // Seed products
    await supabase.from("products").insert([
      { user_id: uid, name: "Shampoo Repair", category: "Haarverzorging", price: 24.95, stock: 18, description: "Herstellende shampoo voor beschadigd haar" },
      { user_id: uid, name: "Heat Protect Spray", category: "Styling", price: 19.50, stock: 25, description: "Beschermt haar tot 230°C" },
      { user_id: uid, name: "Nail Oil", category: "Nagelverzorging", price: 12.95, stock: 32, description: "Voedende nagelriemolie" },
      { user_id: uid, name: "Brow Serum", category: "Wenkbrauwen", price: 29.95, stock: 3, description: "Groeiserum voor vollere wenkbrauwen" },
      { user_id: uid, name: "Conditioner Moisture", category: "Haarverzorging", price: 22.50, stock: 20, description: "Intensief hydraterend" },
      { user_id: uid, name: "Curl Cream", category: "Styling", price: 18.95, stock: 2, description: "Definieert krullen zonder plakken" },
    ]);

    // Seed appointments with medewerker info in notes
    const today = new Date();
    const appointmentsData: any[] = [];
    const medewerkers = ["Bas", "Roos", "Lisa", "Emma"];

    if (customers && services) {
      for (let d = -14; d <= 14; d++) {
        const date = new Date(today);
        date.setDate(date.getDate() + d);
        if (date.getDay() === 0) continue;
        const numAppts = d === 0 ? 6 : Math.floor(Math.random() * 4) + 1;
        for (let a = 0; a < numAppts; a++) {
          const hour = 9 + a * 1.5;
          if (hour > 17) break;
          const h = Math.floor(hour);
          const m = (hour % 1) * 60;
          const cust = customers[Math.floor(Math.random() * customers.length)];
          const svc = services[Math.floor(Math.random() * services.length)];
          const emp = medewerkers[a % medewerkers.length];
          const status = d < 0 ? (Math.random() > 0.1 ? "voltooid" : "geannuleerd") : "gepland";
          const paid = status === "voltooid" || (d >= 0 && Math.random() > 0.5);
          appointmentsData.push({
            user_id: uid,
            customer_id: cust.id,
            service_id: svc.id,
            appointment_date: `${date.toISOString().split("T")[0]}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`,
            status,
            price: svc.price,
            payment_required: svc.price > 60,
            payment_status: paid ? "betaald" : status === "geannuleerd" ? "geannuleerd" : "none",
            deposit_amount: svc.price > 100 ? Math.round(svc.price * 0.5 * 100) / 100 : 0,
            amount_paid: paid ? svc.price : 0,
            notes: `Medewerker: ${emp}`,
          });
        }
      }
      const { data: insertedAppts } = await supabase.from("appointments").insert(appointmentsData).select("id, appointment_date, notes");

      // Create a demo group booking for today
      if (insertedAppts && insertedAppts.length > 0) {
        const todayAppts = insertedAppts.filter(a => a.appointment_date.startsWith(today.toISOString().split("T")[0]));
        if (todayAppts.length > 0) {
          const parentAppt = todayAppts[0];
          // Update parent to indicate group booking
          await supabase.from("appointments").update({ notes: "Groepsboeking: Familie De Groot | Medewerker: Bas" }).eq("id", parentAppt.id);

          // Add sub-appointments
          const kinderKnippen = services.find(s => s.name === "Kinder knippen");
          const damesKnippen = services.find(s => s.name === "Dames knippen");
          if (kinderKnippen && damesKnippen) {
            await supabase.from("sub_appointments").insert([
              {
                user_id: uid,
                parent_appointment_id: parentAppt.id,
                person_name: "Tim (kind)",
                service_id: kinderKnippen.id,
                price: kinderKnippen.price,
                status: "gepland",
                assignment_mode: "manual",
                notes: "Medewerker: Roos | Tijd: 09:30",
              },
              {
                user_id: uid,
                parent_appointment_id: parentAppt.id,
                person_name: "Moeder De Groot",
                service_id: damesKnippen.id,
                price: damesKnippen.price,
                status: "gepland",
                assignment_mode: "auto",
                notes: "Medewerker: Lisa | Tijd: 09:00 | ⚡ Automatisch geplaatst",
              },
            ]);
          }
        }
      }
    }

    // Seed campaigns
    await supabase.from("campaigns").insert([
      { user_id: uid, title: "Zomer actie 20% korting", type: "whatsapp", status: "verzonden", audience: "Alle klanten", sent_count: 45, message: "Geniet van 20% korting op alle behandelingen deze zomer! 🌞" },
      { user_id: uid, title: "Last-minute plekken vullen", type: "whatsapp", status: "concept", audience: "Inactieve klanten", sent_count: 0, message: "We hebben deze week nog plekken vrij, boek nu met 15% korting!" },
      { user_id: uid, title: "Nieuwsbrief juni", type: "email", status: "verzonden", audience: "VIP klanten", sent_count: 28, message: "Ontdek onze nieuwe behandelingen en producten!" },
    ]);

    // Seed discounts
    await supabase.from("discounts").insert([
      { user_id: uid, title: "Welkomstkorting", type: "percentage", value: 15, is_active: true },
      { user_id: uid, title: "Vriendinnenactie", type: "percentage", value: 10, is_active: true },
      { user_id: uid, title: "€10 korting bij herboeking", type: "fixed", value: 10, is_active: false },
    ]);

    // Seed rebook actions
    if (customers) {
      const rebookCustomers = customers.slice(2, 6);
      await supabase.from("rebook_actions").insert(rebookCustomers.map((c) => ({
        user_id: uid,
        customer_id: c.id,
        status: Math.random() > 0.5 ? "pending" : "sent",
        suggested_date: new Date(today.getTime() + Math.random() * 14 * 86400000).toISOString(),
      })));
    }

    // Seed feedback
    if (customers) {
      await supabase.from("feedback_entries").insert([
        { user_id: uid, customer_id: customers[0].id, rating: 5, comment: "Fantastisch resultaat, heel blij!" },
        { user_id: uid, customer_id: customers[2].id, rating: 5, comment: "Zoals altijd top service" },
        { user_id: uid, customer_id: customers[4].id, rating: 4, comment: "Mooi geworden, wachttijd was iets lang" },
        { user_id: uid, customer_id: customers[1].id, rating: 3, comment: "Kleur was net iets anders dan verwacht" },
      ]);
    }

    // Seed GlowPay payments
    if (customers && services) {
      const methods = ["ideal", "bancontact", "creditcard", "pin", "contant"];
      const paymentData: any[] = [];
      const paidAppts = appointmentsData.filter((a: any) => a.payment_status === "betaald");
      for (let i = 0; i < Math.min(paidAppts.length, 15); i++) {
        const a = paidAppts[i];
        const status = i < 12 ? "paid" : ["paid", "pending", "failed"][Math.floor(Math.random() * 3)];
        const method = methods[Math.floor(Math.random() * methods.length)];
        paymentData.push({
          user_id: uid,
          customer_id: a.customer_id,
          amount: a.price,
          currency: "EUR",
          payment_type: a.price > 100 ? "deposit" : "full",
          status,
          method,
          payment_method: method,
          provider: "glowpay",
          is_demo: true,
          paid_at: status === "paid" ? new Date().toISOString() : null,
        });
      }
      for (let i = 0; i < 5; i++) {
        const cust = customers[Math.floor(Math.random() * customers.length)];
        const amount = [24.95, 19.50, 42, 67.50, 89][i];
        paymentData.push({
          user_id: uid,
          customer_id: cust.id,
          amount,
          currency: "EUR",
          payment_type: "full",
          status: "paid",
          method: methods[Math.floor(Math.random() * methods.length)],
          payment_method: methods[Math.floor(Math.random() * methods.length)],
          provider: "glowpay",
          checkout_reference: `KASSA-${Date.now()}-${i}`,
          is_demo: true,
          paid_at: new Date().toISOString(),
        });
      }
      if (paymentData.length > 0) {
        await supabase.from("payments").insert(paymentData);
      }
    }

    // Seed automation rules
    await supabase.from("automation_rules").insert([
      { user_id: uid, trigger_type: "nieuwe_klant", action_type: "stuur_korting", is_active: true, config: { discount_percentage: 15 } },
      { user_id: uid, trigger_type: "no_show_risico", action_type: "stuur_betaalverzoek", is_active: true, config: { require_deposit: true } },
    ]);

    await supabase.from("profiles").update({ salon_name: "Studio Nova Amsterdam" }).eq("user_id", uid);

    return new Response(JSON.stringify({ success: true, message: "Demo data geladen!" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
