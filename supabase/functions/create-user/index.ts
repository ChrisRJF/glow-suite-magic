import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_ROLES = ["manager", "admin", "medewerker", "financieel", "receptie"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization");

    // Verify caller is authenticated
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Niet geautoriseerd" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Verify caller has 'eigenaar' role
    const { data: callerRoles } = await admin
      .from("user_roles").select("role").eq("user_id", user.id);
    const isOwner = (callerRoles || []).some((r: any) => r.role === "eigenaar");
    if (!isOwner) {
      return new Response(JSON.stringify({ error: "Alleen de eigenaar kan gebruikers aanmaken" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate input
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim().slice(0, 100);
    const email = String(body.email || "").trim().toLowerCase();
    const role = String(body.role || "");
    const password = String(body.password || "");

    if (!name) {
      return new Response(JSON.stringify({ error: "Naam is verplicht" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return new Response(JSON.stringify({ error: "Ongeldig e-mailadres" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!VALID_ROLES.includes(role)) {
      return new Response(JSON.stringify({ error: "Ongeldige rol" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (password.length < 8) {
      return new Response(JSON.stringify({ error: "Wachtwoord moet minimaal 8 tekens zijn" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create user with email confirmed (so they can log in immediately)
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, invited_by: user.id, invited_role: role },
    });
    if (createErr || !created.user) {
      return new Response(JSON.stringify({ error: createErr?.message || "Aanmaken mislukt" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Assign role (the trigger already gave them 'eigenaar' — remove it and assign requested role)
    await admin.from("user_roles").delete().eq("user_id", created.user.id);
    const { error: roleErr } = await admin.from("user_roles").insert({
      user_id: created.user.id, role,
    });
    if (roleErr) {
      return new Response(JSON.stringify({ error: "Gebruiker aangemaakt, rol toewijzen mislukt: " + roleErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin.from("profiles").upsert({ user_id: created.user.id, email, salon_name: name });
    await admin.from("user_access").upsert({
      owner_user_id: user.id,
      member_user_id: created.user.id,
      name,
      email,
      role,
      status: "active",
      is_demo: false,
    }, { onConflict: "owner_user_id,email" });
    await admin.from("audit_logs").insert({
      user_id: user.id,
      actor_user_id: user.id,
      action: "user_invited",
      target_type: "user",
      target_id: created.user.id,
      details: { email, role },
      is_demo: false,
    });

    return new Response(JSON.stringify({
      success: true,
      user: { id: created.user.id, email: created.user.email, name, role },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Onbekende fout" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
