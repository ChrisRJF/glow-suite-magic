import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "revenue_summary",
  title: "Omzet samenvatting",
  description:
    "Summarize paid revenue of the salon over a date range: total amount, payment count and a breakdown per payment method.",
  inputSchema: {
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Start date, YYYY-MM-DD."),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("End date, YYYY-MM-DD (inclusive)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from, to }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Niet ingelogd." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("payments")
      .select("amount, currency, method, payment_method, status, paid_at, created_at")
      .eq("status", "paid")
      .gte("created_at", `${from}T00:00:00`)
      .lte("created_at", `${to}T23:59:59`)
      .limit(5000);

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const rows = data ?? [];
    const total = rows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
    const byMethod: Record<string, { count: number; amount: number }> = {};
    for (const r of rows) {
      const key = (r.payment_method || r.method || "onbekend") as string;
      byMethod[key] ??= { count: 0, amount: 0 };
      byMethod[key].count += 1;
      byMethod[key].amount += Number(r.amount ?? 0);
    }

    const summary = { from, to, total_amount: Number(total.toFixed(2)), payment_count: rows.length, by_method: byMethod };
    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      structuredContent: summary,
    };
  },
});
