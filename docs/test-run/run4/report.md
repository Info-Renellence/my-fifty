# Run 4, Lane B (Pulse, new dark UI), 2026-10-27

Database: v1 only (a copy of today's real data). v2 never touched (every server and test checked; v1 outbound log still ends 2026-10-20 16:27).
Every outside service was refused by the network guard or answered by a stubbed fetch. No real names, emails or phones are in this file.

## What was tested
- The five new-today features at phone size (390 px) on a fictional rep's book: Today My Fifty tile to /people/fifty; the "+" on product rows; Review > Edit in place (tap a line, change quantity, Add a product, Done, remove every line); tap your initials > Sign out sheet (Cancel, dim tap, double tap); saypha price options 135 / 155 / list / Custom. Script: test/run/cdp-run4.js (scenarios new, custom0, flow4, me).
- Real books at phone size: a rep with the biggest book, an admin, 25 random-tap steps on 5 screens (no page error, no overflow, no console error).
- Rep against rep on all five real reps after today's rebuild (test/r3b/access.test.js): nothing of another book, read or write. Pass.
- Logging a visit (reached, typed note) moves the day count and Undo takes it back; a one-character note will not save; a card-on-file order sends and shows its status.
- Connectors with stubbed replies: test/db/run4-connectors.test.js, run4-connectors2.test.js (on branch run4-fixes): Meta feed, Quo odd events, keys, Internal Sales Form payload and send, Resend pay link, SignatureAPI list/refresh/remind, Gmail send, the timer called directly.

## Findings (by severity)
1. MEDIUM (api, FIXED on run4-fixes 59a1789, not pushed; owner must decide): a failed send of an order to the Internal Sales Form is never retried unless N8N_MYFIFTY_URL is set in Vercel: api/cron.js resendOrders returns "n8n_not_connected" when it is empty, and orders now go through api/_isf.js when it is empty. The rep sees "Saved. It goes for approval as soon as the order connection answers", which would not happen. Also api/_isf.js send/token calls have no timeout and no once-only key, so adding retry without a key could create a duplicate order. Owner confirmed N8N_MYFIFTY_URL is not set. Fix: the timer now retries through _isf.js with X-Idempotency-Key order:<id> and 15 s / 25 s timeouts, only for orders Pulse placed (their create entry in change_logs has source my_fifty; Edge's orders are left alone). DOUBLE-SEND RISK: if the sales form accepted an order but the answer was lost (timeout), the retry sends it again; the key only helps if the n8n workflow honours X-Idempotency-Key. Check the workflow before pushing. The first tick after deploy may also retry any Pulse order still 'submitted' from the last 7 days with no 'send' entry.
2. MEDIUM-LOW (api, fixed on run4-fixes e6d0f1f, not pushed): in api/_meta.js one lead the database refuses (garbled date, NUL character) aborted the whole pull and the bookmark never moved, so it blocked every later lead on every tick. Now skipped and counted.
3. LOW-MEDIUM (UI, FIXED and pushed 345456c): saypha Custom price with the box cleared made the line silently FREE (a sample order needing a medical director). Now refused with "Enter a price above $0".
4. LOW (UI, FIXED and pushed 8ab6d6b): the order bar rounded a custom price to whole dollars ($147.50 read $148).
5. LOW (api, fixed on run4-fixes e6d0f1f, not pushed): a key with a multi-byte character the same length as the real key made quo, intake and cron answer 500 instead of 401 (timingSafeEqual on different byte lengths). No access was given.
6. NEEDS OWNER (design vs rule): Candidates > "Ready to ask" shows an "Ask now" button; docs/test-run-rules.md (2026-10-20) says there is no Ask now button. Not changed.
7. NEEDS OWNER (stale tests on main, not from this run): test/db/data.test.js has 3 assertions that fail on main since today's rebuild or the real settings copy: the day goal (settings has 5, test expects 8) and two order/onboarding status shapes (the status now carries value, fill and steps). They fail without any run-4 change; the gate's known list does not include them, so the gate reads "NEW FAILURES" until they are updated or listed.
8. INFO: with three testers sharing v1, whole-suite runs time out at 2 minutes on about 30 db tests; run serially they pass. test/run/access.js is out of date (it queries a column v2 renamed). The Gmail line of prove-offline.js fails an assertion only because the connector wraps the block error.

9. MEDIUM (api, from Lane A, FIXED on run4-fixes fec65e9, not pushed): api/intake.js dropped the third of an A, B, A change as a duplicate because the duplicate key had no time. HubSpot's modified time (updatedAt / hs_lastmodifieddate / lastmodifieddate) is now part of the key; an exact repeat is still a duplicate. Side effect: replaying an old copy that carries a time makes one new key, so it applies once more.
10. MEDIUM (stale test, on main): test/run/smoke-rollback.js fails 3 checks on main ("goal 8" because settings holds 5, "added by you / Taylor", "moved to you"), so the gate's smoke step cannot pass for any push until they are updated.
11. LOW (UI): a person or order id that does not exist shows "Something went wrong. Try again." instead of a not-found message.
12. INFO: through the API a double tap on Log makes two logs (the screen's busy flag and Undo are the guard); same as the order double submit noted in run 3.

## More tested after the first report
- Toronto midnight and the Nov 1 clock change on the day count and streak (test/db/run4-dst-day.test.js): pass.
- A 300-person book: Today 1.5 s, People 0.5 s, 10 parallel Today reads fine; every screen at phone size, no overflow or error.
- Pulse and Edge writing one contact at once plus double taps (test/run/race-r4.js, committed fake rows): no deadlock or error, each field one whole value, an Edge copy changes only the field it changed.
- Fuzz of order prices, quantities, lines and push subscriptions (test/db/run4-fuzz.test.js): no 500, no junk line saved; fake push subscriptions: junk refused, a good one saved.
- Route injection in the address bar (script tags, ../, //host): nothing runs, falls back to Today.
- 146 real contacts (every 10th) through person and history as an admin: no 500, no "undefined".
- Final serial full run (one file at a time, 599 tests): 14 failures = the known baseline (first sign-in, 5 schema, 4 seed, wire digest, unknown-op) plus the 4 stale data.test.js ones above; all run-4 tests pass. Smoke: 30 passed, 3 failed (item 10).

## Fixes
- Pushed to main: 8ab6d6b, 345456c (each with a unit test in test/unit/lib.test.js that fails before and passes after). Unit suite 290/290; db files re-run serially pass apart from the known baseline and item 7.
- Local branch run4-fixes (NOT pushed): e6d0f1f (keys, Meta), fec65e9 (intake A,B,A), 59a1789 (order retry via the sales form), plus the probe tests and this report.
- Gate rule used for the earlier pushes: unit suite 290/290 and the db files re-run one at a time; the whole-suite timeouts came from three testers sharing v1. No further push to main was made.

## Not covered
A real push device (only fake subscriptions), Pulse against a live n8n workflow, Compass/Edge screens (Lane A).
