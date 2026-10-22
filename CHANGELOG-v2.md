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

## 7. Wire payment terms (`db/004-payment-terms.sql`), 2026-10-21, approved by Yousef

| # | Change | Why |
|---|---|---|
| 27 | New `contacts.payment_terms_days` integer (0–365, empty = the standard terms) | "We need a terms field. Right now it's 30 days only but it may change in the future" |
| 28 | New `orders.payment_terms_days` integer (0–365), copied when a wire order is placed | Changing a customer's or the standard terms never moves the due date of an order already placed |
| 29 | `settings` row `payments` = `{"default_terms_days": 30}` | The standard terms, changed in one place |

Wire orders now write one **pending** wire payment row when placed (the SOP); it becomes succeeded when an admin marks
the money received (`api/wire.js`). The daily follow-up list is `GET /api/cron?op=wires` (sent by n8n).

## 8. More demo rows, 2026-10-21

| # | Rows | Notes |
|---|---|---|
| 30 | A second fictional demo book owned by info@renellence.com (`db/seed-demo-info.sql`): 4 demo staff `demo.*.info@demo.invalid`, 26 clinics, 53 people, their orders (two unpaid net-30 wire orders), calls, visits, tasks and onboardings, all `legacy_id` `demo-info-…` | So info@ can see the whole app as a rep. Removed with `db/wipe-demo.sql` |

## 9. Edge redesign, part A (`renellence-edge/db/v2-005-edge-redesign.sql`), 2026-10-21, approved by Yousef

Additive only, so My Fifty keeps working unchanged. Applied by Yousef from the session; checked afterwards.

| # | Change | Why |
|---|---|---|
| 31 | `contacts_role` + `dentist` | Roles become physician · injector · dentist · manager · other (renames in part B) |
| 32 | `contacts_filler` + `yvoire`, `none` | The owner's filler list |
| 33 | `contacts_prp` + `alyssamed`, `cellenis`, `world_prp`, `naturagel`, `none` | The owner's PRP/PRF list (renames in part B) |
| 34 | New `contacts.medical_director_id` (→ contacts), indexed; filled for 3 people from their latest onboarding MD | "MD comes from onboarding, the rep can change it" |
| 35 | New enum `forecasts_tag` (vienna · event) and `forecasts.tag` | The Vienna / event tag on a forecast (a reward for the customer) |
| 36 | `events_kind` + `dinner`, `clinic_event` | The owner's event kinds |
| 37 | Policies `events.rep_read`, `event_attendees.rep_invite`, `event_attendees.rep_update` | Reps see events and invite their own contacts; creating events stays admin-only |
| 38 | `tasks_source` + `one_on_one` | The 1-on-1 "Focus this week" points are tasks |
| 39 | `marketing_requests` (0 rows): status re-made as sent · in_design · ready · delivered · declined · cancelled; new `campaign`, `goal`, `details`, `in_design_at`, `ready_at`, `delivered_at`; removed `pillar`, `design_id`, `fields`, `branding`, `brief`, `final_file_id`, `ready_sent_at` | Free-form requests; templates dropped; the file is emailed by hand |
| 40 | New table `expenses` (16 fields, enums `expenses_type` lunch · snacks_beverages · dinner · parking and `expenses_status` to_submit · submitted), row-level security (own or admin), `touch_updated_at` + `log_changes` triggers | Expenses are in the first Edge build; n8n writes receipts, Edge tags them |
| 41 | New `files.expense_id` (→ expenses) | The receipt photo |
| 42 | `settings` row `edge` = stuck 1 day, unshipped 2 business days, sampled-no-order 5 days, event follow-up 2 days, badge 6 months, Fifty 3 months | Edge's thresholds in one place |

**Part B, approved but waiting for My Fifty's code** (these would break My Fifty today):
- `contacts_role`: rename nurse_injector → injector; clinic_owner → manager (14 people), then drop clinic_owner. My Fifty: `app.js` ROLES, `api/act.js` role check, `api/_voice.js` ROLE labels.
- `contacts_prp`: rename exprecell → exprecell_prf and arthrex_angel → arthrex_prf; drop emcyte. My Fifty: `app.js` PRPS, `api/act.js` PRPS, `api/_voice.js` PRP labels.
- `contacts.designation`: text → enum md · rn · rpn · np · dds · other ("MD" → md). My Fifty: `api/act.js` inserts 'MD' for a new MD; `scripts/seed-demo.js`.
- `contacts.email`: drop UNIQUE, keep a plain index (shared emails allowed with a warning). My Fifty: `api/act.js` relies on the 23505 error for "already yours / already someone's"; it needs to check for the email before saving.

## 10. Edge build (renellence-edge `db/`), 2026-10-21, approved by Yousef, run by Yousef from the session

| # | Change | Why |
|---|---|---|
| 43 | New `events.capacity` integer (empty = no limit) | Seats on Events ("8 of 20 seats"); invites stop when full |
| 44 | New `agreements.training_name`, `preferred_date` (date), `note` | What the clinical training form asks for |
| 45 | `products` MSK100 face mask list price 115 → 85 | "face mask is 85" |
| 46 | **Part B applied** (`db/v2-007-part-b.sql`): `contacts_role` = physician · injector · dentist · manager · other (nurse_injector → injector; 14 clinic_owner → manager); `contacts_prp` re-made (exprecell → exprecell_prf, arthrex_angel → arthrex_prf, emcyte dropped); new enum `contacts_designation` md · rn · rpn · np · dds · other ("MD" → md); `contacts_email_key` dropped, plain index `contacts_email_idx` | Approved 2026-10-21; My Fifty was ready (ef4d8c8) |
| 47 | Fictional rows (`db/seed-edge-demo.sql`, ids `ed9e0000…`): 24 monthly targets, 28 forecasts, 3 upcoming "(demo)" events with seats, 16 invites, 8 marketing requests, 4 training forms, 12 expenses, 8 focus points; plus a few rows from testing the new Edge (person "Edgetest Sample" @demo.invalid, orders/forecast/requests on demo people, one focus point "Edge test focus") | So the new Edge screens have something to show. `db/wipe-demo.sql` removes them (except the one test focus point, which belongs to admin@) |

## 11. Four lead sources only (`db/005-drop-source-detail.sql`), 2026-10-21, approved by Yousef

| # | Change | Why |
|---|---|---|
| 48 | `contacts.source_detail` dropped (it held labels such as Instagram, Facebook, Referral, Clinic visit; only demo data had any) | "We should only have 4 lead sources: Meta, Events, Warm Leads, Cold Leads" (option 2). The sources stay in `source_kind` (social = Meta ads, event, warm, cold). My Fifty and Edge stopped reading the column first; notifications now say "New Meta lead" |

## 12. Still to do in v2 (not done yet)

- **Data feeds** for Meta leads, Quo calls and texts, and Stripe payments, rebuilt for the v2 tables. Edge's ingest functions write to the old sandbox schema, so they can't just be redeployed.
- **Supabase Auth → Google** needs a Google OAuth client ID and secret, entered in the v2 dashboard.

## 13. Owner decisions on the Edge test run, 2026-10-22 (no database change)

Rules both apps share, changed in code only (no table, field, enum, function, trigger, policy, index or cron job changed).

| # | Change | Where |
|---|---|---|
| S1 | A no-show visit (status no_show, or a visit logged as not reached) is not a visit for going cold | `api/_book.js` (shared with Edge `api/_edge/book.js`) |
| F9 | A server error (5xx) answers only `server_error`; the detail is logged on the server only (4xx answers unchanged) | `api/_http.js` (shared with Edge `api/_edge/http.js`) |
| SH | A request value that cannot become text (a list or object such as `{"toString":"x"}`) is bad input (400), never a server error: `clean()` / `isUuid()` type-check and `route()` turns such a conversion error into 400 | `api/_http.js` (shared with Edge `api/_edge/http.js`) |
| LO | Fillers listed saypha, Restylane, Juvederm, Belotero, Teoxane (RHA), Revanesse, Stylage, Yvoire, Other, None; PRP/PRF starts with Exprecell PRF (the rules' order; order only, same values). My Fifty's own screen lists in `app.js` are unchanged | `api/_lists.js` (shared with Edge `api/_edge/lists.js`) |
| F6 | Who may order, the same in both apps: the main contact of a signed onboarding (never the injector on it), or anyone with an earlier order not cancelled or rejected. Edge's `place_order` and Place order button now use My Fifty's query | Edge `api/_edge/reads.js` readyToOrder (My Fifty unchanged) |
| F5 | Edge admins see and may act on every customer (unassigned leads included); reps unchanged. `book()` takes `opts.everyone`, which only Edge passes for admins: My Fifty's own book (admins included) is unchanged | `api/_book.js` (shared with Edge `api/_edge/book.js`) |
| Q7 | Search ignores accents and case ("Zoe" finds "Zoë" and the reverse), in both apps, worked out in code (no unaccent extension; v2 has none) | My Fifty `api/data.js` search; Edge `api/_edge/reads.js` search |
