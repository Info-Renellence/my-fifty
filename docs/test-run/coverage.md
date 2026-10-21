# Coverage map (test run 2026-10-21)

Each box is one thing in the app × one kind of test from the rules (section 5).
Status: `--` not started · `ok` passed · `BUG` bug found (finding number) · `FIX` fixed (commit) · `n/a` does not apply · `ENV` could not be tested with the test login.

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
| R1 Lead = no orders at all | -- | n/a | n/a | -- | n/a | |
| R2 Candidate = sample order (all lines free), no paid order | -- | n/a | n/a | -- | n/a | |
| R3 Fifty = any paid order; wire counts as paid when placed | -- | n/a | -- | -- | n/a | |
| R4 Rejected / cancelled / deleted orders don't count | -- | n/a | n/a | -- | n/a | |
| R5 New lead = nobody called, texted, emailed or visited | -- | n/a | n/a | n/a | n/a | |
| R6 Going cold = Fifty, no paid order and no visit > 30 days (setting) | -- | n/a | -- | -- | n/a | |
| R7 Ready to order = onboarded or ordered before | -- | n/a | n/a | -- | -- | |
| R8 Day goal 8; touchpoint = logged call or in-person visit; scheduled/cancelled don't count | -- | -- | -- | n/a | n/a | |
| R9 Streak: business days in a row ≥ 8, ending yesterday, + today when met | -- | n/a | -- | n/a | n/a | |
| R10 Toronto time for "today" and every date | n/a | n/a | -- | n/a | n/a | |
| R11 Today's list order: new social leads < 24 h, follow-ups due/overdue, going cold, untouched candidates | -- | -- | -- | n/a | n/a | |
| R12 Reached today drops off; "Tomorrow" hides until tomorrow | -- | -- | -- | n/a | n/a | |
| R13 Candidates show days since samples arrived; no "Ask now"; no drive time | -- | n/a | n/a | n/a | n/a | S |
| R14 Fifty goal 50, milestone every 5 | -- | n/a | n/a | n/a | n/a | |
| R15 Q4 Booster 2% new / 4% reorders, Oct 1–Dec 31 2026 | -- | n/a | -- | -- | -- | |
| R16 Trip to Vienna: new people per rep | -- | n/a | -- | -- | -- | |
| R17 New order = first paid order ever; later = reorder | -- | n/a | n/a | -- | n/a | |
| R18 Order counts for orders.rep_id on day paid (placed, for wire) | -- | n/a | -- | -- | n/a | |
| R19 Money = paid lines only | -- | n/a | n/a | -- | n/a | |
| R20 Sign-in: @renellence.com + active users row | -- | n/a | n/a | n/a | -- | |
| R21 Rep sees only own contacts; admin everything; events/ads/territory/ingest admin-only | -- | -- | n/a | -- | -- | |
| R22 "saypha" lower case; only Lidocaine capitalised | -- | n/a | n/a | n/a | n/a | |
| R23 Customer-facing = paid products only | n/a | n/a | n/a | -- | n/a | |
| R24 Never a payment row for a wire order | n/a | n/a | n/a | -- | n/a | |
| R25 Screens follow the mockup (no new UI) | n/a | n/a | n/a | n/a | n/a | S |

## 2. Reads (`api/data.js`)

| Op | E | D | C | O | A | S |
|---|---|---|---|---|---|---|
| config | n/a | n/a | n/a | n/a | -- | n/a |
| boot | -- | n/a | n/a | n/a | -- | -- |
| today | -- | n/a | -- | n/a | -- | -- |
| people | -- | n/a | -- | n/a | -- | -- |
| leads | -- | n/a | n/a | n/a | -- | -- |
| person | -- | n/a | n/a | -- | -- | -- |
| history | -- | n/a | -- | -- | -- | -- |
| ready | -- | n/a | n/a | -- | -- | -- |
| products | -- | n/a | n/a | -- | -- | -- |
| order | -- | n/a | -- | -- | -- | -- |
| onboarding | -- | n/a | n/a | n/a | -- | -- |
| rewards | -- | n/a | -- | -- | -- | -- |
| search | -- | n/a | n/a | n/a | -- | n/a |
| unknown op / signed out | n/a | n/a | n/a | n/a | -- | n/a |

## 3. Writes (`api/act.js`)

| Op | E | D | C | O | A | S |
|---|---|---|---|---|---|---|
| log | -- | -- | -- | n/a | -- | -- |
| undo | -- | -- | -- | n/a | -- | -- |
| snooze | -- | -- | -- | n/a | -- | -- |
| seen_fifty | -- | -- | n/a | n/a | -- | -- |
| add_person | -- | -- | n/a | n/a | -- | -- |
| set_follow_up | -- | -- | -- | n/a | -- | -- |
| set_uses | -- | -- | n/a | n/a | -- | -- |
| edit_note | -- | -- | n/a | n/a | -- | -- |
| invoice_email | -- | -- | n/a | n/a | -- | -- |
| order (order / samples) | -- | -- | n/a | -- | -- | -- |
| resend_pay_link | n/a | -- | n/a | -- | -- | -- |
| remind_md | n/a | -- | -- | n/a | -- | -- |
| voice (Gemini stub) | -- | n/a | n/a | n/a | -- | n/a |
| email (Gmail stub) | -- | -- | n/a | n/a | -- | n/a |
| push_subscribe | -- | -- | n/a | n/a | -- | n/a |
| gmail_connect | -- | -- | n/a | n/a | -- | n/a |
| GET / non-POST, unknown op, bad JSON | n/a | n/a | n/a | n/a | -- | n/a |

## 4. Timer (`api/cron.js`, called directly)

| Step | E | D | C | A | Notes |
|---|---|---|---|---|---|
| key check (X-Cron-Key) | n/a | n/a | n/a | -- | |
| 1 new-lead pushes (push stub) | -- | -- | -- | n/a | |
| 2 morning summary 7:30 business days | -- | -- | -- | n/a | |
| 3 Gmail pull (Gmail stub) | -- | -- | -- | -- | |

## 5. Connections (all stubbed)

| Connection | proof off | fake success | fake failure (timeout, 4xx/5xx, junk JSON) |
|---|---|---|---|
| Gemini | -- | -- | -- |
| Gmail send / pull | -- | -- | -- |
| Web push | -- | -- | -- |
| n8n | -- | -- | -- |
| Quo (calls/texts: data rows only) | -- | -- | n/a |
| Meta (lead rows + ad_objects) | -- | -- | n/a |
| Google sign-in (auth) | -- | -- | -- |

## 6. Screens (phone size)

| Screen | S | Notes |
|---|---|---|
| L2 Today | -- | |
| L3 Log sheet | -- | |
| L4 Logged / undo | -- | |
| L5 Joined your Fifty | -- | |
| L6 People (Fifty / Candidates / Leads) | -- | |
| L7 / L8 Person card | -- | |
| L9 Who is ordering | -- | |
| #12 Products | -- | |
| L10 / L15 Review (order / samples) | -- | |
| L11 Rewards | -- | |
| L13 Add a person | -- | |
| L14 History | -- | |
| L19 / L21 Order status | -- | |
| L20 Onboarding | -- | |
| L22–L25 Lead groups | -- | |
| Signed-out / error / empty states | -- | |

## 7. Fake data clean-up

| Item | Status |
|---|---|
| `db/wipe-demo.sql` removes every `demo-test-` / `@demo.invalid` row | -- |
| Wipe tested inside a rolled-back transaction | -- |
