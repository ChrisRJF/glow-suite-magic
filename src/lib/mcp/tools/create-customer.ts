import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "create_customer",
  title: "Klant aanmaken",
  description: "Create a new customer record for the signed-in salon.",
  inputSchema: {
    name: z.string().trim().min(1).describe("Full name of the customer."),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().min(4).optional(),
    notes: z.string().trim().optional(),
    preferred_language: z.enum(["nl", "en", "de", "fr", "es"]).default("nl"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ name, email, phone, notes, preferred_language }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Niet ingelogd." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("customers")
      .insert({
        user_id: ctx.getUserId(),
        name,
        email: email ?? null,
        phone: phone ?? null,
        notes: notes ?? null,
        preferred_language: preferred_language ?? "nl",
      })
      .select("id, name, email, phone, preferred_language")
      .single();

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Klant aangemaakt: ${data.name} (${data.id})` }],
      structuredContent: { customer: data },
    };
  },
});
