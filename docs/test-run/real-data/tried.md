# Real-data run (2026-10-22, 7:30 PM to 11:50 PM Toronto): scenarios tried

One line each: time · area · scenario · result. No customer names, emails or phones: counts and "a contact in X's book" only.
Database: Supabase v1 holding a fresh copy of v2's real data (see the conductor's SETUP.md). Every server ran behind the network guard.

- 19:28 · setup · test login is `test_runner` (v1); 8 local servers (one per real user: 5 reps, 2 admins, head office) start without any "v2" warning · ok
- 19:30 · wire · built (not sent) the daily wire follow-up from the real data for today, +1, +7, +14 days · today none; tomorrow 3 overdue wires go to info@ with "Mark as received" buttons; the buttons are signed for info@, who is head office, so the button page refuses them (finding RD1)
- 19:31 · data · shapes in the real books: 0 merged contacts, 90 contacts with no clinic, 14 with no name, 0 with no lead source, 8 unowned · noted
- 19:33 · R-onboarded · Onboarded group for all 8 users vs an independent SQL query (primary contact of a completed onboarding, no live order) · identical for every user; 0 injectors / medical directors / non-primary signers shown (64 such people exist in the books) · ok
- 19:33 · R-candidate · Candidates for all 8 users vs SQL (all-free sample order, no paid-goods order) · identical · ok
- 19:36 · access · each non-admin real user asks for person, history, onboarding, products and order of 4 random people from every other user's book (560 reads) + search by another book's surname · all 404 / no hits, except head office opening 2 orders it is credited on (orders.rep_id) for contacts in a rep's book: by design (order op allows the credited rep) · ok, data note RD5
- 19:37 · data · orders credited to someone other than the contact's owner: 23 rep-to-other-rep, 24 head office on a rep's contact, 29 with no rep · RD5 (owner)
- 19:40 · design · read-only screen pass (Sam's book; writes blocked in the browser) · history page wider than the phone on a real email with a long link (finding RD2); category chips scroll sideways (by design); quantity list 0-100 + "More than 100…" works
- 19:41 · history · real inbound emails and texts (603 emails, 497 texts in) show as "You" and count as touches (finding RD3)
- 19:43 · data · 55 imported meetings have no mode (27 in the last 30 days): not counted as visits for Going cold (finding RD4)
- 19:44 · streak · day counts per real rep for the last 8 days vs the streak shown (Emily 1, others 0) · ok
- 19:45 · rules · Fifty count per user vs SQL (non-sample order in the last 3 months) · identical for all 8 · ok
- 19:46 · rewards · Q4 Booster per rep vs an independent SQL sum (first paid order ever = new, paid lines only, wire only once received) · identical for every rep · ok
- 19:46 · read pass · every read op for every person in all 8 books (boot, today, people, 5 lead groups, rewards, ready, search, person, history, onboarding, products) · 0 errors; slowest history 4.4 s under load
- 19:47 · design · person card of a lead with no name (email as the title) and long real clinic names on the card and on L9 ran off the phone (RD2, same root cause)
- 19:48 · orders · L19 order screen for a delivered Shopify-era order: "Approved · Waiting", "Preparing to ship" not done (RD6); 154 of 184 real shipped/delivered orders have no step times
- 19:49 · candidates · L6 Candidates: delivered samples with no delivered time show "Not shipped" (RD7, same as Edge lane RD2)
- 19:52 · fixes · RD6 044419d, RD2 6af06a5 committed, test first failing then passing (test/unit/testrun-realdata.test.js)
- 19:55 · data · 18 real people have no first name: "No phone number for  yet." (RD8) · fixed d03e28a
- 19:57 · data · 48 of 93 real event leads have no event linked (no "Met at…"), 0 social leads linked to an ad; My Fifty does not read forecasts (Edge only) · noted
- 20:07 · gate · gate.sh + smoke on d03e28a under the lock · same failures as the baseline by name (10 known, 3 wire = RD1, 2 smoke demo-history); nothing new · pushed 044419d, 6af06a5, d03e28a
- 20:20 · design · screens re-checked on 4 real books after restarting the servers · no page wider than the phone; delivered orders show every step done
- 20:22 · random input · 300 random reads (bad ids, built-in names, 5000-char values, emoji, SQL text) on a real rep book · 125 x 200, 175 x 400, no 5xx
- 20:23 · load · 20 parallel Today on the biggest rep book: 5.0 s all 200; 10 parallel Today as admin (every book): 9.1 s all 200
- 20:25 · data · one real contact has an email address in its phone field (Call would open Quo with it) · RD9 data note
- 20:28 · writes · fake cold lead (demo-test-rd-, @demo.invalid) added in Sam's book: shows in Sam's Cold leads only · ok
- 20:28 · writes · adding someone with a real customer's email / phone from another book · 409 email_someones / already_someones, no name or id given · ok
- 20:28 · access · Lucas and head office try log, follow-up, uses, order, email, invoice on Sam's fake person · all 404, nothing written · ok
- 20:28 · day goal · reached call +1 (1 -> 2), undo back to 1; no-answer call not counted; Feb 30 follow-up 400; 5000-char note ok · ok
- 20:28 · admin · admin sets a follow-up on Sam's fake person · 200 (rule E) · ok
- 20:30 · design · real screens next to the mockup "Edge – Final Mockup (1)" (L2 Today, L6 People, L7 card, L19, L20, #12, L11) · layout, wording and colours match
- 20:31 · going cold · independent SQL count per rep (last non-sample order or reached in-person/video visit over 30 days) · identical; the 55 meetings with no mode would change only 1 person (Brittany's book) · RD4 downgraded to low
- 20:33 · merged · fake person merged into the fake lead (demo-test-rd-merged) · hidden from People, search and the card (404) · ok
- 20:33 · merged · "Add person" with the merged-away person's email · warning offered to open the merged-away person, whose card is "not found" (RD10) · fixed b53ccc6
- 20:35 · times · imported calls, meetings, orders and tasks at exactly midnight UTC (would show on the wrong Toronto day) · none · ok
- 20:36 · orders · ready-to-order people with no shipping address: 1 of 138; with no email: 6 · RD11 (owner: should Send wait for an address?)
- 20:40 · merged · RD10 fix checked on the restarted server: warning now points at the live person · ok
- 20:41 · history · longest real bodies: imported meeting notes up to 21,000 characters and notes up to 13,000 are shown in full on L14 (emails are cut at 400) · RD12 low
- 20:44 · monkey · random taps on Emily's real book in the browser, 2 seeds, every write blocked in the browser · no page errors
- 20:46 · today · fake Meta lead (demo-test-rd-meta) added to Lucas's real book · first on Today as "new Meta lead · 0m ago" · ok
- 20:46 · data · 4 real social leads have no owner: no rep sees them in My Fifty · RD5 note
- 20:47 · shared · book/lists/time/http identical in my-fifty and renellence-edge no-hubspot (header and require paths only) · ok
