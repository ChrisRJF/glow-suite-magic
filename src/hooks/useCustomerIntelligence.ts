import { useMemo } from "react";
import {
  useCustomers,
  useAppointments,
  useServices,
  useCampaigns,
  useCustomerMemberships,
} from "@/hooks/useSupabaseData";
import { usePayments } from "@/hooks/usePayments";
import type { Tables } from "@/integrations/supabase/types";

export type AITag =
  | "VIP"
  | "High spender"
  | "Loyal"
  | "Churn risk"
  | "No-show risk"
  | "Reactivatable"
  | "Follow-up needed"
  | "Membership candidate"
  | "Upsell candidate"
  | "Review candidate"
  | "New";

export interface CustomerIntelligence {
  customer: Tables<"customers">;
  appointments: Tables<"appointments">[];

  // value
  lifetimeValue: number;
  totalVisits: number;
  avgSpend: number;
  estimatedAnnualValue: number;
  bestMonth: string | null;

  // recency
  lastVisitDate: string | null;
  lastVisitDaysAgo: number;
  avgCycleDays: number;
  predictedNextVisitDate: string | null;

  // scores 0-100
  noShowRisk: number;
  churnRisk: number;
  loyaltyScore: number;
  rebookingLikelihood: number;
  campaignEngagement: number;
  whatsappEngagement: number;
  spendingScore: number;
  attendanceScore: number;

  // preferences
  preferredServiceId: string | null;
  preferredServiceName: string | null;
  preferredEmployeeId: string | null;
  preferredDays: number[]; // 0=Sun
  preferredTimeSlot: "ochtend" | "middag" | "avond" | null;

  // status
  membershipStatus: "active" | "paused" | "cancelled" | "none";
  isVip: boolean;
  isNew: boolean;

  // ai
  aiTags: AITag[];
  retentionTrend: "up" | "flat" | "down";
}

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));
const MONTHS_NL = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

function computeOne(args: {
  customer: Tables<"customers">;
  customerAppts: Tables<"appointments">[];
  services: Tables<"services">[];
  campaigns: Tables<"campaigns">[];
  memberships: Tables<"customer_memberships">[];
  payments: any[];
}): CustomerIntelligence {
  const { customer, customerAppts, services, campaigns, memberships, payments } = args;

  const active = customerAppts.filter((a) => a.status !== "geannuleerd");
  const completed = active.filter((a) => a.status === "voltooid" || new Date(a.appointment_date).getTime() < Date.now());
  const sorted = [...active].sort(
    (a, b) => new Date(b.appointment_date).getTime() - new Date(a.appointment_date).getTime()
  );
  const last = sorted[0];

  // value
  const lifetimeValue =
    Number(customer.total_spent) ||
    completed.reduce((s, a) => s + (Number(a.price) || 0), 0);
  const totalVisits = completed.length;
  const avgSpend = totalVisits > 0 ? lifetimeValue / totalVisits : 0;

  // recency
  const lastVisitDate = last?.appointment_date ?? null;
  const lastVisitDaysAgo = last
    ? Math.floor((Date.now() - new Date(last.appointment_date).getTime()) / 86400000)
    : 999;

  // cycle
  let avgCycleDays = 0;
  if (sorted.length >= 2) {
    const diffs: number[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      diffs.push(
        (new Date(sorted[i].appointment_date).getTime() -
          new Date(sorted[i + 1].appointment_date).getTime()) /
          86400000
      );
    }
    avgCycleDays = Math.round(diffs.reduce((s, d) => s + d, 0) / diffs.length);
  }

  const predictedNextVisitDate =
    avgCycleDays > 0 && lastVisitDate
      ? new Date(new Date(lastVisitDate).getTime() + avgCycleDays * 86400000).toISOString()
      : null;

  const estimatedAnnualValue =
    avgCycleDays > 0 ? Math.round((365 / avgCycleDays) * avgSpend) : Math.round(avgSpend * totalVisits);

  // preferred service
  const svcCounts: Record<string, number> = {};
  active.forEach((a) => {
    if (a.service_id) svcCounts[a.service_id] = (svcCounts[a.service_id] || 0) + 1;
  });
  const preferredServiceId =
    Object.entries(svcCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const preferredServiceName = preferredServiceId
    ? services.find((s) => s.id === preferredServiceId)?.name ?? null
    : null;

  // preferred employee
  const empCounts: Record<string, number> = {};
  active.forEach((a) => {
    if (a.employee_id) empCounts[a.employee_id] = (empCounts[a.employee_id] || 0) + 1;
  });
  const preferredEmployeeId =
    Object.entries(empCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // preferred days/times
  const dayCounts: Record<number, number> = {};
  const slotCounts: Record<string, number> = { ochtend: 0, middag: 0, avond: 0 };
  active.forEach((a) => {
    const d = new Date(a.appointment_date);
    dayCounts[d.getDay()] = (dayCounts[d.getDay()] || 0) + 1;
    const h = a.start_time ? parseInt(a.start_time.slice(0, 2), 10) : d.getHours();
    if (h < 12) slotCounts.ochtend++;
    else if (h < 17) slotCounts.middag++;
    else slotCounts.avond++;
  });
  const preferredDays = Object.entries(dayCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([d]) => Number(d));
  const topSlot = Object.entries(slotCounts).sort((a, b) => b[1] - a[1])[0];
  const preferredTimeSlot =
    topSlot && topSlot[1] > 0 ? (topSlot[0] as "ochtend" | "middag" | "avond") : null;

  // best month
  const monthCounts: Record<number, number> = {};
  completed.forEach((a) => {
    const m = new Date(a.appointment_date).getMonth();
    monthCounts[m] = (monthCounts[m] || 0) + Number(a.price || 0);
  });
  const bestMonthEntry = Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0];
  const bestMonth = bestMonthEntry ? MONTHS_NL[Number(bestMonthEntry[0])] : null;

  // membership
  const memb = memberships.find(
    (m) => m.customer_id === customer.id && (m.status === "active" || m.status === "paused")
  );
  const membershipStatus: CustomerIntelligence["membershipStatus"] = memb
    ? (memb.status as any)
    : "none";

  // scores
  const noShowCount = customer.no_show_count || 0;
  const cancelCount = customer.cancellation_count || 0;
  const noShowRisk = clamp(noShowCount * 30 + cancelCount * 15);
  const attendanceScore = clamp(100 - noShowRisk);

  // churn: more than 1.5x avg cycle, or no visit > 120d
  let churnRisk = 0;
  if (avgCycleDays > 0 && lastVisitDaysAgo > 0) {
    const ratio = lastVisitDaysAgo / avgCycleDays;
    if (ratio > 0.8) churnRisk = clamp(((ratio - 0.8) / 1.2) * 100);
  } else if (lastVisitDaysAgo > 120) {
    churnRisk = clamp(((lastVisitDaysAgo - 120) / 180) * 100 + 40);
  }
  if (totalVisits === 0) churnRisk = Math.max(churnRisk, 60);

  const loyaltyScore = clamp(
    Math.round(
      Math.min(totalVisits * 8, 60) +
        Math.min(lifetimeValue / 25, 30) +
        (customer.is_vip ? 10 : 0) -
        noShowRisk * 0.2
    )
  );

  const rebookingLikelihood = clamp(
    100 -
      churnRisk * 0.7 +
      (avgCycleDays > 0 && lastVisitDaysAgo > avgCycleDays * 0.7 && lastVisitDaysAgo < avgCycleDays * 1.4
        ? 30
        : 0) +
      (customer.is_vip ? 10 : 0)
  );

  const spendingScore = clamp(Math.round(Math.min(lifetimeValue / 10, 100)));

  // engagement (heuristic — campaigns sent count vs total customers is unknown per customer; use opt-in flags)
  const campaignEngagement = clamp(
    (customer.whatsapp_opt_in ? 40 : 0) +
      (customer.marketing_consent ? 30 : 0) +
      Math.min(totalVisits * 3, 30)
  );
  const whatsappEngagement = clamp(
    (customer.whatsapp_opt_in ? 60 : 0) + Math.min(totalVisits * 4, 40)
  );

  // retention trend: compare last 90d visits vs prior 90d
  const now = Date.now();
  const recent = completed.filter(
    (a) => now - new Date(a.appointment_date).getTime() < 90 * 86400000
  ).length;
  const prior = completed.filter((a) => {
    const t = now - new Date(a.appointment_date).getTime();
    return t >= 90 * 86400000 && t < 180 * 86400000;
  }).length;
  const retentionTrend: CustomerIntelligence["retentionTrend"] =
    recent > prior ? "up" : recent < prior ? "down" : "flat";

  // tags
  const isVip = customer.is_vip || (lifetimeValue > 500 && totalVisits >= 5);
  const isNew = totalVisits <= 2 && lastVisitDaysAgo < 90;
  const tags: AITag[] = [];
  if (isVip) tags.push("VIP");
  if (lifetimeValue > 750) tags.push("High spender");
  if (loyaltyScore >= 70) tags.push("Loyal");
  if (churnRisk >= 60) tags.push("Churn risk");
  if (noShowRisk >= 40) tags.push("No-show risk");
  if (lastVisitDaysAgo > 120 && totalVisits >= 2) tags.push("Reactivatable");
  if (
    avgCycleDays > 0 &&
    lastVisitDaysAgo > avgCycleDays * 0.8 &&
    lastVisitDaysAgo < avgCycleDays * 1.5
  )
    tags.push("Follow-up needed");
  if (membershipStatus === "none" && totalVisits >= 4 && avgCycleDays > 0 && avgCycleDays < 60)
    tags.push("Membership candidate");
  if (totalVisits >= 3 && avgSpend > 0) tags.push("Upsell candidate");
  if (totalVisits >= 1 && lastVisitDaysAgo < 14) tags.push("Review candidate");
  if (isNew) tags.push("New");

  return {
    customer,
    appointments: sorted,
    lifetimeValue,
    totalVisits,
    avgSpend,
    estimatedAnnualValue,
    bestMonth,
    lastVisitDate,
    lastVisitDaysAgo,
    avgCycleDays,
    predictedNextVisitDate,
    noShowRisk,
    churnRisk,
    loyaltyScore,
    rebookingLikelihood,
    campaignEngagement,
    whatsappEngagement,
    spendingScore,
    attendanceScore,
    preferredServiceId,
    preferredServiceName,
    preferredEmployeeId,
    preferredDays,
    preferredTimeSlot,
    membershipStatus,
    isVip,
    isNew,
    aiTags: tags,
    retentionTrend,
  };
}

export function useCustomerIntelligence() {
  const { data: customers, loading: lc } = useCustomers();
  const { data: appointments, loading: la } = useAppointments();
  const { data: services } = useServices();
  const { data: campaigns } = useCampaigns();
  const { data: memberships } = useCustomerMemberships();
  const { data: payments } = usePayments();

  const byCustomer = useMemo(() => {
    const map = new Map<string, Tables<"appointments">[]>();
    (appointments as Tables<"appointments">[]).forEach((a) => {
      if (!a.customer_id) return;
      const list = map.get(a.customer_id) ?? [];
      list.push(a);
      map.set(a.customer_id, list);
    });
    return map;
  }, [appointments]);

  const intelligence = useMemo<CustomerIntelligence[]>(() => {
    return (customers as Tables<"customers">[]).map((c) =>
      computeOne({
        customer: c,
        customerAppts: byCustomer.get(c.id) ?? [],
        services: services as Tables<"services">[],
        campaigns: campaigns as Tables<"campaigns">[],
        memberships: memberships as Tables<"customer_memberships">[],
        payments: payments as any[],
      })
    );
  }, [customers, byCustomer, services, campaigns, memberships, payments]);

  const byId = useMemo(() => {
    const m = new Map<string, CustomerIntelligence>();
    intelligence.forEach((i) => m.set(i.customer.id, i));
    return m;
  }, [intelligence]);

  // segments
  const segments = useMemo(() => {
    const has = (i: CustomerIntelligence, t: AITag) => i.aiTags.includes(t);
    const groups: { key: string; label: string; description: string; items: CustomerIntelligence[]; potential: number }[] = [
      {
        key: "vip",
        label: "VIP klanten",
        description: "Top loyale spenders",
        items: intelligence.filter((i) => has(i, "VIP")),
        potential: 0,
      },
      {
        key: "churn",
        label: "Risico klanten",
        description: "Dreigen af te haken",
        items: intelligence.filter((i) => has(i, "Churn risk")),
        potential: 0,
      },
      {
        key: "noshow",
        label: "No-show risico",
        description: "Hoog risico op niet komen opdagen",
        items: intelligence.filter((i) => has(i, "No-show risk")),
        potential: 0,
      },
      {
        key: "new",
        label: "Nieuwe klanten",
        description: "Minder dan 3 bezoeken",
        items: intelligence.filter((i) => has(i, "New")),
        potential: 0,
      },
      {
        key: "top",
        label: "Top spenders",
        description: "Lifetime value > €750",
        items: intelligence.filter((i) => has(i, "High spender")),
        potential: 0,
      },
      {
        key: "reactivate",
        label: "Stilgevallen klanten",
        description: "Te heractiveren",
        items: intelligence.filter((i) => has(i, "Reactivatable")),
        potential: 0,
      },
      {
        key: "membership",
        label: "Membership kansen",
        description: "Frequente bezoekers zonder abonnement",
        items: intelligence.filter((i) => has(i, "Membership candidate")),
        potential: 0,
      },
      {
        key: "upsell",
        label: "Upsell kansen",
        description: "Geschikt voor aanvullende behandelingen",
        items: intelligence.filter((i) => has(i, "Upsell candidate")),
        potential: 0,
      },
      {
        key: "loyal",
        label: "Trouwe klanten",
        description: "Hoge loyalty score",
        items: intelligence.filter((i) => has(i, "Loyal")),
        potential: 0,
      },
    ];
    groups.forEach((g) => {
      g.potential = Math.round(
        g.items.reduce((s, i) => s + Math.max(i.avgSpend, 0), 0)
      );
    });
    return groups;
  }, [intelligence]);

  return {
    intelligence,
    byId,
    segments,
    loading: lc || la,
  };
}
