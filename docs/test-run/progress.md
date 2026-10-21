# My Fifty test run: progress (Wed 2026-10-21, 9:30 AM to 1:30 PM Toronto)

## Latest hour
**Time:** 10:02 AM (first 30 minutes done)

**Covered this hour:** set-up and proof that nothing can leave the computer except to the test database; the fake data;
the coverage map; the business rules (lead / candidate / Fifty, every order status, going cold, the day goal and streak,
Toronto time across the clock changes, today's list, rewards including the last evening of the quarter); access between
two reps through the app (every read and every write); the database's own access rules; orders and money through the app;
logging, undo, Tomorrow, adding a person, follow-ups.

**New findings (8):**
- F1 (high) A wire-transfer order wrote a "succeeded" payment row; the rules say never. **Fixed** d7af6a7.
- F2 (medium) A person's saved app settings can end up as a list instead of a record (already happened to info@ in v2). After that, "Tomorrow" and the "joined your Fifty" moment silently stop working. **Fixed** 947fe3a (the app now repairs it on the next save).
- F3 (low) A cancelled visit counted as reaching someone: a lead stopped being "new", dropped off Today, and missed its new-lead push. **Fixed** e8245dd.
- F4 (low) Rewards could date an order by an earlier test payment instead of the real one (could move a sale in or out of the Q4 Booster). **Fixed** 0c4a279.
- F5 (low, security hygiene) Asking for an "op" or lead group named like a built-in (`constructor`, `__proto__`, `toString`…) gave odd answers or server errors instead of "unknown"; a `null` body crashed. No data leaked. **Fixed** 9d5c9a7.
- F6 (medium, needs your decision) The database rules let *any* signed-in Supabase account, even one not set up in My Fifty, read every staff row (names, emails, settings) and add clinics. Fixing it means changing database rules, which this run may not do: written up as a proposal.
- F7 (low) An order line over 999 was silently left off the order. **Fixed** 84843ab + 90ce4dc (the first commit broke one older test for about 5 minutes; the second put it right).
- F8 (low) A follow-up date that does not exist (e.g. Feb 30) caused a server error. **Fixed** 2b01efa.

**Access between reps:** 97 checks, no leaks. A rep cannot see or change another rep's people, orders, logs or follow-ups.

**Next:** the timer (new-lead pushes, morning summary, Gmail pull) with fake services and failures; Gemini voice notes;
Gmail send; phone push; then every screen at phone size.

## Running totals
- Findings: 8 (high 1, medium 2, low 5). Fixed: 7. Waiting on you: 1 (F6).
- Coverage map: `docs/test-run/coverage.md`. Every scenario run: `docs/test-run/tried.md`.
- Tests: all green except the 10 older tests that need rights the test login does not have (see below).

## How the run is set up
- **Nothing leaves the computer.** Every test and the local server run with `test/run/no-network.js` preloaded. It refuses any
  connection except this computer and the Supabase v2 test database. Proof: `docs/test-run/offline-proof.txt` (Gemini, n8n,
  Google sign-in, Gmail, phone push, Quo, Meta and the live app were all refused; the database worked).
- **Test login.** The database login used for the run can read and write rows only. Two things it cannot do, so 10 of the
  existing automated tests cannot run with it (they are not app failures): creating Google sign-in accounts (7 tests about
  sign-in and the database's own access rules) and switching off database safety checks (3 tests that load and wipe the
  demo data). Those were covered instead by new tests that need no special rights (`test/db/testrun-*.test.js`).
  The push check (`test/run/gate.sh`) runs everything and only lets those 10 through.
- **Pushing to GitHub** failed now and then with "authentication failed"; every commit was pushed on a later try.
- **Fake data** (stays in v2 for you to look at): 6 test users (`test.alpha` … `test.foxtrot` `@demo.invalid`: 4 reps,
  one admin, one switched-off rep), 325 fictional people and 164 orders, including fake Meta ad leads, Quo calls and texts,
  a pulled Gmail email, n8n-style order updates, a phone push subscription and a Gemini voice-note draft.
  `db/wipe-demo.sql` removes all of it (and the original demo data).
