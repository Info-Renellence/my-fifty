# Coverage map: real-data run (2026-10-22, 7:30 PM to 11:50 PM Toronto)

Database: Supabase v1 holding a fresh copy of v2's real data (5 real reps, 2 admins, head office; 620 real contacts).
Each box = one area x one real-data check. Status: `--` not started · `ok` checked and right · `BUG RDn` · `FIX RDn` (pushed) ·
`Q` needs the owner · `n/a`. No customer data in this file: counts only.

Books checked: Lucas (151), Sam (124), Emily (122), Brittany (104), Angela (90), head office info@ (72), admin@ (everyone),
second admin (everyone).

## Rules on the real books

| Area | All 8 users | Notes |
|---|---|---|
| Fifty count (non-sample order in the last 3 months) | ok | identical to an independent SQL count for every user |
| Candidates (all-free sample order, no paid-goods order) | ok | identical to SQL for every user |
| Candidate days / Today candidates | Q RD7 | 154 of 184 real shipped/delivered orders have no shipped/delivered time: candidates say "Not shipped" and never reach Today |
| Onboarded group = primary contact only | ok | identical to SQL; 0 of 64 injectors / MDs / non-primary signers shown |
| Lead groups (social, event, warm, cold) | ok | leads op and People counts agree for every user |
| Going cold | Q RD4 | 55 imported meetings have no mode: not counted as visits |
| New lead / reached today / touches | Q RD3 | inbound emails, texts and calls count as touches |
| Today list order and contents | ok | follow-ups, going cold, candidates; no errors |
| Day goal and streak | ok | per-day counts checked by SQL for the last 8 days |
| Fifty tile / milestone | ok | |
| Rewards: Q4 Booster | ok | new/reorder amounts identical to an independent SQL sum for every rep |
| Rewards: paid orders only, wire not paid until received | ok | 10 real pending wires: not in rewards, still in the Fifty |
| Trip to Vienna board | ok | (v1 also lists the demo reps; v2 has none) |
| Wire follow-up email + Mark as received | BUG RD1 (Q) | buttons signed for info@ (head office) are refused |
| Orders credited to someone else (rep_id vs owner) | Q RD5 | 23 / 24 / 29 orders |

## Screens on the real books (phone size, read-only: writes blocked in the browser)

| Screen | Status | Notes |
|---|---|---|
| L2 Today | ok | |
| L6 People: My Fifty, Candidates, Leads | ok / Q RD7 | "Not shipped" on delivered samples |
| L22-L25 lead groups incl. Onboarded | ok | |
| L7/L8 person card | FIX RD2 | email shown as name / long clinic name ran off the card |
| L14 History | FIX RD2 / Q RD3 | long links ran off; inbound emails shown as "You" |
| L19/L21 order progress | FIX RD6 | delivered Shopify-era orders showed "Approved · Waiting" |
| L20 onboarding | ok | |
| L9 who is it for | FIX RD2 | long clinic names ran off |
| #12 products + quantity list | ok | 0-100 + "More than 100…", total updates |
| L10 review | ok | (not sent) |
| L11 rewards | ok | |

## Access on the real books

| Check | Status | Notes |
|---|---|---|
| Rep asks for another book's person / history / onboarding / products / order (560 reads) | ok | all 404 |
| Search for a surname from another book | ok | no hits |
| Head office opens an order it is credited on, in a rep's book | ok (by design) / Q RD5 | |
