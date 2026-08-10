import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "search_customers",
  title: "Klanten zoeken",
  description:
    "Search the salon's customers by name, email or phone. Returns loyalty, VIP status, no-show and cancellation counts.",
  inputSchema: {
    query: z.string().trim().min(1).describe("Search term matched against name, email and phone."),
    limit: z.number().int().min(1).max(50).default(10),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Niet ingelogd." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const term = query.replace(/[%,]/g, " ").trim();
    const { data, error } = await supabase
      .from("customers")
      .select(
        "id, name, email, phone, is_vip, loyalty_points, total_spent, no_show_count, cancellation_count, preferred_language",
      )
      .or(`name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`)
      .order("total_spent", { ascending: false })
      .limit(limit ?? 10);

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { customers: data ?? [], count: data?.length ?? 0 },
    };
  },
});
