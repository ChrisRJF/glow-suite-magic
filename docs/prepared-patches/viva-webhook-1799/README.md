# viva-webhook: event 1799 is not a refund (prepared, not active)

Problem: `supabase/functions/viva-webhook/index.ts` line 176 maps 1799 to "refunded".
Also, fixing only that line is not enough: a 1799 payload with StatusId "F" would then map to "paid".

Activation (separate GO, edits deploy automatically):

1. Line 176: change to `if (eventTypeId === 1798) return "refunded";` and add above line 175:
   `if (eventTypeId === 1799) return "pending";`
2. Directly after the event-log insert block (after line 329, before any payment lookup), add:

```ts
  if (eventTypeId === 1799) {
    // Transaction Price Calculated: fee info only. No payment, refund, ledger or appointment change.
    if (ledgerId) {
      await supabase.from("viva_webhook_events")
        .update({ processed: true, processed_at: new Date().toISOString(), error: "log_only_price_calculated" })
        .eq("id", ledgerId);
    }
    return okText();
  }
```

Repeated 1799 events hit the existing duplicate guard (line 320) or the same early return.
Logic reference + tests: `supabase/functions/_shared/inactive/vivaEventClassification.ts`, `tests/viva-isv/event-classification.test.ts`.
