# Demo seed: link appointments to demo employees by ID (PROPOSED, not active)

Cause: `supabase/functions/seed-demo-data/index.ts` never inserts `employees` or
`appointment_employees`. It writes only `notes: "Medewerker: Bas|Roos|Lisa|Emma"`, so every
seeded appointment is unlinked by employee ID.

Proposed change (needs a separate GO, because editing the active function deploys it):
1. Upsert 4 demo employees for the demo tenant only (`is_demo = true`): Bas (heren/kinder),
   Roos (dames/kleuren), Lisa (allround), Emma (junior). Reuse an existing row with the same
   name and `is_demo = true`; never touch non-demo employees.
2. After inserting appointments, insert one `appointment_employees` row per appointment with
   `employee_id` = the demo employee's ID, `is_primary = true`, `is_demo = true`.
3. Keep the note text for history; the agenda reads only the ID link.
4. Only for salons in demo mode; never for real salons.

Existing rows are not changed by this patch.
