# Run 3 (2026-10-23, 7 PM to 11:50 PM Toronto): Pulse coverage map

Lane B. Database: v1 (fresh copy of v2 taken 2026-10-23T22-44 UTC, demo/test rows re-added). No v2 contact.
Status: `todo` · `pass` · `bug` (finding id) · `fixed` (commit) · `n/a` (why).

| # | Area | Box | Status |
|---|---|---|---|
| 1 | Today | Today list on every real book (8 users): order of the 4 groups, reached-today drop-off, parked | pass (all 9 real users: Today/People/Leads/Rewards, 0 errors, list order right, 0 foreign rows for reps) |
| 2 | Week | Week block: focus line, visits Done/Missed/open, calls done, counts, Confirm my week | pass (rolled back + 375 px on committed fake rows: focus, Confirm, Missed, Done by logging, counts; no overflow, taps ok) |
| 3 | Week | Week boundaries: Monday start Toronto, the DST week (Nov 1), last week's session not shown | pass (week of Oct 26 runs to Nov 2 05:00 UTC, 169 h; Nov 2 starts a new week) |
| 4 | Week | Week access: Missed on another rep's pick, confirm for someone else, admin has no week | bug R3B-3 (low; pick on another rep's contact shows and can be Missed; none in real data) |
| 5 | Logging | log call / visit / text, reached or not; day goal 8; streak; counted flag | pass (fake rows: 4 reached logs -> 1..4 of 8, counted; texts never count; suite) |
| 6 | Logging | undo (incl. week Done taken back), snooze, edit_note, bad input | pass (Missed -> Done -> Undo returns open, noted; undo/snooze/edit in suite) |
| 7 | Logging | Inbound not touches (RD3), meeting with no type = call (RD4), on real data | pass on real books: 13 inbound-only leads stay New, 0 wrong; R3B-7 low (meeting mode phone shown as Visited, 2 real leads) |
| 8 | Orders | Switch off (old path): fake n8n accepts / refuses, once-only key, change_logs send | pass (suite: dispatch.test.js switch-off case; gate 8:05) |
| 9 | Dispatch | Switch on: queued -> sent against a local fake n8n, X-Idempotency-Key, attempts | pass (local fake n8n over real HTTP; key order:<id>; from pulse then timer; attempt 1,2) |
| 10 | Dispatch | Refused -> stays queued; retry only after 15 min (clock faked); max tries -> failed + one info@ task | pass (14 min not retried, 16 min retried; timeout kept; cancelled queued not retried) |
| 11 | Dispatch | flags.order_dispatch kill switch over order_dispatch.pulse (act + cron) | pass (suite: flags.test.js kill switch, act and tick; rerun alone 8:05) |
| 12 | Dispatch | A real n8n address is refused (network guard + staging) | pass (guard: n8n_unreachable, stays queued; old path too) |
| 13 | Dispatch | Switch row present but dispatch columns missing (v1 tonight, v2 today) | fixed my-fifty 068d7f1 + Edge 7f68138 (R3B-1) |
| 14 | Orders | not_ready_to_order, no_shipping_address, too_many, bad_price, wire pending row, samples need MD | pass (not ready 409, 999 ok, 1000 refused as no_products (UI caps at 999), bad prices, MD required, unknown sku, wire = 1 pending row, card = none, no address 409); proposal: double submit makes 2 orders |
| 15 | Switches | flags row: week_view / voice_notes off and on, bad values, missing row, 30 s cache, me.features | fixed my-fifty e61dba8 (R3B-2); rest pass (suite + rolled-back probes) |
| 16 | Staging | STAGING=1: banner (config staging true), admins only, n8n/Gmail/push held, fetch held, v2 address refused | pass (banner + STAGING title in Chrome on a local STAGING=1 server, no tap covered; v2 config 503; pooler refused; held hosts); R3B-4, R3B-6 low |
| 17 | Polish | 375 px on real books: tap targets, text size, contrast, overflow, every screen | pass on biggest real book (19 screens: no overflow, min text 13 px, taps >= 44 px, contrast >= 4.62) |
| 18 | Polish | Celebrations (two Pulse celebrations), reduced motion | pass (new Fifty account: L5 moment once, tile stays still by design; weekly focus hit: gold sweep on first load only; reduced motion) |
| 19 | Rewards | Race to 25: reps only, numbers against the database | pass (Race to 25 = independent count, 3 top rows) |
| 20 | Access | Rep against rep: every read op and write op with another rep's ids | pass (all 5 real reps, 285-316 refused each, 0 leaks) |
| 21 | Access | Head office screen, admin whole book, inactive user, signed out | pass (head-office screen shown on a fake head_office user; admin whole book; rest in suite) |
| 22 | Shared | sync.js --check, fingerprint test, _dispatch.js byte-identical with Edge | pass (sync --check clean; fingerprints same; dispatch byte-identical) |
| 23 | Timer | cron tick with the switches on/off; fictional rows never sent by the timer | pass (whole tick in rollback, dispatch on + fake n8n: fictional order not retried, 0 change_logs; 401 without key) |
| 24 | Deeper | Random input on every act op (no 500s) | fixed my-fifty c14b553 + 44d7da1 (R3B-5) |
| 25 | Deeper | A little load: parallel Today / people reads on the biggest book | pass (20 parallel admin reads: all 200, slowest 22 s) |
| 26 | Deeper | Odd real-data shapes in the week view and Today (no clinic, merged, no name) | pass (no clinic, very long names wrap; merged-away pick = same gap as R3B-3) |
