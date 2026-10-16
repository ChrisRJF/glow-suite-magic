# Bestaande GlowPay ISV-integratie afronden

- Verbind boekingsaanbetalingen, auto-revenue, betaallinks en betaalwebhooks met de bestaande gedeelde ISV-code, zonder nieuwe betaalarchitectuur.
- Voeg service-only, atomische opslag toe voor idempotentie, fee-snapshots en refunds. Onzekere orderuitkomsten blijven vastgehouden voor reconciliatie, nooit automatisch opnieuw aangevraagd.
- Laat 8193/8194 en een periodieke refresh uitsluitend op basis van Viva-accountinformatie KYC/acquiringgeschiktheid bijwerken. Geen handmatige salon-goedkeuring.
- Test de verbonden routes met fictieve providerresultaten en deploy uitsluitend fail-closed code. Geen echte betaling, frontendpublicatie of Beautycare-klantwijzigingen.

## Technische grenzen
De bestaande LIVE_ISV_CHECKOUT_ENABLED-blokkering blijft uit zolang de exacte live checkout-URL en webhookcontracten niet aantoonbaar geverifieerd zijn. Rapporteer afzonderlijk wat gedeployed is, wat operationeel is en welke externe verificatie ontbreekt.
