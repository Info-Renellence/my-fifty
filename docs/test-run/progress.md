# My Fifty test run: progress (Wed 2026-10-21, 9:30 AM to 1:30 PM Toronto)

## Latest hour
**Time:** 11:35 AM

**Covered since 11:15:** the app left open on a phone; double taps on Undo; a 2,000-person book; the coverage map refreshed.

**New findings since 11:15:**
- F28 (medium) Screens could stay out of date while the app was left open: answers were kept until the rep saved
  something, so Today missed new leads and kept yesterday's list. **Fixed** 2b03eb5 (an answer is reused for one minute
  at most, and refreshed when the app comes back to the front).
- F29 (low) Tapping Undo twice showed "Something went wrong" next to "Undone". **Fixed** 8c48261.
- Two of the run's own tests were flaky (they counted pushes while a test rep's waiting leads were being pushed); made steady in 967ae7b.

**F6 raised to high, F17 lowered to low:** Supabase v2's public settings show sign-ups are open with Google sign-in on, so *anyone with any Google account* can sign in to Supabase directly and read the staff list (F6). Email-and-password sign-ups need email confirmation, so F17 is not open today.

**Draft final report:** written; it will be finished after the full re-run at 1:00 PM.

**Next:** a few more checks, then at 1:00 PM the full re-run of everything and the final report (`docs/test-run/report.md`).

## Running totals
- Findings: 28 (high 3, medium 10, low 15). Fixed: 23. Waiting on you: 4 proposals (F6, F17, F21, F22), 1 design question (F11), the wire-payment SOP conflict, and questions Q1-Q8.
- Coverage map: `docs/test-run/coverage.md` (about 85% of boxes done). Every scenario run: `docs/test-run/tried.md`.
- Tests: all green except the 10 older tests that need rights the test login does not have (see below).

## Earlier (11:05 to 11:15)
**Time:** 11:15 AM

**Covered since 11:05:** the data-model SOP compared with the app; sign-in screen; people with no clinic, email or phone;
the product picker's "Same as last order"; slow answers on the phone (search and moving between screens).

**New findings since 11:05:**
- **Decision needed (top of the list):** the data-model SOP (`renellence-edge/docs/data-model-sop.md`, Money section) says
  "Wire orders count as paid as soon as they're placed (a wire payment row is written then)", but the test-run rules say
  "Never create a payment row for a wire order". The run followed the test-run rules (fix d7af6a7 stays). If the SOP is
  right, revert d7af6a7 and the rules need changing.
- F20 withdrawn: the SOP says the onboarding's *primary* contact is the account that orders, so listing the injector on L9
  was the wrong fix; reverted (b7acbbe) and turned into question Q8 (the order screen still lets the injector order).
- F25 (medium) "Same as last order" copied a product that is no longer sold; Send then failed with "Something went wrong" and the rep could not remove the hidden line. **Fixed** 56cb30f.
- F26 (low) People search: a slow older answer could show after the rep cleared the box. **Fixed** 96aca0d.
- F27 (medium) On a slow connection, tapping a person and then another tab could leave the person's card on screen while the app was on the other tab. **Fixed** ee2d6e6.
- F11 detail: the MY FIFTY dots fill for people who do not exist below 5 (0 people: 5 dots, 1: 6, 3: 8, 4: 9, then 5 people: 5 dots).

## Earlier (10:40 to 11:05)
- F16 email held by a removed person (or saved a moment earlier by another rep) gave a database error: fixed bd55357, 86be39f. F17 sign-in trusts unverified emails unless told: proposal. F18 public site served tests, SQL and these notes: fixed 6b585cb. F19 pushes to a switched-off rep: fixed 2bf152c. F21 any https address accepted as a push address: proposal. F22 orders n8n refused are never resent: proposal. F23 candidate with a second sample order showed "Not shipped": fixed f558770. F24 "Next:"-only note shown twice: fixed 09bfc62. Random input (1,500+ requests) gave no server errors.

## Earlier (10:00 to 10:40)
- F9 voice context had other reps' clients: fixed 43621c4. F10 voice drafts capitalised saypha: fixed 8b26401. F11 empty book shows 5 dots: question. F12 reads at once hung on the pooler: fixed 7a8f60c. F13 quick Tomorrow taps lost: fixed eca5dfd. F14 syringe count included free items: fixed f1a1b86. F15 emails editable through the server: fixed 11c7fcc.

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
