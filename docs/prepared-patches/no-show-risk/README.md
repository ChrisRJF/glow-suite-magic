# No-show risk: prepared only, NO-GO for active rollout

## Proven from repository, not a production-data audit
- `customers` exposes `no_show_count` and `cancellation_count`; only canonical cancellation incrementing was found. No maintained no-show counter write was established.
- `appointments` exposes status/date/time. Completed and no-show outcomes can be distinguished by explicit statuses, but a past date alone is not completion. `useCustomerIntelligence` currently also counts past non-cancelled appointments as completed: do not use that aggregate as evidence.
- There is no authoritative cancellation timestamp/classification in the appointment contract. `updated_at` and `confirmation_responded_at` do not prove cancellation timing. Four ordinary cancellations therefore contribute zero.
- `total_visits` is absent from generated customer types, despite the public-booking select requesting it. It is not used by this proposal. No query/schema changes made.

## Proposed indication, not a probability
Only complete, authoritative, tenant-scoped outcome history can populate `verifiedHistory`. Existing counters remain accepted for source compatibility but cannot establish risk. Missing/invalid history or fewer than two observed outcomes returns neutral flags, penalty zero and `hasSufficientData=false`, not proof that the person is low risk.

With C completed, N no-shows and L proven late cancellations:
`round(min(100, 30*N + min(40, 10*L), 100*(N + 0.5*L)/(C+N+L)))`.
Thresholds stay 20 medium / 50 high. No-shows weigh more; successful attendance reduces the indication; late cancellations alone cannot reach high. Timely/unclassified cancellations never contribute. Coefficients are an explainable product proposal, not statistically validated prediction.

## Prepared files and consumers
- `noShowRisk.ts` and `noShowRisk.backend.ts`: byte-identical candidates for the two existing engines.
- `usePaymentRules.ts` / `depositDecision.ts`: existing copies with only local candidate imports, optional trusted history and risk-triggered deposits limited to sufficient/high evidence. Other new-client/VIP/price rules stay unchanged.
- `revenueScoring.ts`: existing copy extended to accept optional history, exercising neutral ranking on missing evidence.
- `src/test/noshow-risk-prepared.test.ts`: synthetic formula, parity and downstream tests. Existing active engine contract and NoShowCenter tests remain unchanged.
- Existing consumers also include TodayAtAGlance, DailyCoach, NoShowCenter, CustomerValueIntel, customer intelligence, Dashboard, Customers, GlowSuiteAI and public-booking through depositDecision. Their existing return fields remain compatible. A rollout must clearly display insufficient evidence instead of presenting neutral fallback as a proven low-risk label.

## Why not active now
Editing a shared server function can automatically redeploy booking/deposit consumers. No isolated server deployment plus guaranteed atomic frontend/backend rollback is established in this run. Activating only the frontend would break parity and leave server-imposed deposits unchanged. Therefore neither active engine nor active caller was modified. The old cancellation risk remains in production and is NOT claimed fixed.

## Minimum next decision
Approve a synchronized rollout with tested restoration of both old engines/callers. First implement a server-derived, complete tenant/customer-scoped outcome adapter from existing explicit appointment statuses, with frontend using the same evidence basis. Until trustworthy history is available, leave it absent and risk-triggered adverse actions neutral. Late cancellations remain unused unless authoritative timing and an approved lateness boundary exist; never invent an interval, count or absence. No schema change is proposed. User payloads cannot provide authoritative history. No payments, automation, messages or scheduler activation is part of rollout.

This run performs no production reads/writes, deployments, customer changes or publication. Financial rules are out of scope.