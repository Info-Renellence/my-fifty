# My Fifty real-data run: final report

**Run:** Thursday 22 October 2026, 7:30 PM to 11:50 PM Toronto. **What:** My Fifty on a copy of the real data (Supabase v1,
loaded with v2's real customers at 7 PM: 5 reps, 2 admins, head office, 620 real people), every outside connection off.
**By:** Lane B, following `docs/test-run-rules.md` as changed by the conductor's brief for tonight. Nothing in this run
connected to v2. No customer names, emails or phones in this report: counts and ids of fake rows only.

## 1. Summary

- **What was tested:** each real user's book as that user sees it (8 local servers, one per real user, behind the network
  guard): every read screen for every person (about 800 people, 0 errors); the business rules checked against independent
  database queries; access between reps on the real books; writes on fake people placed in real books; the wire follow-up
  built (not sent) from the real data; the phone screens on 5 real books in a browser, with every write blocked in the browser,
  compared with "Edge – Final Mockup" L1-L25.
- **Coverage:** 46 of 46 boxes checked; 9 of them wait on you (`coverage.md`). Every scenario is one line in `tried.md`.
- **The rules hold on the real data.** For every user, the app's Fifty, Candidates, Onboarded group (the onboarding's primary
  contact only: none of the 64 injectors, medical directors or other signers without orders appeared), lead groups, Going
  cold, day goal and streak, and Q4 Booster money matched a separate database query exactly. Rewards count paid orders only;
  the 10 real wire orders still waiting for their money are in the Fifty but not in rewards.
- **Access:** a rep asking for another book's people, history, onboarding, products or orders: 560 tries, all refused;
  search never found another book's people; another rep or head office trying every write on a fake person in Sam's book:
  all refused, nothing written.
- **Findings: 14** (RD1-RD13 and RD18; RD9, RD11, RD12 are data notes). Fixed and pushed tonight: **5** (RD2, RD6, RD8, RD10, RD18), each with a test that failed before and
  passes after, each pushed only after the gate showed nothing new failing against the baseline. Waiting on you: **RD1 (high)**,
  RD3, RD5, RD7, RD13 (medium), RD4 and the data notes.
- **Tests at the end:** final gate at 10:40-10:49 PM on the final code of both repos (my-fifty 0e9d307, Edge f710c9a), under the
  shared lock: Edge 83 files pass, failing only the two time-of-day files allowed after 8 PM (inbox 5, map 1), build ok; My Fifty
  498 tests, 485 pass, the 13 failing are exactly the baseline's (10 login-rights, 3 wire = RD1); smoke 31 passed, 2 failed, the
  baseline's two (demo history not copied). Nothing new. After a server restart on the final code: every read screen for every
  person in the 5 rep books and head office (669 people) answered with 0 errors; Onboarded and Candidates identical to SQL for all
  8 users; 557 rep-against-rep reads all refused (the 2 order pages that opened are orders credited to the asking user, RD5).
- **Nothing was sent outside and no real row was changed.** Every server and test ran behind the network guard (only v1 reachable);
  the wire follow-up was built, never sent; every browser write (including "seen" markers) was blocked; checks against the
  snapshot showed the real users' saved settings unchanged.

### Your decisions, in one place
1. **RD1 (high): who may press "Mark as received" on an overdue wire.** In the real data info@ is head office, not admin, and owns
   real customers; the email's buttons are signed for info@ and the button page accepts admins only. Should head office be allowed
   to mark wires received (change `api/wire.js` to accept `kind in ('admin','head_office')`), or should the button carry an admin's
   name? And: may a head-office user own customers (info@ owns 19 real people and is the rep on 24 orders in reps' books)?
2. **RD7:** fill the shipped / delivered dates of the 154 Shopify-era orders in v2 from Shopify (Shopify is the source of truth),
   or tell us to show delivered samples with no date as "Delivered" (no day count) instead of "Not shipped".
3. **RD3:** inbound emails, texts and calls: should they count as touches (New lead, last touch, off Today, day goal for an inbound
   answered call), and how should History name them (now "You")?
4. **RD5:** orders credited to someone other than the customer's rep (23 another rep, 24 head office, 29 nobody): right or clean up?
5. **RD4:** 55 imported meetings have no type (in person / video / phone): set them, or count a meeting with no type as a visit?
6. **RD13 (carry-over of the 10-21 F6):** the database rules still let any signed-in account read the staff list, now real
   staff. Proposal 4.1 of the 2026-10-21 report (a rule change in v2) is still waiting.
7. **Admin view (question):** admins see the whole company on Today (31 real items: every rep's going-cold and candidates) and
   the Fifty tile (59 of 50). That follows rule E ("every list"); confirm it is wanted on Today.

## 2. Findings, most serious first
Severity: **high** = a wrong rule or money result, or something stops working; **medium** = a wrong list, number or screen,
or a flow that cannot be finished; **low** = a rare case or a cosmetic problem.

| # | Severity | What was wrong | Status |
|---|---|---|---|
| RD1 | high | "Mark as received" in the overdue-wire email is refused on the real data (signed for head office; admins only) | **Needs you** (decision 1) |
| RD6 | medium | Delivered orders with no step times showed "Approved · Waiting" on the order screen | Fixed 044419d |
| RD7 | medium | Delivered samples with no delivered time show "Not shipped" and never reach Today | **Needs you** (decision 2) |
| RD3 | medium | Inbound emails, texts and calls count as touches and show as "You" in History | **Needs you** (decision 3) |
| RD5 | medium | Orders credited to someone other than the customer's rep; 4 social leads and 4 others have no owner | **Needs you** (decision 4) |
| RD18 | medium | A NUL character in any text gave a server error (500) on Log, Add person and other writes (found by Edge) | Fixed 849653f (my-fifty) + 5ddc6de (Edge), shared http.js |
| RD13 | medium | Carry-over of 10-21 F6: the database rules let any signed-in outsider read the staff list (now real staff) | **Needs you** (database rule) |
| RD10 | low | "Add person" duplicate warning could open a merged-away (hidden) person: "not found" | Fixed b53ccc6 |
| RD2 | low | Long links, an email shown as a name and long clinic names ran off the phone screen | Fixed 6af06a5 |
| RD8 | low | "No phone number for  yet." for the 18 people with no first name | Fixed d03e28a |
| RD4 | low | 55 imported meetings have no type, so they are not visits (changes Going cold for 1 person) | **Needs you** (decision 5) |
| RD9 | low (data) | One real person has an email address in the phone field | Data clean-up |
| RD11 | low | 1 of 138 ready-to-order people has no shipping address; an order can be sent without one | Proposal 4.4 |
| RD12 | low | Imported meeting notes up to 21,000 characters show in full in History (emails are cut at 400) | Proposal 4.5 |

### How to see each one (every scenario is also one line in `tried.md`)

**RD1 (high) Wire "Mark as received".** Build the daily wire follow-up from the real data for tomorrow (`cron.js` `wires`,
called by hand, never sent): 3 overdue real wires go to info@ with "Mark as received" buttons signed for info@. Open one: the page
answers 403 "Only an admin can mark a wire payment as received", because `api/wire.js` accepts `users.kind = 'admin'` only and
info@ is `head_office` in the real data. Also: info@ is the rep on 7 of the 9 pending real wires, so it gets both the rep email
and the overdue email for them. The 3 failing tests in `test/db/wire.test.js` fail for the same reason: they use the existing
info@ user as their admin (`adminInfo`), which assumed the demo data's info@ (kind admin). The tests were not changed.

**RD6 (medium, fixed) Order screen.** 154 of 184 real shipped/delivered orders (every one from March to September, and 12 of
41 in October) have no approved, warehouse, shipped or delivered times; History already said "Delivered" from the status, but
L19/L21 built the steps from the times only and showed such an order as "Approved · Waiting". Now each step is also done when the
status has passed it (no date is shown when there is none).

**RD7 (medium, needs you) Candidates with delivered samples.** Same missing times: 20 of 32 real candidates have samples marked
delivered with no delivered or shipped time. The candidate list says "Not shipped", the day count is missing, and they never join
Today's "candidates nobody has touched since their samples arrived". Not changed: the shared `book.js` would have to invent an
arrival date. Edge (lane A, its RD2) agrees.

**RD3 (medium, needs you) Inbound contact.** About half of the real emails (603) and texts (497) and 153 calls are inbound.
My Fifty ignores `interactions.direction`: an inbound email shows in History with "You" under it, counts as a touch (12 real
people whose only contact was inbound are not "New"), sets "last touch", an inbound text takes a person off Today, and an inbound
answered call counts towards the day goal.

**RD5 (medium, needs you) Who an order belongs to.** 23 real orders are credited to a rep who does not own the customer, 24 to
head office on reps' customers, 29 to nobody. Rewards follow `orders.rep_id` (the rule), so those 29 count for nobody and the 23
for the other rep; head office can open the 2 orders it is credited on in a rep's book (by design: the order screen allows the
credited rep). 4 real social leads and 4 other people have no owner, so no rep sees them in My Fifty.

**RD18 (medium, fixed; found by Edge, lane A)** Postgres refuses a NUL character (`\u0000`) in text. Edge answered 400 in its own
route (1340118); My Fifty still gave 500 "server_error" for Log and Add person with one in the note or name (reads already
answered 400). The shared `route()` in `http.js` now answers 400 `bad_input` for it, the same change in both repos.

**RD10 (low, fixed) Merged people.** No real person is merged yet. A fake person merged into another is hidden everywhere, but
"Add person" with their email warned "already yours" with an Open button to the hidden person ("not found"). The warning now
points to the person they were merged into.

**RD2 (low, fixed) Long text.** Real emails carry long links; a lead with no name shows their email as the name; clinic names are
kept on one line by design. On the real books History, the person card and "Who is it for?" were wider than the phone. Text now
breaks at the edge when it cannot fit (`overflow-wrap: break-word`; normal layouts unchanged; checked on 5 real books).

**RD8 (low, fixed)** 18 real people have no first name: Call / Text / Email with no phone or email said "No phone number for  yet."

**RD4 (low, needs you)** 55 imported meetings (27 in the last 30 days) have no type. Visits are in-person or video meetings, so
these never count; with them, 1 person (in Brittany's book) would not be going cold.

**RD13 (medium, carry-over)** `test/db/testrun-rls.test.js` on the copy (which has v2's structure) still prints
`OUTSIDER_CAN_READ_USERS 28 OUTSIDER_CAN_ADD_CLINIC true`: a signed-in account that is not staff can read every `users` row
(staff names, emails, saved settings) and add clinics. People, orders and calls stay hidden. Whether outsiders can sign in to v2
depends on v2's Auth settings, which were not looked at (no v2 contact tonight). Fix: proposal 4.1 of the 2026-10-21 report.

**RD9, RD11, RD12 (low)** see the table; RD11: L10 shows an empty "Ship to" and Send still works.

### Questions (nothing changed)
- **Q-RD-A Admin Today.** Admins see the whole company on Today (31 real items) and the MY FIFTY tile (59 of 50). Rule E says
  "every list"; confirm Today is meant.
- **Q-RD-B Head office in My Fifty.** info@ (head office) uses My Fifty like a rep: its own 19 real people, Today, Rewards (Q4
  Booster on its orders; not on the Trip board). Is that wanted?
- **Q-RD-C Rules text vs code.** `docs/test-run-rules.md` still says "Fifty: has any paid order" and "Going cold: no paid order";
  the code follows the later Edge decisions (2026-10-21: a non-sample order placed in the last 3 months, paid or not; a video
  meeting counts as a visit). The rules file should be brought up to date.

## 3. Fixes made
Every fix: one commit on my-fifty `main`, a test that failed before and passes after, the gate run under the shared lock
before the push, and the failing tests compared by name with the baseline (nothing new). Pushing `main` deploys
my-fifty.vercel.app, so each is live on the real data.

| Finding | Commit | What changed | Test |
|---|---|---|---|
| RD6 | 044419d | `api/data.js`: the order screen's steps also follow the order's status (approved / warehouse / shipped), with no made-up date | `test/unit/testrun-realdata.test.js` (4 cases) |
| RD2 | 6af06a5 | `app.css`: `overflow-wrap: break-word` on the page | same file (+ browser pass on 5 real books) |
| RD8 | d03e28a | `app.js`: the no-phone / no-email message uses the full name when there is no first name | same file |
| RD18 | 849653f (my-fifty), 5ddc6de (Edge no-hubspot); 0e9d307 / f710c9a replaced a raw NUL byte my edit had left in the comment (and in Edge's new test) with the text `\u0000` | shared `api/_http.js` = `api/_edge/http.js` `route()`: Postgres 22021 / 22P05 (a NUL in text) is 400 `bad_input`; the two copies stay identical below their header line | `test/db/testrun-realdata.test.js`; Edge `test/run/db-realdata.test.js` |
| RD10 | b53ccc6 | `api/act.js` add_person: a duplicate found on a merged-away person points to the person they were merged into | `test/db/testrun-realdata.test.js` |

Only one shared file changed (http.js, RD18), in both repos in the same step; book.js, lists.js, time.js and http.js are
still the same in both repos apart from the header line and the require paths. The gate for RD18 ran Edge's suite and build and
My Fifty's suite together (first run: Edge's `test/adstarget.test.js` "twenty at most" failed twice in a row, a timing test that
passes on its own with and without the change; the re-run had nothing new). No database structure was changed.

## 4. Proposed changes (not made)
1. **RD1** (your call): `api/wire.js` accepts `kind in ('admin', 'head_office')`; or `cron.js` signs the buttons for an admin;
   or info@ becomes an admin. Whichever you choose, `test/db/wire.test.js` should then create its own admin instead of using info@.
   Optional: when info@ is also the rep on an overdue wire, send it one email, not two.
2. **RD7**: fill `orders.shipped_at` / `delivered_at` in v2 from Shopify's fulfilment dates for the shipped/delivered orders that
   lack them (154 tonight), and check why 12 October orders still came in without them. Only if dates can't be had: show delivered
   samples with no date as "Delivered" (needs your yes; the shared `book.js` changes in both apps).
3. **RD3**: count only outbound emails / texts / calls as the rep's touches (New lead, last touch, off Today, day goal), and show
   inbound ones in History as from the person ("From <first name>"). Needs your yes on the wording and the rule; shared `book.js`.
4. **RD11**: Send waits for a shipping address (or the review step asks for one).
5. **RD12**: cut long imported meeting notes in History to a few lines with "More".
6. **RD4 / RD5 / RD9**: data clean-up in v2 (meeting types, order credit, owners for the 8 unowned people, the email in a phone field).

## 5. What tonight could not cover
- The database is a copy (v1) made at 7 PM; real sign-in (Google) could not be used, so each real user was signed in by the
  local test server. Gmail and push connections were blanked on the copy, so those show as "not connected".
- No write was made on a real row: every write test used fake people placed in real books; screens were driven with every write
  blocked in the browser. So "Same as last order", sending real orders, pay links and Remind MD were not run on real people (they
  were covered on fake data in the 2026-10-21 run).
- The timer's push and order-resend parts were not called (they send). The wire follow-up was built and read, never sent.
- pg_cron on v1 could not be switched off by the test login (conductor's SETUP.md); no function on v1 calls out.
- 3 wire tests and 2 smoke checks fail on this copy for data reasons (baseline.md): RD1, and the demo history not copied.

## 6. How to remove the fake data (see also Round 2: soft-deleted at 10:54 PM)
Tonight's fake rows (all on v1, the test copy; none on v2):
- `contacts` with `legacy_id` `demo-test-rd-mvk83d01` (a cold lead in Sam's book), `demo-test-rd-merged` (merged into it) and
  `demo-test-rd-meta` (a social lead in Lucas's book), all with `@demo.invalid` emails;
- what hangs off them: a few calls and texts (undone), follow-up tasks (one assigned to admin@), change-log entries.
`db/wipe-demo.sql` already removes them (contacts with a `demo-` legacy id or an `@demo.invalid` email, and everything on them).
Change-log entries stay (append-only by design).

## Round 2 (10:40 to 11:40 PM)

**Edge orders read in My Fifty (the conductor's top item): not a bug.** Lane A saw My Fifty's order view return an empty line
list for a wire order placed through Edge. Reproduced: Edge run locally on v1 (network guard) as a real rep, a fake customer
(`demo-test-rd-b-*`) added through Edge, then a wire order (10 saypha filler), a card order (2 paid + 1 free) and a samples order
placed through Edge's API. Edge writes `order_lines` in the same shape My Fifty does, and My Fifty reads them: totals $2,250 and
$450 (the free line not counted), History shows "10 filler" / "2 filler", the samples order lists its lines. The empty list is
on purpose: `api/data.js` returns lines only for a samples order, because the mockup's L19 (paid order) has no product list and
L21 (samples) has one. Nothing changed.

Also tried (each one line in `tried.md`):
- **Lane A's kept fake rows** (`demo-test-rd-a-*`, Emily's book) were already soft-deleted by lane A when checked; My Fifty hides
  them (404, not listed).
- **Merged people's history (RD19, low, proposal):** a call or order on a merged-away person does not show in the History of the
  person they were merged into, and their orders would not count for the kept person. No real person is merged yet and no merge
  tool exists; when one is built it should move calls, tasks and orders to the kept person (or the book should read both).
- **No clinic, every screen:** a fake person with no clinic through the card, History, Who is it for, products, quantity list,
  review ("Ship to: No address yet") and the order screen: no layout problems.
- **Quantity list on a real book's order flow (fake person):** 0-100 plus "More than 100…"; 3 gives "3 items · $675"; 150 typed
  gives "153 items · $34,425"; 5000 typed is refused and the box goes back. Nothing was sent.
- **Event leads with partial names:** the 6 real event leads with only a first name (3 with no clinic) show correctly
  (one initial, the event or clinic as the subline).
- **Forecasts, events and RSVPs:** My Fifty has no forecast or event screens (Edge only), so nothing to try there.
- **Design:** final-code screens for Angela's and Emily's books and head office match the mockup. One mismatch in the mockup itself:
  its streak tile says "6 weeks · plan done", but the rule and the app count days. The rule wins; flagged, not changed.
- **Wipe:** Lane B's fake rows (5 contacts `demo-test-rd-*`, 5 orders, their calls and tasks) were soft-deleted on v1; none are
  left live. A hard delete is refused for the test login (change-log entries point at them); `db/wipe-demo.sql`, run by the
  owner, removes them fully.

No code changed in round 2; no push to Edge.
