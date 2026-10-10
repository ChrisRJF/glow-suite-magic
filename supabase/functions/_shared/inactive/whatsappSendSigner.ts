// INACTIVE (Send Security 1.0). Signing helper for the internal callers of the future whatsapp-send.
// Callers must send `rawBody` byte-for-byte as signed. Not imported by any active entrypoint.

import { SEND_METHOD, SEND_PATH, signingString, type ServiceCaller } from "./whatsappSendGuard.ts";
import { hmacHex, sha256Hex } from "./whatsappSendAdapters.ts";

export async function signServiceRequest(caller: ServiceCaller, keyId: string, key: Uint8Array, rawBody: string,
  nowMs = Date.now(), nonce = randomNonce()): Promise<Record<string, string>> {
  const ts = String(Math.floor(nowMs / 1000));
  const sig = await hmacHex(key, signingString(SEND_METHOD, SEND_PATH, caller, keyId, ts, nonce, await sha256Hex(rawBody)));
  return { "Content-Type": "application/json", "x-wa-caller": caller, "x-wa-key-id": keyId,
    "x-wa-timestamp": ts, "x-wa-nonce": nonce, "x-wa-signature": sig };
}

export function randomNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}
