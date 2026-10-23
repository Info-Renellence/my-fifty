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
