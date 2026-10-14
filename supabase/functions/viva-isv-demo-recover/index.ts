// ONE-TIME recovery for a single ISV demo payment. Deleted after use.
// Hardcoded targets; no request input is used. Same verification as viva-webhook.
import { createClient } from "npm:@supabase/supabase-js@2";
import { confirmIsvDemoPayment } from "../_shared/isvDemoConfirm.ts";

const ORDER_CODE = "4261090033032676";
const TRANSACTION_ID = "e18737eb-cb30-4064-9bc7-595a9fd651e4";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405 });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data, error } = await supabase.from("payments").select("id,status,is_demo,payment_type,viva_merchant_id,metadata")
    .eq("is_demo", true).eq("payment_type", "isv_demo").eq("metadata->>viva_order_code", ORDER_CODE);
  if (error || !data || data.length !== 1) return new Response(JSON.stringify({ result: "rejected", reason: "payment_not_unique" }), { status: 200 });
  const r = await confirmIsvDemoPayment(supabase, Deno.env.toObject(), data[0] as any, TRANSACTION_ID, null);
  console.log("[viva-isv-demo-recover]", JSON.stringify(r));
  return new Response(JSON.stringify(r), { status: 200, headers: { "Content-Type": "application/json" } });
});
