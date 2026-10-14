import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  fetchIsvVerificationKey, handleIsv1799, parseIsv1799, isvEventKey, type EventStore,
} from "../../supabase/functions/_shared/isvWebhookCore";

const TX = "e18737eb-cb30-4064-9bc7-595a9fd651e4";
const MID = "41e4f587-c953-4b02-b3fe-8386c8d9f2ed";
const body = (over: any = {}) => JSON.stringify({
  EventTypeId: 1799, MessageId: "m1",
  EventData: { TransactionId: TX, OrderCode: 4261090033032676, MerchantId: MID, IsvFee: 0.35, CurrencyCode: "978", CardNumber: "4111********1111", ...over },
});
const ENV = { VIVA_ISV_CLIENT_ID: "isv-id", VIVA_ISV_CLIENT_SECRET: "isv-secret", VIVA_CLIENT_ID: "m-id", VIVA_CLIENT_SECRET: "m-secret" };

function memStore() {
  const rows = new Map<string, any>();
  const store: EventStore = { async insert(r) { const k = r.event_id as string; if (rows.has(k)) return "duplicate"; rows.set(k, r); return "inserted"; } };
  return { rows, store };
}

describe("ISV verification", () => {
  it("returns key from demo ISV endpoint using ISV credentials only", async () => {
    const calls: { url: string; auth: string }[] = [];
    const f = async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: String((init?.headers as any)?.Authorization) });
      if (url.endsWith("/connect/token")) return new Response(JSON.stringify({ access_token: "tok" }));
      return new Response(JSON.stringify({ key: "VERIFY" }));
    };
    expect(await fetchIsvVerificationKey(ENV, f as any)).toBe("VERIFY");
    expect(calls[0].url).toBe("https://demo-accounts.vivapayments.com/connect/token");
    expect(calls[0].auth).toBe(`Basic ${btoa("isv-id:isv-secret")}`);
    expect(calls[1].url).toBe("https://demo-api.vivapayments.com/isv/v1/webhooks/token");
  });
  it("uses production host only when VIVA_ENVIRONMENT=live", async () => {
    const urls: string[] = [];
    const f = async (url: string) => { urls.push(url); return new Response(JSON.stringify(url.endsWith("token") && urls.length === 1 ? { access_token: "t" } : { key: "K" })); };
    await fetchIsvVerificationKey({ ...ENV, VIVA_ENVIRONMENT: "live" }, f as any);
    expect(urls[1]).toBe("https://api.vivapayments.com/isv/v1/webhooks/token");
  });
  it("never falls back to merchant credentials", async () => {
    let called = false;
    const r = await fetchIsvVerificationKey({ VIVA_CLIENT_ID: "m", VIVA_CLIENT_SECRET: "s" }, (async () => { called = true; return new Response("{}"); }) as any);
    expect(r).toBeNull(); expect(called).toBe(false);
  });
  it("returns null without leaking on provider failure", async () => {
    const r = await fetchIsvVerificationKey(ENV, (async () => new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 })) as any);
    expect(r).toBeNull();
  });
});

describe("1799 POST handling", () => {
  it("stores one unverified event with whitelisted fields only", async () => {
    const { rows, store } = memStore();
    const r = await handleIsv1799(body(), "demo", store);
    expect(r.status).toBe(200);
    const row = rows.get(isvEventKey("demo", TX));
    expect(row.status).toBe("received_unverified");
    expect(row.processed).toBe(false);
    expect(row.raw_payload.verification).toBe("unverified");
    expect(row.raw_payload.reported_isv_fee).toBe(0.35);
    expect(JSON.stringify(row)).not.toContain("4111");
  });
  it("rejects invalid payloads", async () => {
    const { rows, store } = memStore();
    for (const b of ["not json", "[]", JSON.stringify({ EventTypeId: 1796, EventData: { TransactionId: TX } }),
      body({ TransactionId: "abc" }), body({ MerchantId: "x" }), body({ OrderCode: "12a" })]) {
      expect((await handleIsv1799(b, "demo", store)).status).toBe(400);
    }
    expect((await handleIsv1799("x".repeat(70_000), "demo", store)).status).toBe(413);
    expect(rows.size).toBe(0);
  });
  it("duplicate delivery is idempotent", async () => {
    const { rows, store } = memStore();
    await handleIsv1799(body(), "demo", store);
    expect((await handleIsv1799(body({ IsvFee: 9 }), "demo", store)).status).toBe(200);
    expect(rows.size).toBe(1);
    expect(rows.get(isvEventKey("demo", TX)).raw_payload.reported_isv_fee).toBe(0.35);
  });
  it("temporary storage error returns 503 so Viva retries", async () => {
    const r = await handleIsv1799(body(), "demo", { insert: async () => "error" });
    expect(r.status).toBe(503);
  });
  it("demo and live keys are separate", () => {
    expect(isvEventKey("demo", TX)).not.toBe(isvEventKey("live", TX));
  });
});

describe("no financial side effects / merchant webhook untouched", () => {
  const src = readFileSync("supabase/functions/viva-isv-webhook/index.ts", "utf8")
    + readFileSync("supabase/functions/_shared/isvWebhookCore.ts", "utf8");
  it("only writes viva_webhook_events", () => {
    const tables = [...src.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(["viva_webhook_events"]));
    for (const w of ["payments", "appointments", "payment_ledger", "refund", "record_platform_commission", ".rpc("]) {
      expect(src.includes(`"${w}"`) || src.includes(w === ".rpc(" ? w : `"${w}"`)).toBe(false);
    }
  });
  it("does not import or modify the merchant webhook", () => {
    expect(src).not.toContain("viva-webhook/");
    expect(src).not.toContain("VIVA_CLIENT_ID");
  });
});
