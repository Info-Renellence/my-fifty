# My Fifty test run: final report

**Run:** Wednesday 21 October 2026, 9:30 AM to 1:30 PM Toronto. **What:** My Fifty against the Supabase v2 test database,
with every outside connection switched off. **By:** the testing agent, following `docs/test-run-rules.md`.

## 1. Summary

- **What was tested:** every business rule in section 1 of the rules; every read (13) and write (16) the app has; the
  5-minute timer (called by hand, never on its schedule); the database's own access rules; and every screen at phone
  size (390 × 844) in a real browser, including real taps through whole flows. Fake data covered four kinds of rep book:
  one of everything, an empty book, 300 people, and an admin.
- **How much of the map:** 218 of the 222 boxes that apply in `docs/test-run/coverage.md` (98%). The other 4 are marked ENV: the parts that
  need Google sign-in accounts or switching off database safety checks, which the test login may not do (section 6).
- **Findings: 29.** Fixed during the run: **23**, each with its own commit and a test that failed before the fix and passes
  after. Not changed, waiting on you: **6** (5 proposals, 1 design question), **1 conflict between two of your documents**
  (wire payments, below), and **10 questions** about how a rule should read.
- **Access between reps:** through the app, one rep could not see or change another rep's people, orders, logs or
  follow-ups (`test/run/access.js`: 108 checks of access and bad input, all passed). Two smaller leaks were found and fixed (F9, F19). The database's own rules have
  one gap that needs a rule change (F6).
- **The fixes that matter most:** F12 (the app could hang when several requests arrived at once), F28 (Today could stay
  out of date for days while the app was left open, missing new leads), F1 (wire orders wrote a payment row), F18 (the
  public website served the project's test files and these notes), F14 (Rewards counted free items as syringes),
  F25 (an order could not be sent after "Same as last order"), F27 (the wrong screen could stay up on a slow connection).
  The most important open item is F6 (staff list readable by anyone with a Google account).
- **Tests at the end (full re-run from scratch at 1:00 PM):** 438 automated tests, 428 pass; the 10 that fail are the older
  ones the test login cannot run (section 6). The smoke test passes apart from checks tied to the day the demo data was
  loaded. Random input (5 rounds, about 2,100 requests): no server errors. Rep against rep: 108 of 108. Every screen and
  flow in the browser: OK, no page errors. The proof that nothing can leave the computer: 17 of 17.
- **Nothing was sent outside.** Every test, every local server and the screenshot browser ran behind a guard that refuses
  any connection except this computer and the Supabase v2 test database (`docs/test-run/offline-proof.txt`). No email,
  text, push, order or AI request left the computer. The live app (my-fifty.vercel.app) and the live n8n workflow were
  never called. The 5-minute timer stayed paused. No database structure was changed, and no real row was changed.

### Your decisions, in one place
1. **Wire payments (your documents disagree).** The test-run rules say "Never create a payment row for a wire order". The
   data-model SOP (`renellence-edge/docs/data-model-sop.md`, Money and fulfilment) says "Wire orders count as paid as soon
   as they're placed (a wire payment row is written then)". The run followed the test-run rules (fix d7af6a7). If the
   SOP is right, revert d7af6a7 and correct the rules; if the rules are right, correct the SOP and the demo-data generator.
2. **F6** anyone with a Google account can read the staff list through Supabase directly (proposal 4.1).
3. **F17** keep Supabase's email confirmation on, and harden the sign-in check (proposal 4.2).
4. **F22** what should happen to an order n8n did not accept (proposal 4.3).
5. **F11** the MY FIFTY dots for fewer than 5 people.
6. **Questions Q1 to Q10** (end of section 2).

## 2. Findings, most serious first

Severity: **high** = a wrong rule or money result, or the app stops working; **medium** = data reaching the wrong person,
a wrong number or list on a screen, a flow that cannot be finished, or a security gap; **low** = an error message instead
of a clear answer, or a rare case.

| # | Severity | What was wrong | Status |
|---|---|---|---|
| F12 | high | Several requests at once could hang until the 60-second limit | Fixed 7a8f60c |
| F1 | high | A wire order wrote a "succeeded" payment row (rules: never) | Fixed d7af6a7 (see decision 1) |
| F6 | high | Anyone with any Google account can read the staff list (names, emails, saved settings) and add clinics | Proposal 4.1 |
| F28 | medium | Today (and every screen) could stay out of date while the app was left open: new leads missing | Fixed 2b03eb5 |
| F22 | medium | An order n8n did not accept is never sent again | Proposal 4.3 (Phase 2) |
| F18 | medium | The public site served tests, SQL, the seed script and these notes | Fixed 6b585cb |
| F9 | medium | Voice notes sent Gemini the names of other reps' clients | Fixed 43621c4 |
| F19 | medium | A switched-off rep would still get new-lead pushes | Fixed 2bf152c |
| F14 | medium | "saypha syringes this month" counted free headbands, ice packs and fact sheets | Fixed f1a1b86 |
| F25 | medium | After "Same as last order" with a product no longer sold, Send failed and could not be put right | Fixed 56cb30f |
| F27 | medium | On a slow connection the previous screen's answer could cover the screen the rep moved to | Fixed ee2d6e6 |
| F23 | medium | A candidate with a second sample order on the way showed "Not shipped" and left Today | Fixed f558770 |
| F2 | medium | Settings saved as a list broke Tomorrow and the joined-your-Fifty moment (already true for info@) | Fixed 947fe3a |
| F3 | low | A cancelled visit counted as reaching someone | Fixed e8245dd |
| F4 | low | Rewards could date an order by an earlier test payment | Fixed 0c4a279 |
| F5 | low | Built-in names (constructor, __proto__…) as ops gave odd answers or errors | Fixed 9d5c9a7 |
| F7 | low | An order line over 999 was left off without a word | Fixed 84843ab, 90ce4dc |
| F8 | low | An impossible follow-up date (Feb 30) caused a server error | Fixed 2b01efa |
| F10 | low | Voice drafts kept "Saypha Lips" capitalised | Fixed 8b26401 |
| F13 | low | Quick "Tomorrow" taps on several people kept only the last | Fixed eca5dfd |
| F15 | low | The server let a rep rewrite a sent email's text | Fixed 11c7fcc |
| F16 | low | An email held by a removed person (or saved a moment earlier by another rep) gave a database error | Fixed bd55357, 86be39f |
| F24 | low | A note that is only a "Next:" line was shown twice in History | Fixed 09bfc62 |
| F26 | low | People search: a slow older answer could show after the box was cleared | Fixed 96aca0d |
| F29 | low | Tapping Undo twice showed "Something went wrong" next to "Undone" | Fixed 8c48261 |
| F17 | low | Sign-in trusts an email as verified unless Supabase says otherwise (safe today: Supabase requires email confirmation) | Proposal 4.2 |
| F21 | low | Any https address is accepted as a phone's push address | Proposal 4.4 |
| F30 | low | The sign-in library is loaded from a public CDN without an integrity check | Proposal 4.5 |
| F11 | low | Fewer than 5 people: the MY FIFTY tile fills dots for people who do not exist | Design question |

(F20 was a mistaken fix, withdrawn in b7acbbe and turned into Q8.)

### How to see each one (every scenario is also one line in `docs/test-run/tried.md`)

**F12 (high) Hangs when several requests arrive at once.** Open Today on 10 phones at the same moment (or run
`test/db/testrun-parallel.test.js` on the old code): 7 of 10 never answered; 3 logs at once all hung *and were still
saved*, so a rep who tried again logged twice. Cause: Supabase's connection pooler (port 6543) stalls on a database query
that carries no values when it travels together with others. Fix: every query now carries at least one value. After the
fix: 10 Today screens at once in 1.3 seconds, 3 logs in 1.9 seconds.

**F1 (high) Wire orders.** On L10 choose Wire / e-transfer and send: a payment for the full amount marked "succeeded" was
written. Fix: no payment row; the order still counts as paid when placed (its payment method is wire), and Rewards still
date it by the day it was placed. One older test that expected the row was rewritten to check the rule instead. The demo
data (3 wire orders) and `scripts/seed-demo.js` still have such rows: not changed (see decision 1).

**F28 (medium) Out-of-date screens.** Open Today, leave the app open (as a phone does), let a new Instagram lead arrive,
come back two minutes later: Today still showed the old list. Answers were kept until the rep saved something, so the
list, the day count and even the date could stay stale for days. Fix: an answer is reused for one minute at most and
is dropped when the app comes back to the front. Check: `node test/run/cdp-screens.js <dir> 5201 stale`.

**F6 (high, proposal)** Supabase v2 is set to let anyone sign up (its public settings: sign-ups open, Google sign-in on),
and the @renellence.com check is only in My Fifty's own server. So anyone with any Google account can sign in to Supabase
directly and, with the public key and without My Fifty, read every row of `users` (staff names, emails, saved settings)
and add clinics. People, orders and logs stay hidden. Check: `test/db/testrun-rls.test.js`
prints `OUTSIDER_CAN_READ_USERS 12 OUTSIDER_CAN_ADD_CLINIC true`.

**F17 (low, proposal)** The server lets an @renellence.com email in unless Supabase explicitly says it is unverified.
Today this is safe because Supabase requires email confirmation for email-and-password sign-ups (checked in its public
settings), but if that setting were ever switched off, a person could sign up with a staff address and be let in as that
staff member.

**F22 (medium, proposal)** With n8n down or refusing (a fake 500 and a timeout were tried), the order is saved as "Waiting
on approval" and the rep reads "It goes for approval once the order connection is switched on", but no step ever sends it.

**F18 (medium)** Vercel publishes every file in the project folder unless told not to, so `/test/…`, `/db/…sql`,
`/scripts/seed-demo.js`, `/docs/test-run/…` (these notes, with the security findings) and the README were reachable on
the live site. Fix: `.vercelignore`; a test checks both what stays hidden and what the app needs. (These notes were on
the live site from about 9:45 to 10:52 AM.)

**F9 (medium)** Open a person at a clinic where another rep also has a client and record a voice note: the text sent to
Gemini listed the other rep's client by name. Fix: only the rep's own people.

**F19 (medium)** Switch a rep off while a new Instagram lead is still assigned to them: the timer would still push
"New Instagram lead: <name>" to their phone. Fix: no pushes to switched-off reps.

**F14 (medium)** Alpha's Rewards said 13 saypha syringes this month; by hand it is 10. The three extra were free saypha
headbands ("saypha" in the name). Fix: only paid lines count, as the money rule says.

**F25 (medium)** A person whose last order included a product that is no longer sold: tap "Same as last order", then Send.
The answer was "Something went wrong" and the hidden line could not be removed. Fix: only products that can still be
ordered are copied.

**F27 (medium)** On a slow connection, tap a person and then the People tab before the card loads: the person's card
appeared over the People screen (the address said /people). Fix: only the newest screen asked for may draw.
Check: `node test/run/cdp-screens.js <dir> 5201 navrace`.

**F23 (medium)** A candidate whose first samples arrived 9 days ago and who has a second sample order waiting on the MD
showed "Not shipped" and was not on Today. Fix: the days count from the samples that arrived.

**F2 (medium)** The info@renellence.com row already has its saved settings stored as a list of old values instead of one
record; from then on "Tomorrow" and the joined-your-Fifty bookmark were lost. Fix: such settings are read as empty and
repaired on the next save. (That row was not touched by the run; it repairs itself on its next save.)

**Low findings:** each fix has a test named after it in `test/db/testrun-fixes.test.js`, `test/db/testrun-routes.test.js`
or `test/unit/testrun-*.test.js`; the steps are in `docs/test-run/tried.md`.

**F11 (design question)** The tile fills these dots: 0 people → 5, 1 → 6, 3 → 8, 4 → 9, then 5 people → 5. Below 5
people it fills dots for people who do not exist. An older test says "at 0 shows 5", so it was not changed.

### Questions (the rule or design is not clear; nothing changed)
- **Q1** Admins in My Fifty see only their own book (a rep's person gives "not found"). The rules say admins see
  everything; the database does, the phone app does not. Intended?
- **Q2** "Same as last order" copies the newest order even when it is not paid yet. Should it be the last *paid* order?
- **Q3** Someone whose only order is an unpaid order of paid products shows as a Lead, but the rule says a lead has no
  orders at all. Which group should they be in?
- **Q4** "Resend pay link" has no once-an-hour limit (Remind MD has one).
- **Q5** A lead with no source (none of social / event / warm / cold) is in none of the four lead groups; only search finds them.
- **Q6** An email from one rep to a client in another rep's book lands on that client's History, where the other rep reads it.
- **Q7** A rejected or cancelled order disappears from the person's History and card; the rep is never told it was rejected.
- **Q8** The order screen lets the *injector* on a signed onboarding order, but L9 lists only the *primary* contact (the
  SOP says the primary contact is the account that orders). Should the injector be able to order?
- **Q9** A call with no answer, a text or an email the rep logged today takes the person off Today ("reached today"),
  and a no-answer call or a no-show visit counts as a touchpoint. The rules exclude only scheduled and cancelled ones. Intended?
- **Q10** On a Saturday, Sunday or holiday, meeting the goal adds that day to the streak shown that day, but on the next
  business day it no longer counts (the streak is business days only), so the number can go down by one. Should a
  weekend or holiday ever add to the streak?

## 3. Fixes made

| Commit | Fix |
|---|---|
| d7af6a7 | Wire orders: never write a payment row (they still count as paid when placed) |
| 947fe3a | Settings saved as a list no longer break Tomorrow and the joined-your-Fifty moment |
| e8245dd | A cancelled visit is not a touch: new leads stay new and stay on Today |
| 0c4a279 | Rewards: an order's paid date ignores test payments |
| 9d5c9a7 | Built-in names refused as ops or lead groups; non-object bodies refused |
| 84843ab, 90ce4dc | Orders: a line over 999 is refused, not dropped (the first commit broke one older test for a few minutes; the second fixed it) |
| 2b01efa | Follow-ups: a date that does not exist is refused |
| 43621c4 | Voice notes: the clinic context lists only the rep's own people |
| 8b26401 | Voice notes: saypha and its product names in lower case |
| 7a8f60c | Every query carries a value, so requests at once no longer hang |
| eca5dfd | Tomorrow: two quick saves no longer undo each other |
| f1a1b86 | Rewards: syringes count paid lines only |
| 11c7fcc | History: emails cannot be rewritten |
| bd55357, 86be39f | An email already held gives a clear "already" answer (add a person, samples MD) |
| 6b585cb | Tests, SQL, the seed script and reports kept off the public site |
| 2bf152c | Timer: no new-lead pushes to a switched-off rep |
| f558770 | Candidates: days since samples count from the samples that arrived |
| 09bfc62 | History: a "Next:"-only note is not shown twice |
| 56cb30f | "Same as last order" copies only products that can still be ordered |
| 96aca0d | People search: a slow older answer is dropped |
| ee2d6e6 | Screens: a slow answer for a screen already left is dropped |
| 2b03eb5 | Screens: answers reused for a minute at most, and refreshed when the app comes back |
| 8c48261 | L4: a double tap on Undo no longer shows an error |

Withdrawn: d23cf36 (listing the injector on L9), reverted in b7acbbe (Q8). No screen, button, label, flow, business rule
or database structure was changed by any fix.

## 4. Proposed changes (not made: they change a rule, the database or the design)

1. **F6 database rules.** Change the `read_all` rules on `users`, `products` and `settings`, and the `add` rule on
   `clinics`, from "any signed-in account" to "a signed-in, active My Fifty user" (`public.me() is not null`). Consider
   letting reps read only other users' id and name, not their emails and settings. Also consider a Supabase sign-up
   hook that only accepts @renellence.com addresses.
2. **F17 sign-in.** Keep email confirmation on in Supabase Auth (it is on today); and in `api/_auth.js` also require Supabase's `email_confirmed_at` (the older sign-in tests need that
   field added to their fake users).
3. **F22 orders and n8n.** Either the n8n branch picks up every "submitted" order it has not acknowledged, or the timer
   re-sends orders saved while n8n was unreachable (with a once-only key so nothing is approved twice).
4. **F21 push.** Accept push addresses only from the browsers' push services (Google, Mozilla, Apple, Microsoft).
5. **F30 sign-in library.** Add an `integrity` hash (and `crossorigin`) to the supabase-js script tag in `index.html`, or
   serve the file from the app itself, so a change on the CDN cannot run code in the app. (The hash could not be worked
   out during the run because the computer was kept offline.)
6. **Wire payments in the demo data** (`scripts/seed-demo.js`), once decision 1 is made.
7. **Before go-live, run `db/wipe-demo.sql`.** While the demo and test users are in v2, real reps' Trip to Vienna board
   will list them (Echo, Jordan, Casey…).

## 5. What Phase 2 needs for each connection

| Connection | To switch on | Test first |
|---|---|---|
| **Gemini** (voice notes) | `GEMINI_API_KEY` (a billed key, so client data is not used for training) | a real recording in English and in French; "saypha" stays lower case; a silent recording gives an empty draft; the time limits on a slow phone |
| **Gmail** (send and pull) | The Google OAuth client in Supabase with the Gmail scopes; `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | send to a test client; the pull keeps client emails and skips robots; a revoked token shows "connect Gmail again"; decide Q6 |
| **Web push** | `MYFIFTY_SECRET` (the push keys come from it) | reminders on an iPhone (installed to the Home Screen) and on an Android; one new-lead push per lead; the 7:30 morning summary once per business day |
| **n8n** (orders) | `N8N_MYFIFTY_URL`, `N8N_MYFIFTY_KEY` and the new n8n branch (shown to Yousef first) | an order, a samples order, Resend pay link, Remind MD; what happens when n8n is down (F22); customer-facing invoices and pay links list paid products only |
| **Quo** (calls and texts) | The v2 Quo feed (not built yet: CHANGELOG-v2 section 7) | calls and texts land on the right person, count towards the day goal, and take the person off Today |
| **Meta** (ad leads) | The v2 Meta lead feed (not built yet), writing `contacts` with `source_kind = social` and their `ad_objects` | a new ad lead is at the top of Today within minutes and gets exactly one push |
| **Google sign-in** | The Google provider in Supabase Auth (client id and secret); then check F17 | a @renellence.com account with an active `users` row gets in; a Gmail account and a switched-off user do not |

Also after the run: switch the `my-fifty-tick` timer back on, drop the `test_agent` login, restore the real `.env.local`.

## 6. Limits of this run

- The test login could not create Google sign-in accounts, so the database rules for a *signed-in rep* could not be
  imitated (the public key, an outsider account and the admin were). The 7 older tests that do this and the 3 that load
  and wipe the demo data cannot run with this login; they were the only failures allowed (`test/run/gate.sh`).
- Three checks in `test/smoke.js` depend on the day the demo data was loaded (calls dated "today" on 20 October, and an
  Instagram lead that turned 24 hours old at 12:19 PM today) and fail after that; a fourth cannot work inside one
  rolled-back transaction. The smoke test was run inside a transaction that is rolled back, so it never changed real rows.
  The demo data should be reloaded (or the smoke test made date-proof) before it is used again.
- GitHub refused pushes from about 10:28 to 10:52 ("permission denied to yousefk07": the computer's saved GitHub login
  seemed to switch accounts). Everything was pushed once it worked again.
- The microphone and real phone notifications need a phone; they were tested with fake recordings and a fake push service.

## 7. How to remove the fake data

Everything the run created is marked: the users `test.alpha` … `test.foxtrot` `@demo.invalid` (Alpha Testrep, Bravo
Testrep, Charlie Testadmin, Delta Offrep, Echo Loadrep, Foxtrot Emptyrep); clinics, people and orders whose `legacy_id`
starts `demo-test-`; people with an `@demo.invalid` email or owned by a test user; clinics named "Testrun …"; ad objects
whose `meta_id` starts `demo-test-`; and Gmail import rows with `demo-test` in their key. Everything hanging off them
(calls, texts, tasks, payments, onboardings, agreements, notifications, voice drafts, connections, change log) goes with them.

To remove it, run `db/wipe-demo.sql` in the Supabase SQL editor as the database owner. It removes the run's fake data and
the original demo data together and keeps products, settings and real staff. The script was extended for the run's rows;
`test/db/testrun-wipe.test.js` checks that it picks every fake row and no real one.
