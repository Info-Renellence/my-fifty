# My Fifty test run: progress (Wed 2026-10-21, 9:30 AM to 1:30 PM Toronto)

## Latest hour
**Time:** 10:40 AM

**Covered since 10:00:** the timer with fake services (and failing ones); Gemini voice notes; every screen at phone size
for four test people (one of everything, an empty book, 300 people, an admin); speed with 300 people; two things at once
(several taps, several phones); the rewards screen checked by hand.

**New findings since 10:00 (7):**
- F9 (medium, data between reps) Voice notes sent Gemini the names of *other reps'* clients at the same clinic (to help spelling). **Fixed** 43621c4.
- F10 (low) Voice-note drafts kept "Saypha Lips" if the AI wrote it that way. **Fixed** 8b26401 (always "saypha lips").
- F11 (low, needs your decision) With nobody in My Fifty yet, the MY FIFTY tile on Today shows 5 filled dots. An older test says this is intended, so it was not changed.
- F12 (high) When several requests reach the same server at once, some database reads never answer (they would hang until the 60-second limit). Cause: queries with no values in them stall on Supabase's connection pooler. **Fixed** 7a8f60c (every query now carries a value). This could have looked like "the app is stuck" on a busy morning.
- F13 (low) Tapping "Tomorrow" on several people quickly (or on two phones) kept only the last one. **Fixed** eca5dfd.
- F14 (medium, money screen) "saypha syringes this month" counted free headbands, ice packs, lip balms and fact sheets. **Fixed** f1a1b86 (paid lines only).
- F15 (low) The server let a rep rewrite the text of a sent or pulled email in History (the screen never offered it). **Fixed** 11c7fcc.

**Questions for you (not changed):** Q2 "Same as last order" copies the newest order even if it is not paid yet;
Q3 someone whose only order is unpaid (not samples) shows as a Lead, but the rule says a lead has no orders at all;
Q4 "Resend pay link" has no once-an-hour limit (Remind MD has one).

**Pushing:** GitHub has refused pushes since about 10:28 ("permission denied to yousefk07": the computer's saved GitHub
login seems to switch to another account). Commits F12 to F15 are saved locally and will be pushed as soon as it works.

**Next:** deeper checks: random input against every write, more two-reps-at-once cases, the L5 "joined your Fifty" moment,
sign-in rules; then the full re-run at 1:00 PM and the final report.

## Running totals
- Findings: 15 (high 2, medium 4, low 9). Fixed: 13. Waiting on you: 2 (F6 database rule, F11 dots) + questions Q1-Q4.
- Coverage map: `docs/test-run/coverage.md` (about 85% of boxes done). Every scenario run: `docs/test-run/tried.md`.
- Tests: all green except the 10 older tests that need rights the test login does not have (see below).

## Earlier (9:30 to 10:00)
- F1 (high) wire order wrote a payment row: fixed d7af6a7. F2 (medium) settings saved as a list broke Tomorrow and the
  joined-your-Fifty moment: fixed 947fe3a. F3 (low) cancelled visit counted as a touch: fixed e8245dd. F4 (low) test
  payment date used for rewards: fixed 0c4a279. F5 (low) built-in names as ops: fixed 9d5c9a7. F6 (medium) database rules
  let any signed-in Supabase account read the staff list and add clinics: proposal. F7 (low) order line over 999 dropped
  silently: fixed 84843ab + 90ce4dc. F8 (low) impossible follow-up date gave a server error: fixed 2b01efa.
- Access between reps: 97 checks through the app, no leaks.

## How the run is set up
- **Nothing leaves the computer.** Every test and the local server run with `test/run/no-network.js` preloaded. It refuses any
  connection except this computer and the Supabase v2 test database. Proof: `docs/test-run/offline-proof.txt`. The browser
  used for screenshots refuses everything except the local server too (it only ever tried Google Fonts).
- **Test login.** The database login can read and write rows only, so 10 older tests cannot run with it (7 need Google
  sign-in accounts, 3 load and wipe the demo data). They are not app failures; new tests that need no special rights cover
  the same ground (`test/db/testrun-*.test.js`). `test/run/gate.sh` runs everything and only lets those 10 through.
- **Fake data** (stays in v2): 6 test users `test.alpha` … `test.foxtrot` `@demo.invalid` (4 reps, an admin, a switched-off
  rep), 325 fictional people, 164 orders, fake Meta ad leads, Quo calls and texts, a pulled Gmail email, n8n-style order
  updates, a phone push subscription and a Gemini voice-note draft. `db/wipe-demo.sql` removes all of it.
