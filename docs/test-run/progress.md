# My Fifty test run: progress (Wed 2026-10-21, 9:30 AM to 1:30 PM Toronto)

## Latest hour
**Time:** 11:05 AM

**Covered since 10:40:** the "joined your Fifty" moment (L5); random input against every read and write (1,500+ random
requests, no server errors); two reps adding the same person at once; sign-in rules; what the public website serves;
pushes to switched-off reps; the Ready-to-order list.

**New findings since 10:40 (7):**
- F16 (low) Adding a person (or a samples MD) whose email is still held by a removed person, or that another rep saved a moment earlier, gave a raw database error. **Fixed** bd55357 + 86be39f.
- F17 (medium, needs a check by you) Sign-in treats an @renellence.com email as verified unless Supabase explicitly says "not verified". If email-and-password sign-ups are open in Supabase without email confirmation, someone could sign up as a staff address and be let in as that person. Proposal: confirm Supabase sign-ups are closed (or confirmation is on), and require Supabase's "email confirmed" date in the code. Not changed (the older sign-in tests would need new fixtures, and the setting cannot be checked from here).
- F18 (medium) The public website served every file in the project: test scripts, SQL, the demo-data generator and these test-run notes (which describe security findings). **Fixed** 6b585cb (a .vercelignore; the app's own files are unchanged). Until it is pushed, those files stay public.
- F19 (medium, data) A switched-off rep would still get "New Instagram lead: <name>" pushes on their phone for leads still assigned to them. **Fixed** 2bf152c.
- F20 (low) The injector on a signed onboarding could order but was missing from the L9 "who is ordering" list. **Fixed** d23cf36.
- F21 (low) Any https address is accepted as a phone's push address, so the server can be made to call any website. Proposal: accept only the browsers' push services.
- F22 (medium, Phase 2) If n8n is down or refuses when an order is sent, the order is saved as "Waiting on approval" and nothing ever sends it again. The screen says it will go "once the connection is switched on", but no step does that. Proposal for the n8n branch.

**Questions added:** Q5 a lead with no source is in none of the four lead groups (only search finds it); Q6 a rep's email to
a client in another rep's book lands on that client's history (good for the client's story, but the other rep reads it).

**Pushing:** GitHub refused pushes from about 10:28 to 10:52 ("permission denied to yousefk07"); since 10:52 every commit is pushed.

**Also since 10:52:** F23 (medium) a candidate with a second sample order on the way showed "Not shipped" and left Today: **fixed** f558770. F24 (low) a note that is only a "Next:" line showed twice in History: **fixed** 09bfc62. Tried with fake n8n, Gemini and Gmail answering like the real services, and real taps through whole flows in the browser (add a person, order by wire, log a visit, undo, fillers, search): all fine. Q7: a rejected order disappears from the person's History without a word.

**Next:** keep going on deeper checks until 1:00 PM, then the full re-run and the final report.

## Running totals
- Findings: 24 (high 2, medium 10, low 12). Fixed: 19. Waiting on you: 4 proposals (F6, F17, F21, F22), 1 design question (F11) and questions Q1-Q7.
- Coverage map: `docs/test-run/coverage.md` (about 85% of boxes done). Every scenario run: `docs/test-run/tried.md`.
- Tests: all green except the 10 older tests that need rights the test login does not have (see below).

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
