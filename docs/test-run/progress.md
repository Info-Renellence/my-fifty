# My Fifty test run: progress (Wed 2026-10-21, 9:30 AM to 1:30 PM Toronto)

## Latest hour
**Time:** 9:45 AM (first 15 minutes)

**Covered:** set-up; proof that nothing can leave the computer except to the test database; the fake data; the coverage map;
the first pass over the business rules (who is a lead / candidate / Fifty, going cold, the day goal, Toronto time, today's list, rewards).

**New findings:**
- F1 (high) A wire-transfer order writes a "succeeded" payment row. The rules say never create a payment row for a wire order.
- F2 (medium) A person's saved app settings can end up as a list instead of a record (it has already happened to the info@ account in v2). After that, "Tomorrow" (hide until tomorrow) and the "joined your Fifty" moment silently stop working for that person.
- F3 (low) A cancelled visit counts as "reached": a lead with only a cancelled visit stops being a "new lead", and a visit cancelled today takes the person off today's list.
- F4 (low) If an order had a test payment before the real one, rewards count it on the test payment's date (could move a sale in or out of the Q4 Booster).

**Fixes:** none pushed yet (F1 to F4 next).

**Next:** fix F1 to F4 (one commit each, each with a test), then access between reps and admin-only data.

## Running totals
- Findings: 4 (high 1, medium 1, low 2). Fixed: 0.
- Coverage map: `docs/test-run/coverage.md`. Every scenario run: `docs/test-run/tried.md`.

## How the run is set up
- **Nothing leaves the computer.** Every test and the local server run with `test/run/no-network.js` preloaded. It refuses any
  connection except this computer and the Supabase v2 test database. Proof: `docs/test-run/offline-proof.txt` (Gemini, n8n,
  Google sign-in, Gmail, phone push, Quo, Meta and the live app were all refused; the database worked).
- **Test login.** The database login used for the run can read and write rows only. Two things it cannot do, so 10 of the 358
  existing automated tests cannot run with it (they are not app failures): creating Google sign-in accounts (5 tests about
  sign-in and the database's own access rules) and switching off database safety checks (3 tests that load and wipe the demo
  data, and 2 that depend on those). Those 10 were checked by reading instead, and replaced where possible by tests that need
  no special rights. Every other test passes.
- **Fake data** (stays in v2 for you to look at): 6 test users (`test.alpha` … `test.foxtrot` `@demo.invalid`: 4 reps,
  one admin, one switched-off rep), 325 fictional people and 164 orders, including fake Meta ad leads, Quo calls and texts,
  a pulled Gmail email, n8n-style order updates, a phone push subscription and a Gemini voice-note draft.
  `db/wipe-demo.sql` removes all of it (and the original demo data).
