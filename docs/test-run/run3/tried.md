# Run 3: scenarios tried (lane B, Pulse), once each

Counts and ids only; no real names. v1 only; rolled back unless marked "committed fake rows".

| Time | Scenario | Result |
|---|---|---|
| 18:49 | order_dispatch row pulse:true, dispatch columns missing (v1/v2 tonight) -> order, timer | order throws (column dispatch_status does not exist); tick throws -> R3B-1 |
| 18:49 | dispatch on, local fake n8n on 127.0.0.1:5531 over real HTTP: 502 -> queued; 14 min no retry; 16 min retry -> sent | pass; 2 hits, same key order:<id>, from pulse/timer, attempt 1/2 |
| 18:49 | dispatch on, fake n8n slower than timeout_ms 300 | queued, error n8n_timeout |
| 18:49 | dispatch on and off, N8N_MYFIFTY_URL = a real n8n cloud address | guard refuses: n8n_unreachable, nothing sent |
| 18:49 | queued order cancelled, aged 30 min, timer | not retried |
| 18:49 | weekOf around DST (Oct 26 / Oct 31 / Nov 1 / Nov 2) | week = Oct 26 04:00Z to Nov 2 05:00Z (169 h); Nov 2 new week |
| 18:49 | week_view off -> visit_missed | accepted -> R3B-2 |
| 18:49 | week pick on a contact owned by another rep | shown on Today with name/clinic; Missed accepted; log refused -> R3B-3 (low) |
| 18:49 | Missed -> reached visit (Done) -> Undo | back to open, not Missed (noted) |
| 18:49 | agreed call: no-answer call, text, reached call | open, open, done |
| 18:51 | STAGING=1: config with v2 SUPABASE_URL; signedIn with v2 SUPABASE_URL; v2 pooler URL; held hosts list | 503 (body server_error); signedIn calls v2 auth host; pooler refused; n8n/Stripe/Quo/Gmail/push/SignatureAPI held -> R3B-4 (low) |
| 18:53 | 375 px audit, biggest real book, 19 screens (Today, People, 5 lead groups, Rewards, 4 people + history, 2 orders, Order who, log sheet) | 0 overflow, min text 13 px, all taps >= 44 px, min contrast 4.62; reduced motion: no animation > 0.05 s |
| 18:55 | Race to 25 vs independent SQL count (owner's contacts with a non-sample order in 3 months) | equal for top 3 |
| 18:57 | 5 real reps x 25 random other-book contacts x every read/write op (rolled back) | 4 reps: 285-316 refused each, 0 leaks; 5th: statement timeout (contention), redo |
| 19:15 | 300 random write bodies 500 (lane A baseline) | gmail_connect stores junk token, email reaches Google -> network error 500 -> R3B-5 |
| 19:40 | Today/People/Leads/Rewards for all 9 real users (read-only) | 0 errors; Today order correct; 0 foreign rows for reps; lead lists = group counts; admin ~11 s for all four reads |
| 20:08 | committed fake rows (rep r3b.quinn, 5 fictional contacts, saved weekly 1-on-1, 3 visits + 2 calls) at 375 px | week block clean; Confirm -> Confirmed; Missed then a reached visit -> Done; calls done by reached calls |
| 20:10 | the pick on another rep's contact (fictional) | shows Log/Missed; Log -> not_found; the focus hit can never fire while it is there (R3B-3) |
| 20:11 | paid-type wire order on a fictional onboarded contact | L5 "joined your Fifty" moment once; tile glow suppressed by design after the moment |
| 20:12 | that pick removed, Today loaded twice | focus-hit sweep on first load only |
| 20:14 | local STAGING=1 server (real config op) in Chrome at 375 px | red "Staging · test data" strip, title "STAGING · Pulse", no tap covered; strip covers the logo (R3B-6 low); config serves whatever anon key is set (v2's key not refused, R3B-4) |
