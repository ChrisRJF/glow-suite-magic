// DISABLED (security): the legacy Twilio inbound handler had no sender
// authentication, matched customers across tenants and could create
// appointments and payment links from forged messages. It was never used.
// This stub performs no database reads/writes, sends nothing and logs no
// message content. A new, signature-verified receiver will replace it.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  console.log(JSON.stringify({ fn: "whatsapp-inbound", disabled: true, method: req.method }));
  return new Response(JSON.stringify({ error: "endpoint_disabled" }), {
    status: 410,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
