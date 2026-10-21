# Changes to Supabase "v2" made for My Fifty

v2 is project `ojphplepzuwchjtuycpv`. Before My Fifty it was the empty 28-table model from
`renellence-edge/db/edge-model.sql`: 385 columns, no rows, no row-level security policies and no triggers.

Every change below was made on 2026-10-20. The SQL is in `db/`.

## 1. Tables and fields (`db/001-my-fifty.sql`), each approved by Yousef

| # | Change | Why (screen) |
|---|---|---|
| 1 | `contacts.role`: text → new enum `contacts_role` (physician · nurse_injector · clinic_owner · manager · other) | L13 Add a person, the Role chips. "Yes, fixed list" |
| 2 | `contacts.source_kind` enum `contacts_source_kind` re-made as social · event · warm · cold (was meta_ad · event · warm · cold · import · other) | L6 Leads in four groups. "Yes, as proposed" |
| 3 | New `contacts.source_detail` text | The source shown on lead rows (Instagram, Facebook, Referral, Clinic visit, Lips webinar …). Social leads still link to `ad_objects` through `source_ad_id`, events through `source_event_id` |
| 4 | New `contacts.fillers_used`, an array of new enum `contacts_filler` (saypha · juvederm · restylane · teoxane_rha · belotero · revanesse · stylage · other), default empty | L7/L8 "Filler they use". "Two list fields" |
| 5 | New `contacts.prp_used`, an array of new enum `contacts_prp` (eclipse_prp · regenlab · arthrex_angel · emcyte · exprecell · other), default empty | L7/L8 "PRP/PRF they use" |
| 6 | `orders.notes` renamed to `orders.approval_note` | L10/L15 "Note for approval" |
| 7 | New `orders.shipping_note` text | L10/L15 "Shipping note". The invoice email uses the existing `contacts.secondary_email` |

## 2. New values in existing lists

| # | Change | Why |
|---|---|---|
| 8 | `interactions_source` + `my_fifty` | Calls, visits, texts and emails logged in My Fifty are told apart from Edge's. "Add a 'my_fifty' value" |
| 9 | `change_log_source` + `my_fifty` | The same, for the change log |
| 10 | `notifications_kind` + `new_lead` | L1 "New Instagram lead" push (web push was approved) |

## 3. Database rules the SOP requires (no new tables or fields)

| # | Change | Why |
|---|---|---|
| 11 | Trigger `touch_updated_at` on every table with `updated_at` | Keeps `updated_at` right (SOP section 3) |
| 12 | Trigger `log_changes` on 22 business tables (`log_settings` on `settings`): one `change_log` row per changed field, with who (`app.user_id`), from where (`app.source`) and the contact. Credentials are masked (`is_sensitive`) | SOP sections 4 and 7: change_log "written by database triggers". It also powers "Added by you", "Moved to you from …" and resend history |
| 13 | Trigger `append_only` on `change_log`: no updates or deletes, and `at` is set by the database | SOP section 7 |
| 14 | Row-level security switched on for all 28 tables, with 33 policies and helper functions `me()`, `is_admin()`, `can_see_contact(id)` and `can_see_order(id)`. Reps see their own contacts and everything hanging off them. Admins see everything. Events, ads, territory rules and ingest are admin-only | SOP section 7. Without it, anyone holding the public Supabase key could read every table |
| 15 | 20 indexes on the columns those rules and the app filter on (`owner_id`, `contact_id`, `assignee_id`, …) | SOP section 7 ("index every column a rule uses") |

## 4. Rows

| # | Rows | Notes |
|---|---|---|
| 16 | 47 `products`: the staff sales-form catalogue (SKU, name, family, line, unit, list price, active) | Real data (`db/002-config.sql`) |
| 17 | `settings.my_fifty`: daily goal 8, Going Cold after 30 days, Fifty goal 50, new leads stay on top for 24 h | Real (`db/002-config.sql`) |
| 18 | `settings.holidays`: the Ontario holiday list for 2026–2027 (the same as Edge) | Real; the streak skips these days |
| 19 | `users`: admin@renellence.com and info@renellence.com as admins | Real. Reps are added at go-live with the real import |
| 20 | Fictional demo data: 4 demo staff (`@demo.invalid`), 26 clinics, about 67 people, 70 orders, interactions, tasks, agreements and onboardings, all owned by admin@renellence.com | Remove with `db/wipe-demo.sql` before go-live |

## 5. The timer (`db/003-cron.sql`)

| # | Change | Why |
|---|---|---|
| 21 | The `pg_cron` and `pg_net` extensions turned on | Vercel's free plan only runs timers once a day |
| 22 | Vault secret `my_fifty_cron_key` (the value of the Vercel `CRON_SECRET`) | The timer's key, kept out of code and tables |
| 23 | pg_cron job `my-fifty-tick`, every 5 minutes, calling `https://my-fifty.vercel.app/api/cron?op=tick` | New-lead pushes (L1), the 7:30 morning summary, the Gmail pull |

## 6. Test run, 2026-10-21 (temporary, approved by Yousef)

| # | Change | Why |
|---|---|---|
| 24 | pg_cron job `my-fifty-tick` paused (`active = false`) for the run | No pushes or Gmail pulls on the test data. **Turned back on 2026-10-21 after the run** |
| 25 | New login role `test_agent`: reads and writes rows only (no right to change tables, fields or rules), skips row-level security like the app server, and can switch to `authenticated`/`anon` to test the RLS rules | The 4-hour testing agent (`docs/test-run-rules.md`) uses this login, not the master key. **Dropped 2026-10-21 after the run** |
| 26 | Rows only, all fictional: 6 test users (`test.alpha` … `test.foxtrot` `@demo.invalid`), about 330 people and 170 orders (`legacy_id` `demo-test-…`), clinics "Testrun …", 2 `ad_objects` (`meta_id` `demo-test-…`), a Gmail `ingest_events` row, and the calls, texts, tasks, payments, onboardings, notifications, voice drafts and connections hanging off them (`test/run/seed-test-data.js`, plus what the run did through the app) | Test data for the run; kept for the owner to look at. Removed with `db/wipe-demo.sql` (extended for these rows). No structure changed |

## 7. Still to do in v2 (not done yet)

- **Data feeds** for Meta leads, Quo calls and texts, and Stripe payments, rebuilt for the v2 tables. Edge's ingest functions write to the old sandbox schema, so they can't just be redeployed.
- **Supabase Auth → Google** needs a Google OAuth client ID and secret, entered in the v2 dashboard.
