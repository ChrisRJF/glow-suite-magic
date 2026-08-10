import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_services",
  title: "Behandelingen bekijken",
  description: "List the salon's treatments with duration, price and whether they are bookable online.",
  inputSchema: {
    only_active: z.boolean().default(true).describe("Only return active treatments."),
    limit: z.number().int().min(1).max(200).default(100),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ only_active, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Niet ingelogd." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("services")
      .select("id, name, category, duration_minutes, price, is_active, is_online_bookable, description")
      .order("name", { ascending: true })
      .limit(limit ?? 100);
    if (only_active !== false) query = query.eq("is_active", true);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { services: data ?? [], count: data?.length ?? 0 },
    };
  },
});
