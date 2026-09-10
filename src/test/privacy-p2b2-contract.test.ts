import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const privacy = readFileSync("supabase/functions/privacy-actions/index.ts", "utf8");
const retention = readFileSync("supabase/functions/privacy-retention/index.ts", "utf8");
const whatsapp = readFileSync("supabase/functions/whatsapp-send/index.ts", "utf8");

describe("P2b-2 privacy contracts", () => {
  it("requires typed confirmation for destructive actions", () => {
    expect(privacy).toContain('"VERWIJDER"');
    expect(privacy).toContain('"PSEUDONIMISEER"');
  });

  it("runs deletion preflight twice", () => {
    expect(privacy.match(/await preflight\(ctx, customerId\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("deletes only exact stored paths", () => {
    expect(privacy).toContain("remove([row.object_path])");
    expect(retention).toContain("remove([row.object_path])");
  });

  it("keeps retention behind a disabled server switch", () => {
    expect(retention).toContain('control_key", "retention_processing"');
    expect(retention).toContain('skipped: "kill_switch_off"');
  });

  it("blocks low-level WhatsApp transport", () => {
    expect(whatsapp).toContain("customer_communication_blocked");
    expect(whatsapp).toContain("communication_blocked_at");
  });

  it("never persists bearer links in privacy audit details", () => {
    expect(privacy).not.toMatch(/audit\([^\n]+download_url/);
    expect(privacy).not.toMatch(/audit\([^\n]+storage_path/);
  });
});