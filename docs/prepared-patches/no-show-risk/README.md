# No-show risk: prepared only, NO-GO for active rollout

## Proven from repository and read-only schema inspection
- `customers` exposes `no_show_count` and `cancellation_count`; only canonical cancellation incrementing was found. No maintained no-show counter write was established.
- `appointments` exposes status/date/time. Completed and no-show outcomes can be distinguished by explicit statuses, but a past date alone is not completion. `useCustomerIntelligence` currently also counts past non-cancelled appointments as completed: do not use that aggregate as evidence.
- There is no authoritative cancellation timestamp/classification in the appointment contract. `updated_at` and `confirmation_responded_at` do not prove cancellation timing. Four ordinary cancellations therefore contribute zero.
- `total_visits` is absent from generated customer types, despite the public-booking select requesting it. It is not used by this proposal. No query/schema changes made.
- Live schema confirms status/created_at/updated_at and the two counters, but no cancellation/completion timestamp or total_visits. Live trigger definitions show updated_at changes on any update, not just cancellation; no customer-counter maintenance or complete appointment-status journal was found in those triggers. `payment_status_history` is payment-only. Canonical cancellation audit logging is best-effort, so general audit_logs is not a complete history. No customer or appointment rows were read.

## Proposed indication, not a probability
Only complete, authoritative, tenant-scoped outcome history can populate `verifiedHistory`. Existing counters remain accepted for source compatibility but cannot establish risk. Missing/invalid history or fewer than two observed outcomes returns neutral flags, penalty zero and `hasSufficientData=false`, not proof that the person is low risk.

With C completed, N no-shows and L proven late cancellations:
`round(min(100, 30*N + min(40, 10*L), 100*(N + 0.5*L)/(C+N+L)))`.
Thresholds stay 20 medium / 50 high. No-shows weigh more; successful attendance reduces the indication; late cancellations alone cannot reach high. Timely/unclassified cancellations never contribute. Coefficients are an explainable product proposal, not statistically validated prediction.

## Prepared files and consumers
- `noShowRisk.ts` and `noShowRisk.backend.ts`: byte-identical candidates for the two existing engines.
- `usePaymentRules.ts` / `depositDecision.ts`: existing copies with only local candidate imports, optional trusted history and risk-triggered deposits limited to sufficient/high evidence. Other new-client/VIP/price rules stay unchanged.
- `revenueScoring.ts`: existing copy extended to accept optional history, exercising neutral ranking on missing evidence.
- `appointmentRiskHistory.ts`: complete, paged, tenant/customer-scoped current-outcome adapter; explicit recognized completion/no-show statuses only. Foreign/duplicate rows, missing counts, failed/truncated reads and changing totals produce absent evidence. Dates/audit/customer counters are never used; lateCancellations always zero.
- `useCustomerRiskHistory.ts`: prepared frontend RLS loader enriching existing customer objects, preserving neutral fallback during loading/errors/account changes. No provider calls or writes.
- `activation.patch`: prepared engine/deposit/scoring replacements plus public-booking server reload, central frontend customer enrichment and AutoRevenue history forwarding. `rollback.patch` is the generated reverse diff. Neither patch was applied. The platform rejected the attempted isolated git-apply check; exact application/reversal is therefore NOT verified. No alternative bypass was attempted.
- `src/test/noshow-risk-prepared.test.ts`: synthetic formula, parity and downstream tests. Existing active engine contract and NoShowCenter tests remain unchanged.
- Existing consumers also include TodayAtAGlance, DailyCoach, NoShowCenter, CustomerValueIntel, customer intelligence, Dashboard, Customers, GlowSuiteAI and public-booking through depositDecision. Their existing return fields remain compatible. A rollout must clearly display insufficient evidence instead of presenting neutral fallback as a proven low-risk label.

## Why not active now
Editing a shared server function can automatically redeploy booking/deposit consumers. No isolated server deployment plus guaranteed atomic frontend/backend rollback is established in this run. Activating only the frontend would break parity and leave server-imposed deposits unchanged. Therefore neither active engine nor active caller was modified. The old cancellation risk remains in production and is NOT claimed fixed.

## Minimum next decision
The status-based adapter and integration patch are now prepared. The remaining blocker is a controlled, separately approved backend deployment with verified restoration: active function edits automatically deploy and the platform rejected the isolated patch-application check. Separate owner GO must permit that controlled deployment, with application/type validation and supported rollback established before live edits. No schema/customer-write prerequisite remains. Until complete reads succeed, evidence remains absent and risk-triggered adverse actions neutral. Current database statuses are recorded outcomes, not externally authenticated attendance facts; the adapter does not invent missing no-shows. Paged reads detect changed counts/duplicates but are not a transaction snapshot and cannot prove no concurrent status mutation. Late cancellations remain unused because authoritative timing is absent. No schema change is proposed. User payloads cannot provide authoritative history. No payments, automation, messages or scheduler activation is part of rollout.

This follow-up reads schema/trigger definitions only, never customer data; no writes, deployments or publication. Financial rules are out of scope. Active formula remains unchanged until deployment GO; this preparation does not claim production risk is fixed. Minimum-data status display should be reviewed during approved rollout; the numeric fallback alone must not be called verified low risk.

Validation: 90 tests passed (13 appointment-source tests, 22 prepared formula/downstream tests, 54 existing active parity tests, one NoShowCenter regression). Activation patch spans 11 paths, all unapplied. No active integration/typecheck or live flow is claimed tested.