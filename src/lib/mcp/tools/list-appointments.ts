import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_appointments",
  title: "Afspraken bekijken",
  description:
    "List appointments of the signed-in salon for a date or date range (YYYY-MM-DD), including customer, service and status.",
  inputSchema: {
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Start date, YYYY-MM-DD."),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("End date, YYYY-MM-DD. Defaults to the start date."),
    status: z.string().optional().describe("Optional status filter, e.g. gepland or geannuleerd."),
    limit: z.number().int().min(1).max(200).default(50),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from, to, status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Niet ingelogd." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("appointments")
      .select(
        "id, appointment_date, start_time, end_time, status, confirmation_status, price, payment_status, notes, customers(name, phone, email), services(name, duration_minutes)",
      )
      .gte("appointment_date", from)
      .lte("appointment_date", to ?? from)
      .order("appointment_date", { ascending: true })
      .order("start_time", { ascending: true })
      .limit(limit ?? 50);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { appointments: data ?? [], count: data?.length ?? 0 },
    };
  },
});
