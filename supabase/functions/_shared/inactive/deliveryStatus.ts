// INACTIVE. Delivery status state machine. Mirrors the proposed SQL
// (docs/proposed-migrations) so both can be tested against the same cases.
//
// Rules:
//  - sent < delivered < read (forward only).
//  - failed is NOT ranked above delivered/read. A failed callback after proven
//    delivery never overwrites it; it is counted separately as a failed attempt
//    and flagged as a conflict.
//  - delivered/read after failed upgrades the status (proof of delivery wins,
//    e.g. a provider retry succeeded).
//  - sent after failed keeps failed.
//  - duplicates are no-ops.

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";

export interface DeliveryState {
  status: DeliveryStatus | null;
  failedAttempts: number;
}

export interface Transition {
  next: DeliveryState;
  changed: boolean;
  conflict: boolean;
}

const RANK: Record<"sent" | "delivered" | "read", number> = { sent: 1, delivered: 2, read: 3 };
const proven = (s: DeliveryStatus | null) => s === "delivered" || s === "read";

export function nextDeliveryState(cur: DeliveryState, incoming: DeliveryStatus): Transition {
  if (incoming === "failed") {
    if (proven(cur.status)) {
      return { next: { ...cur, failedAttempts: cur.failedAttempts + 1 }, changed: true, conflict: true };
    }
    if (cur.status === "failed") return { next: cur, changed: false, conflict: false };
    return { next: { status: "failed", failedAttempts: cur.failedAttempts + 1 }, changed: true, conflict: false };
  }
  if (cur.status === "failed") {
    if (incoming === "sent") return { next: cur, changed: false, conflict: false };
    return { next: { ...cur, status: incoming }, changed: true, conflict: false };
  }
  const curRank = cur.status ? RANK[cur.status] : 0;
  if (RANK[incoming] > curRank) return { next: { ...cur, status: incoming }, changed: true, conflict: false };
  return { next: cur, changed: false, conflict: false };
}
