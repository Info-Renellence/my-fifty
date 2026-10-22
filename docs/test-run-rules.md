# My Fifty test run: rules for the testing agent

Phase 1 tests My Fifty against Supabase v2 (a test database) with **every outside connection switched off**.
Your job is to find what is broken, fix it without changing what the app is meant to do, and report.
If a rule below and the code disagree, the rule wins. If a rule looks wrong to you, say so in the report. Never "fix" a rule.

## 1. Business rules (do not change, ever)

These are the owner's decisions. Do not change the behaviour, wording, numbers or order of anything below.
A fix may only make the code do what these rules say.

**Who is who**
- **Lead**: has no paid order and no sample order; someone whose only order is unpaid is still a lead (Q3, 2026-10-21). Every lead has a source (social · event · warm · cold). **Candidate**: has a sample order (every line free) and no paid order.
  **Fifty**: has any paid order. A wire order counts as paid as soon as it is placed.
- Orders that are rejected, cancelled or deleted don't count.
- **New lead**: a lead nobody has called, texted, emailed or visited yet.
- **Going cold**: a Fifty person with no paid order and no in-person visit for more than 30 days (`settings.my_fifty.going_cold_days`). A no-show is not a visit (S1, 2026-10-22).
- **Ready to order** (L9): the main contact of a signed onboarding (never the injector on it, Q8), or someone who has ordered before. Edge follows the same rule (2026-10-22, F6).

**Today and the day goal**
- The daily goal is **8 touchpoints**. A touchpoint is a logged call or in-person visit where the person was reached. Scheduled, cancelled, no-answer and no-show ones don't count; emails and texts never do (Q9).
- **Streak**: days in a row with 8 or more, ending yesterday; today is added once today's goal is met. A business day short of the goal
  breaks it. A weekend or holiday (`settings.holidays`) never breaks it, and adds one when the goal was met on it (Q10).
- "Today" and every date use **Toronto time** (America/Toronto).
- Today's list, in this order: (1) new social-media leads under 24 hours old, (2) follow-ups due today or overdue,
  (3) Fifty people going cold, (4) candidates nobody has touched since their samples arrived.
  Anyone already reached today drops off: a reached call or visit, or a text; never a no-answer call, a no-show or an email (Q9). "Tomorrow" hides someone until tomorrow.
- Candidates show days since their samples arrived. There is no "Ask now" button, and no drive time on visits.
- The Fifty goal is 50 people, with a milestone every 5. The MY FIFTY tile never fills a dot for someone who doesn't exist (F11).
- "Same as last order" copies the last *paid* order (Q2). "Resend pay link" and "Remind MD" work at most once an hour (Q4).
- History shows every order, including rejected and cancelled ones (Q7). A rep's Gmail only lands on that rep's own clients (Q6).
- An order n8n did not accept is sent again by the timer, with a once-only key, until n8n accepts it (F22).

**Rewards** (written in code for now, on purpose)
- Q4 Booster, Oct 1 to Dec 31 2026: **2% on new orders, 4% on reorders**.
- Trip to Vienna, Oct 1 to Dec 31 2026: counts new people per rep.
- A "new" order is the person's first paid order ever. Every later paid order is a reorder.
- An order counts for the rep on `orders.rep_id`, on the day it was paid (or the day it was placed, for wire).
- Money counts paid lines only. Free lines and samples never count.

**Access**
- Sign-in is Google, @renellence.com only, plus an active row in `users`.
  Test reps sign in with email and password, and that is for testing only. Don't remove the domain rule.
- A rep sees only the contacts they own and everything attached to them. Admins see everything: since 2026-10-22 (E,
  as Edge's F5) every My Fifty list, search, person and order shows admins (`users.kind = 'admin'`) the whole book,
  unassigned leads included, and an admin may act on any customer (an order an admin places is credited to the
  customer's rep). Reps are unchanged; head-office contacts stay hidden from reps.
  Events, ads, territory rules and ingest are admin-only.

**Wording and money**
- Write "saypha" and its product names in lower case. Only Lidocaine is capitalised.
- Anything a customer sees (invoices, pay links, payment emails) lists paid products only, never samples or free lines.
- A wire order counts as sold when placed and is never marked paid for that. Collecting the money is tracked by one
  pending wire payment row written when it is placed, marked received by an admin when the money arrives; the due date
  is the order's payment terms (corrected 2026-10-21: this line used to say "never create a payment row for a wire order").

**Screens**
- The screens follow "Edge – Final Mockup" L1 to L25, except L12 and L16 to L18. The product picker is the original #12.
  Don't add, remove or redesign any screen, button, label or flow. Fix only what is broken inside the existing design.

## 2. Database (Supabase v2, `ojphplepzuwchjtuycpv`)

- **Never change the structure.** No new, renamed or removed tables, fields, enum values, functions, triggers,
  row-level security policies, indexes or cron jobs. If you think one is needed, describe it in the report as a proposal.
- **Rows:** create, change and delete only fake rows that you made.
  Mark them the same way as the demo data: `legacy_id` starting `demo-test-`, emails ending `@demo.invalid`, names clearly fictional.
- Never change or delete any row that isn't marked as fake. Never touch `change_log` (it is append-only by design).
- Fake rows stay in v2 at the end so the owner can look at them. Extend `db/wipe-demo.sql` so it removes them too.

## 3. Outside connections: all off

The connections are Gemini, Gmail, web push, n8n (orders), Quo (calls and texts), Meta (ad leads) and Google sign-in.
- Run the app on a local server (`node test/serve.js`) with **no** keys for Gemini, Gmail, n8n or push in the environment.
  Never test against my-fifty.vercel.app, and never call the live n8n workflow.
- Before any test runs, prove that no request can leave the machine except to Supabase v2. If one can, stop and report it.
- Make fake data for each connection that looks like what the real service would send or write:
  Meta lead rows (`contacts` with `source_kind = 'social'` and the matching `ad_objects`), Gemini voice write-ups,
  Gmail messages and pulled emails, Quo call and text records, n8n order replies, and push subscriptions with their results.
  Use fake replies in the tests (stubbed `fetch`). Never use real services.
- The 5-minute timer (pg_cron `my-fifty-tick`) is paused for the whole run. Don't turn it back on.

## 4. Fixing code

- Fix only clear bugs: crashes, errors, wrong numbers or lists compared with section 1, data leaking between reps,
  security holes in the app code, and broken screens.
- Make one commit per fix, and add a test that fails before the fix and passes after it.
  Commit to `main` as `git -c user.name="Yousef Kamel" -c user.email="info@renellence.com" commit ...` and push.
- Never delete, skip or weaken an existing test to make it pass.
- Run all tests before every push (`node test/smoke.js`, the unit tests and the database tests). Never push red.
- No new libraries without a clear reason given in the report. Keep the Vercel limits: no more than 12 functions,
  only daily Vercel crons, and literal `require`s.
- If a fix would change a rule in section 1, the database (section 2) or the design: don't make it. Report it.

## 5. What to test

Every screen at phone size, every read (`api/data.js`) and write (`api/act.js`), the timer (`api/cron.js`, called directly,
never on its schedule), and every rule in section 1, including edge cases:
- empty books, a single person, hundreds of people, missing names, emails or phones, odd characters, very long text
- duplicates, double taps and two reps working on the same clinic at once
- Toronto midnight, daylight-saving changes, weekends, holidays, the last day of a quarter
- orders with every status, mixed free and paid lines, zero-price lines, wire versus card payments
- reps trying to see or change another rep's people, non-admins reaching admin data, signed-out requests and bad input

## 6. The plan (4 hours, one run)

- **First 30 minutes:** setup, proof that the connections are off, the fake data, and the coverage map
  (`docs/test-run/coverage.md`): every screen, read, write and rule against every kind of test in section 5,
  each with a status (not started, passed, bug found, fixed).
- **To 2 h 30:** work through the map one area at a time, always taking the next untested box. Rules in section 1,
  access between reps, and orders and money come first.
- **To 3 h 30:** go deeper: random input, unusual combinations, attempts to break the access rules, load.
- **Last 30 minutes:** run everything again from scratch, then write the final report.
- Log every scenario once (`docs/test-run/tried.md`) and check the log before running one. Re-run only to confirm a fix;
  the automated suite handles re-checks.
- Group findings by root cause: one bug is one finding, however many symptoms it has.
- If an hour adds no new coverage and no new finding, switch to a different area or kind of test for the next hour.

## 7. Reporting

- Keep `docs/test-run/progress.md` up to date (what was tested, findings, fixes with commit links), and push it at least every hour.
  The hourly email is built from it.
- At the end, write the final report: a summary, findings ranked by how serious they are (with steps to reproduce),
  each fix and its commit, rules or database changes you propose (not made), what Phase 2 needs for each connection,
  and how to remove the fake data.
