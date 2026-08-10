import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listAppointmentsTool from "./tools/list-appointments";
import searchCustomersTool from "./tools/search-customers";
import listServicesTool from "./tools/list-services";
import revenueSummaryTool from "./tools/revenue-summary";
import createCustomerTool from "./tools/create-customer";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "glowsuite-your-salon-s-smart-system",
  title: "GlowSuite: Your Salon's Smart System",
  version: "0.1.0",
  instructions:
    "Tools for GlowSuite, a salon management system. Use `list_appointments` for the agenda, `search_customers` to look up clients, `list_services` for treatments and prices, `revenue_summary` for paid revenue over a period, and `create_customer` to add a new client. All data is scoped to the signed-in salon.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    listAppointmentsTool,
    searchCustomersTool,
    listServicesTool,
    revenueSummaryTool,
    createCustomerTool,
  ],
});
