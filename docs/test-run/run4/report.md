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
1. MEDIUM, needs owner (api, report only): a failed send of an order to the Internal Sales Form is never retried unless N8N_MYFIFTY_URL is set in Vercel: api/cron.js resendOrders returns "n8n_not_connected" when it is empty, and orders now go through api/_isf.js when it is empty. The rep sees "Saved. It goes for approval as soon as the order connection answers", which would not happen. Also api/_isf.js send/token calls have no timeout and no once-only key, so adding retry without a key could create a duplicate order. Proposal: confirm the Vercel setting; if retry is wanted, add an idempotency key and a timeout to _isf first.
2. MEDIUM-LOW (api, fixed on run4-fixes e6d0f1f, not pushed): in api/_meta.js one lead the database refuses (garbled date, NUL character) aborted the whole pull and the bookmark never moved, so it blocked every later lead on every tick. Now skipped and counted.
3. LOW-MEDIUM (UI, FIXED and pushed 345456c): saypha Custom price with the box cleared made the line silently FREE (a sample order needing a medical director). Now refused with "Enter a price above $0".
4. LOW (UI, FIXED and pushed 8ab6d6b): the order bar rounded a custom price to whole dollars ($147.50 read $148).
5. LOW (api, fixed on run4-fixes e6d0f1f, not pushed): a key with a multi-byte character the same length as the real key made quo, intake and cron answer 500 instead of 401 (timingSafeEqual on different byte lengths). No access was given.
6. NEEDS OWNER (design vs rule): Candidates > "Ready to ask" shows an "Ask now" button; docs/test-run-rules.md (2026-10-20) says there is no Ask now button. Not changed.
7. NEEDS OWNER (stale tests on main, not from this run): test/db/data.test.js has 3 assertions that fail on main since today's rebuild or the real settings copy: the day goal (settings has 5, test expects 8) and two order/onboarding status shapes (the status now carries value, fill and steps). They fail without any run-4 change; the gate's known list does not include them, so the gate reads "NEW FAILURES" until they are updated or listed.
8. INFO: with three testers sharing v1, whole-suite runs time out at 2 minutes on about 30 db tests; run serially they pass. test/run/access.js is out of date (it queries a column v2 renamed). The Gmail line of prove-offline.js fails an assertion only because the connector wraps the block error.

## Fixes
- Pushed to main: 8ab6d6b, 345456c (each with a unit test in test/unit/lib.test.js that fails before and passes after). Unit suite 290/290; db files re-run serially pass apart from the known baseline and item 7.
- Local branch run4-fixes (NOT pushed): e6d0f1f (api keys and Meta), plus the probe tests and this report.

## Not covered (time and shared-database load)
Real-data screens beyond the two big books, Toronto-midnight and DST on the new screens, a 300-person book load test on the new Today, web-push device behaviour.
