# Coverage map (test run 2026-10-21)

Each box is one thing in the app × one kind of test from the rules (section 5).
Status: `--` not started · `ok` passed · `BUG Fn` bug found · `FIX Fn` fixed · `Q` question for the owner · `n/a` does not apply · `ENV` could not be tested with the test login.
Findings (F1…) are described in `progress.md` and `report.md`.

Kinds of test:
- **E** edge data: empty book, one person, hundreds, missing name/email/phone, odd characters, very long text
- **D** duplicates, double taps, two reps on the same clinic at once
- **C** clock: Toronto midnight, daylight-saving change, weekends, holidays, last day of a quarter
- **O** orders and money: every status, mixed free/paid lines, zero-price lines, wire vs card
- **A** access: another rep's people, non-admin reaching admin data, signed out, bad input
- **S** the screen at phone size (390 × 844)

## 1. Business rules (section 1)

| Rule | E | D | C | O | A | Notes |
|---|---|---|---|---|---|---|
| R1 Lead = no orders at all | ok | n/a | n/a | Q3 | n/a | an unpaid paid-goods order alone shows as a lead |
| R2 Candidate = sample order (all lines free), no paid order | ok | n/a | n/a | ok | n/a | |
| R3 Fifty = any paid order; wire counts as paid when placed | ok | n/a | ok | ok | n/a | |
| R4 Rejected / cancelled / deleted orders don't count | ok | n/a | n/a | ok | n/a | |
| R5 New lead = nobody called, texted, emailed or visited | FIX F3 | n/a | n/a | n/a | n/a | cancelled visit counted |
| R6 Going cold > 30 days (setting) | ok | n/a | ok | ok | n/a | 30 / 31 days, setting 20 |
| R7 Ready to order = onboarded or ordered before | ok | n/a | n/a | ok | ok | Q8 injector |
| R8 Goal 8; touchpoint = call or in-person visit; not scheduled/cancelled | ok | ok | ok | n/a | n/a | |
| R9 Streak | ok | n/a | ok | n/a | n/a | weekends, holidays (existing tests), yesterday 11:30 PM |
| R10 Toronto time | n/a | n/a | ok | n/a | n/a | both 2026/27 clock changes |
| R11 Today's list order | ok | ok | ok | n/a | n/a | |
| R12 Reached today drops off; Tomorrow hides | FIX F3 | FIX F13 | ok | n/a | n/a | |
| R13 Candidates: days since samples; no Ask now; no drive time | FIX F23 | n/a | n/a | ok | n/a | screens checked; no "Ask now" or drive time anywhere |
| R14 Fifty goal 50, milestone every 5 | Q F11 | n/a | n/a | n/a | n/a | 0 people shows 5 dots |
| R15 Q4 Booster 2% / 4%, Oct 1-Dec 31 | ok | n/a | ok | FIX F4 | ok | Dec 31 11:30 PM in, Jan 1 out |
| R16 Trip to Vienna | ok | n/a | ok | ok | ok | |
| R17 New = first paid order ever | ok | n/a | n/a | ok | n/a | across reps |
| R18 Counts for orders.rep_id, day paid / placed (wire) | ok | n/a | ok | FIX F4 | n/a | |
| R19 Money = paid lines only | ok | n/a | n/a | FIX F14 | n/a | syringe count |
| R20 Sign-in @renellence.com + active users row | ENV | n/a | n/a | n/a | ok | existing unit tests; db part needs auth.users |
| R21 Rep sees own; admin all; admin-only tables | ok | ok | n/a | ok | BUG F6 | app: 97 checks ok; database rules: outsider reads staff list |
| R22 saypha lower case | ok | n/a | n/a | n/a | n/a | FIX F10 (voice drafts) |
| R23 Customer-facing = paid products only | n/a | n/a | n/a | ok | n/a | app sends n8n only {orderId}; invoices are n8n's (Phase 2) |
| R24 No payment row for wire | n/a | n/a | n/a | FIX F1 | n/a | conflicts with the data-model SOP: owner decision |
| R25 Screens follow the mockup | n/a | n/a | n/a | n/a | n/a | S: no changes made to any screen |

## 2. Reads (`api/data.js`)

| Op | E | D | C | O | A | S |
|---|---|---|---|---|---|---|
| config | n/a | n/a | n/a | n/a | ok | n/a |
| boot | FIX F2 | n/a | n/a | n/a | ok | ok |
| today | ok | FIX F12 | FIX F28 | n/a | ok | ok |
| people | ok | ok | ok | n/a | ok | ok |
| leads | ok | n/a | n/a | n/a | FIX F5 | ok |
| person | ok | n/a | n/a | ok | ok | ok |
| history | ok | n/a | ok | ok | ok | ok |
| ready | ok | n/a | n/a | ok | ok | ok |
| products | FIX F25 | n/a | n/a | Q2 | ok | ok |
| order | ok | n/a | ok | ok | ok | ok |
| onboarding | ok | n/a | n/a | n/a | ok | ok |
| rewards | ok | FIX F12 | ok | FIX F14 | ok | ok |
| search | ok | FIX F26 | n/a | n/a | ok | ok |
| unknown op / signed out | n/a | n/a | n/a | n/a | FIX F5 | n/a |

## 3. Writes (`api/act.js`)

| Op | E | D | C | O | A | S |
|---|---|---|---|---|---|---|
| log | ok | ok | FIX F8 | n/a | ok | ok |
| undo | ok | FIX F29 | ok | n/a | ok | ok |
| snooze | FIX F2 | FIX F13 | ok | n/a | ok | ok |
| seen_fifty | FIX F2 | ok | n/a | n/a | ok | n/a |
| add_person | ok | ok | n/a | n/a | ok | ok |
| set_follow_up | ok | n/a | FIX F8 | n/a | ok | ok |
| set_uses | ok | n/a | n/a | n/a | ok | ok |
| edit_note | ok | n/a | n/a | n/a | FIX F15 | ok |
| invoice_email | ok | n/a | n/a | n/a | ok | ok |
| order (order / samples) | FIX F7 | ok (UI guard) | n/a | FIX F1 | ok | ok |
| resend_pay_link | n/a | Q4 | n/a | ok | ok | ok |
| remind_md | n/a | ok | ok | n/a | ok | ok |
| voice (Gemini stub) | FIX F10 | n/a | ok | n/a | FIX F9 | n/a |
| email (Gmail stub) | ok | ok (UI guard) | n/a | n/a | ok | n/a |
| push_subscribe | ok | ok | n/a | n/a | ok | n/a |
| gmail_connect | ok | ok | n/a | n/a | ok | n/a |
| GET / non-POST, unknown op, bad JSON | n/a | n/a | n/a | n/a | FIX F5 | n/a |

## 4. Timer (`api/cron.js`, called directly)

| Step | E | D | C | A | Notes |
|---|---|---|---|---|---|
| key check | n/a | n/a | n/a | ok | |
| 1 new-lead pushes | FIX F3 | ok | ok | n/a | push stub unreachable → logged failed |
| 2 morning summary | ok | ok | ok | n/a | existing tests: window, once a day |
| 3 Gmail pull | ok | ok | ok | ok | junk HTML answer counted as error |

## 5. Connections (all stubbed)

| Connection | proof off | fake success | fake failure |
|---|---|---|---|
| Gemini | ok | ok | ok (existing: 429/500/503/timeout/junk) |
| Gmail send / pull | ok | ok | ok |
| Web push | ok | ok | ok (410, unreachable) |
| n8n | ok | ok | ok (500, timeout, junk reply) |
| Quo (data rows only) | ok | ok | n/a |
| Meta (lead rows + ad_objects) | ok | ok | n/a |
| Google sign-in | ok | ENV | ENV |

## 6. Screens (phone size, headless Chrome)

| Screen | S | Notes |
|---|---|---|
| L2 Today | ok / Q F11 | empty book dots |
| L3 Log sheet | ok | |
| L4 Logged / undo | ok | |
| L5 Joined your Fifty | ok | after an n8n-style first paid order |
| L6 People | ok | 300-person book ok |
| L7 / L8 Person card | ok | odd characters shown as text |
| L9 Who | ok | |
| #12 Products | ok | |
| L10 / L15 Review | ok / Q2 | |
| L11 Rewards | FIX F14 | |
| L13 Add a person | ok | duplicate in another book, new clinic, role, cold |
| L14 History | FIX F24 | very long note ok |
| L19 / L21 Order status | ok | wire, pay link, samples waiting on MD |
| L20 Onboarding | ok | |
| L22-L25 Lead groups | ok | |
| error / not found | ok | |
| signed out / sign-in | ok | |
| moving between screens on a slow connection | FIX F27 | |
| app left open (stale screens) | FIX F28 | |

## 7. Fake data clean-up

| Item | Status |
|---|---|
| `db/wipe-demo.sql` covers every test-run row | ok (selections tested, rolled back) |
| Wipe deletes run end to end | ENV (needs `session_replication_role`) |
