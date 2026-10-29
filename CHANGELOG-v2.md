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

## 14. The naming review (`renellence-edge/db/v2-008-naming.sql`), 2026-10-22, approved by Yousef

Approved in the "Edge Naming Review" (every change, plus `forecasts.tag` → `customer_benefit`, singular). Applied on
2026-10-22 in one transaction (196 ms) after a practice run inside `begin … rollback` (25 of 25 checks) and both apps'
tests against the practice-applied schema; My Fifty (main, 36cecdd) and Edge (no-hubspot, 08a5bb7) were pushed right
after. pg_cron `my-fifty-tick` was paused for the switch and **stays paused until go-live** (owner decision, 2026-10-22).
Every row kept (805 contacts, 553 orders, 8 connections, 3,743 change log rows before and after).

| # | Change | Why |
|---|---|---|
| 49 | Tables renamed: `user_connections` → `connections`, `ad_metrics_daily` → `ad_daily_metrics`, `change_log` → `change_logs` | Tables are plural nouns; the last word is the thing stored |
| 50 | 78 columns renamed (contacts.source_detail was already gone, so 79 in the review), e.g. users `name/active/language/settings` → `full_name/is_active/language_code/preferences`; contacts `mobile` → `mobile_phone`, `source_kind/source_ad_id/source_event_id` → `lead_source/lead_source_ad_object_id/lead_source_event_id`, `medical_director_id` → `medical_director_contact_id`, `qbo_customer_id` → `quickbooks_customer_id`, `merged_into_id` → `merged_into_contact_id`; every "who did it" link gains `_id` (`created_by_id`, `placed_by_id`, `approved_by_id`, `entered_by_id`, `invited_by_id`, `decided_by_id`, `uploaded_by_id`, `updated_by_id`, `licence_verified_by_id`); orders `md_contact_id/md_signed_at/qbo_invoice_id/tax/shipping/discount` → `medical_director_contact_id/medical_director_signed_at/quickbooks_invoice_id/tax_amount/shipping_amount/discount_amount`; forecasts `expected_date/tag` → `due_date/customer_benefit`; targets `period_start/period_end/value` → `period_start_date/period_end_date/target_value`; tasks `type` → `kind`; expenses `spent_on/type` → `expense_date/category`; order_lines `sku/name/external_line_id` → `product_sku/product_name/external_id`; change_logs `at/field` → `changed_at/field_name`; files `name` → `file_name`; the full list is in the SQL file and the dictionary | The 12 naming rules (SOP section 3) |
| 51 | List types renamed to `<table>_<column>`: `tasks_kind`, `expenses_category`, `forecasts_customer_benefit`, `contacts_lead_source`, `connections_provider`, `connections_status`, `change_logs_actor_kind`, `change_logs_source`, `contacts_fillers_used`, `contacts_prp_used` | One rule for every list |
| 52 | `connections` (option B): `kind` → `provider` with new values meta · stripe · quickbooks · signatureapi; `account` → `external_account`; `credentials` → `credentials_encrypted`; `user_id` empty = a company account; indexes (`provider`, `status`) and (`user_id`) replace (`user_id`, `kind`). **Not added:** unique (`provider`, `external_account`, `user_id`) nulls not distinct, because today's test rows break it (one user has four gmail rows for one mailbox: one connected, three off); add it once they are tidied (no row was deleted) | Company accounts too; company keys never go in this table |
| 53 | New `orders.event_id` (→ events, indexed): the event an admin credits the order to (one per order, attendees' orders only); "Sales from this event" is their sum, derived | Event sales on Edge's event page |
| 54 | Functions rewritten for the new names: `is_admin()`, `me()` (`is_active`), `log_changes()`, `log_settings()` (write `change_logs.changed_at/field_name`; mask `connections.credentials_encrypted`), `change_log_append_only()` → `change_logs_append_only()`; constraint and index names that held an old name renamed. The 37 policies followed the renames by themselves (checked: an admin sees all 805 contacts, a rep only their own 7) | — |
| 55 | Files naming rule (no field): `storage_path` = `<parent table>/<parent id>/<file id>.<ext>`, downloaded as `<name>_<first 8 of id>.<ext>` (helper `api/_files.js`, Edge `api/_edge/files.js`) | Every file named by its id |

Old `change_logs` rows keep the field names they were written with (`active`, `at` …); they are never rewritten.

## 15. Forecast activities (`renellence-edge/db/v2-009-forecast-activities.sql`), 2026-10-23, approved by Yousef

Edge's Forecast page adds Training, Vienna or Event for a customer on an exact day, on its own (no amount, no target);
it replaces the forecast's "Customer reward". Additive only: My Fifty reads neither `forecasts` nor the new table.
**Status: applied 2026-10-23** to v1 (test, 8 demo rewards copied) and v2 (live, 0 copied; no live forecast had a reward). v1 and v2 structure fingerprints match (f001ed138862d428, 1664 items).

| # | Change | Why |
|---|---|---|
| 56 | New enum `forecast_activities_activity_kind` (training · vienna · event) and new table `forecast_activities` (`id`, `contact_id` → contacts on delete cascade, `rep_id` → users, `activity_kind`, `due_date`, `created_by_id` → users, `deleted_at`, `created_at`, `updated_at`), index on `contact_id` | Activities on the Forecast page, apart from money |
| 57 | RLS on, policy `by_contact` as on forecasts (`can_see_contact(contact_id)`), the same grants, triggers `touch_updated_at` and `log_changes` (made after the copy, so the copy adds no change_logs rows) | Same access as forecasts |
| 58 | Live forecasts with a `customer_benefit` copied in on their due day (v2: none live; v1 test copy: 8 demo rows). `forecasts.customer_benefit` stays but Edge no longer writes it; dropping it and its enum is a later step | — |

My Fifty: `test/db/testrun-rls.test.js` lists `forecast_activities` with the other business tables. `contact_id` cascades
so `db/wipe-demo.sql` never stops on an Edge activity of a demo contact.

## 16. Compass, the weekly sales loop (`renellence-edge/db/v2-010-compass.sql`), 2026-10-23, approved by Yousef

The Friday check-in (Edge) -> weekly 1-on-1 (Compass) -> the week in Pulse, and the monthly 1-on-1. Proposal:
`compass/docs/compass-data-proposal.md`. The four design choices are the recommended ones: parked-until is derived (not
stored); forecasts from the monthly 1-on-1 are normal forecasts; weekly and monthly sessions share `one_on_ones` (`kind`);
Done and Missed are columns on `account_picks`. **Not included (deferred):** `events.customer_reward` and dropping
`forecast_activities`. Additive only: no existing row changes, apart from the new `settings` row.
**Status: APPLIED 2026-10-23 by the owner** to v1 (enum value added first in the SQL editor) and v2 (as postgres,
in one transaction). Both: 30 -> 35 tables, old tables unchanged except settings +1 and its change_logs row, 5 new empty
tables, 7 policies, 9 triggers, `compass` source present. Earlier dry-run on v1 2026-10-23 (rolled back, all checks passed: 30 -> 35 tables, every old table
unchanged except settings +1 and its change_logs row, 5 new empty tables, 7 policies, 9 triggers; the enum line was
skipped there, see below). The owner applies it with the scratchpad's `compass-apply/apply.js`, v1 first, then v2.

| # | Change | Why |
|---|---|---|
| 59 | New enums `account_picks_pick` (visit · call · wait · park), `account_picks_sort_group` (candidate · onboarded · fifty · lead), `account_picks_second_look_decision` (keep · change), `forecast_changes_change_kind` (moved · dropped · pushed_later · reduced · went_up · pulled_forward), `forecast_changes_reason` (clinic_timing · still_has_stock · budget · decision_maker_unreachable · no_next_step · chose_other_brand · estimate_off · more_patient_demand · new_product_line · clinic_pulled_forward), `one_on_ones_kind` (weekly · monthly), `one_on_ones_skill` (price_pushback · ask_for_order · book_next_step · gatekeeper · cold_visit · plan_week), `one_on_ones_roleplay_character` (skeptic · fence_sitter · rusher · fan · gatekeeper · newcomer), `fifty_statuses_status` (on_track · watch · at_risk) | Fixed lists for the Compass screens |
| 60 | `change_logs_source` + `compass` | Compass's writes are told apart in change_logs, like `my_fifty` |
| 61 | New table `checkins` (`rep_id`, `week_start_date` a Monday, `submitted_at`, `help_note`; unique rep + week) | Edge's Friday check-in |
| 62 | New table `account_picks` (`checkin_id` on delete cascade, `contact_id`, frozen `sort_group`, `suggested_pick`, `suggested_reason`, `rep_pick`, `final_pick`, `purpose`, `second_look_fact`, `second_look_decision`, `visit_interaction_id` = Done, `missed_at` = Missed, never both; unique check-in + contact) | Every account sorted on Friday and how its week ended. No missed reason (owner 2026-10-23) |
| 63 | New table `forecast_changes` (`forecast_id`, `checkin_id` on delete cascade, `change_kind`, `reason`, `created_by_id`; no `updated_at`; unique check-in + forecast) | Why a forecast moved; old/new values stay in change_logs |
| 64 | New table `one_on_ones` (`kind`, `rep_id`, `held_by_id`, `session_date`, `checkin_id`, `focus_action_target_count` 1-15, `skill`, `roleplay_character`, `roleplay_done_at`, `completed_at`, `week_confirmed_at`, `deleted_at`; weekly-only fields empty on monthly; unique rep + kind + date) | Weekly and monthly 1-on-1s in Compass |
| 65 | New column `tasks.one_on_one_id` → one_on_ones | Ties the weekly focus task and the manager's commitments to their session |
| 66 | New table `fifty_statuses` (`contact_id`, `month_start_date` the 1st, `status`, `one_on_one_id`, `set_by_id`; unique contact + month) | The monthly My Fifty check |
| 67 | 10 indexes; triggers `touch_updated_at` (4 tables) and `log_changes` (all 5, so every `account_picks` insert is logged, as the owner wants) | SOP sections 3 and 7 |
| 68 | RLS on all 5, helper `can_see_checkin(id)`: checkins = own rows or admin; account_picks and forecast_changes through the rep's own check-in (writes also need the contact to be theirs); one_on_ones = the rep reads their own, only admins write; fifty_statuses = read with the contact, only admins write. Grants as every v2 table | SOP section 7 |
| 69 | New `settings` row `compass`: max_visits 15, park_days 30, second_look_max 4, sampled_no_order_days 20, fifty_quiet_days 30, check-in due Friday (5) 17:00 | Thresholds never hard-coded |

On v1 the enum types belong to `postgres` while the test connection is `test_runner`, so `apply.js v1` refuses until
this one line has been run on v1 as postgres (Supabase SQL editor): `alter type change_logs_source add value if not
exists 'compass';`. On v2 it runs inside the one transaction. My Fifty: `test/db/testrun-rls.test.js` lists the five
new tables. The demo wipes (`db/wipe-demo.sql`, Edge's `db/wipe-edge-test.sql`) don't clear Compass rows yet; add them
when Compass writes demo rows.

## 17. Order dispatch tracking (`renellence-edge/db/v2-011-order-dispatch.sql`), 2026-10-23, PROPOSED, NOT APPLIED

Data map risk #4 (owner 2026-10-23, "make those fixes"): nothing tracked whether n8n took an order, nor retried it with a
limit, nor told anyone. **Waiting for the owner's yes.** Dry run on v1 2026-10-23 (rolled back, all checks passed: no
table count changed except settings +1 and its change_logs row, existing orders rows untouched). Apply with
`node renellence-ops/ops/fixes/apply-v2-011.js v2 --dry`, then without `--dry`.

| # | Change | Why |
|---|---|---|
| 70 | New enum `orders_dispatch_status` (queued · sent · failed) | The hand-off to n8n |
| 71 | New columns on `orders`: `dispatch_status`, `dispatch_attempts` (default 0), `dispatch_last_attempt_at`, `dispatch_error_message`, `dispatched_at`; check attempts ≥ 0; partial index on queued orders | Pulse / Edge "Send for approval", Pulse's timer retry, the daily reconciliation's "stuck" list. Invoiced / charged already live in `orders.status`, `invoiced_at`, `payments` |
| 72 | New `settings` row `order_dispatch`: `pulse` false, `edge` false (the switch), max_attempts 5, retry_after_minutes 15, stuck thresholds, alert_email info@ | Off by default; nothing changes until the owner turns it on |

Code (behind the switch): shared `my-fifty/api/_dispatch.js` = `renellence-edge/api/_edge/dispatch.js`. n8n side:
`renellence-ops/ops/n8n/order-dispatch-proposal.md` (proposal only). When applied, add the five columns to the SOP
(Section 10, `orders`) and the dictionary artifacts.

## 18. Intake health (`renellence-edge/db/v2-012-ingest-health.sql`), 2026-10-23, PROPOSED, NOT APPLIED

Data map risk #5 (owner 2026-10-23): the integrations can stop silently. **Waiting for the owner's yes (one new table).**
Apply with `node renellence-ops/ops/fixes/apply-v2-012.js v2 --dry`, then without `--dry`. De-duplication needs no
change: `ingest_events` already has UNIQUE (`source`, `external_id`).

| # | Change | Why |
|---|---|---|
| 73 | `ingest_events_source` gains `signatureapi` | Its callback can land in `ingest_events` once switched over |
| 74 | New table `ingest_rejections` (source, day, rejected, last_reason, last_at; UNIQUE source + day; RLS, admins read) | Refused webhook deliveries counted, nothing of them kept; the daily report flags them (an expired or changed secret) |
| 75 | Indexes `ingest_events_failed_idx` (partial, failed) and `ingest_events_source_received_idx` | The failed-events list / replay and the per-source daily counts |

Code: `renellence-edge/supabase/functions/_shared/guard.ts` + `ingest.ts` (signatures, once-only, not deployed),
`renellence-ops/ops/ingest/replay.js`, `renellence-ops/ops/health/daily-report.js`, n8n side
`renellence-ops/ops/n8n/health-email-proposal.md`. When applied, add `ingest_rejections` to the SOP (System section).

## 19. One attendees table for events and expenses (`renellence-edge/db/v2-013-attendees.sql`), 2026-10-27, approved by Yousef

Edge's Expenses page asks who was at a meal (Lunch, Dinner, Snacks/Beverages; never Parking): customers picked from the
book, or a name typed in with a role. The owner chose one table for event and expense attendees ("option 1") over a
separate `expense_attendees`. **Status: applied to v1 and v2 2026-10-27** (v2 run by Yousef after a backup that day; 114 rows kept; Edge and Compass
pushed right after; check.js: only the 4 known fix-staff-rls policies differ).

| # | Change | Why |
|---|---|---|
| 76 | `event_attendees` renamed `attendees`; list type `event_attendees_status` → `attendees_status`; its constraints and index renamed to match | One table for everyone who was at an event or a meal |
| 77 | New columns `expense_id` (→ expenses), `first_name`, `last_name`, `role` (contacts_role) | Expense attendees: a linked customer or a typed name with a role |
| 78 | Checks `attendees_one_parent` (exactly one of event_id / expense_id) and `attendees_person` (a contact or a typed first name); unique (expense_id, contact_id); index on expense_id | The SOP's "one nullable link per parent + exactly one filled" rule |
| 79 | Policies: the three event policies now cover event rows only; new `by_expense` (all commands) follows the expense's owner, or an admin | Expense rows have no contact to check for typed names |

Code: Edge `api/_edge/reads.js` / `writes.js` (expense_submit saves attendees; the list shows "3 people"), `web/src/pages/Expenses.jsx`;
Compass `api/_compass/reads.js` / `rules.js` (event rows only). Pulse doesn't read the table. Test: `renellence-edge/test/run/db-attendees.test.js`.

## 20. Daily goal 8 → 5 (settings data only), 2026-10-27, approved by Yousef

The new Pulse design (Edge – Final Mockup (2), F2) counts 5 touchpoints a day for the streak ("3/5", "Streak saved" at 5).
Yousef chose "Change to 5" when asked before the UI rebuild. **Status: applied to v2 2026-10-27.** No schema change.

| # | Change | Why |
|---|---|---|
| 80 | `settings` key `my_fifty`: `daily_goal` 8 → 5 (the other values unchanged) | The streak and the day ring now count 5 reached calls and in-person visits |

Note: Edge and Compass read the same setting (shared `_book.js` settings), so their day goal shows 5 too.

## 21. Backfill Oct 22 → Oct 27 (data only), 2026-10-27, approved by Yousef

The owner asked to bring v2 up to date with everything that happened in HubSpot, SignatureAPI, Quo and Edge since the
Oct 22 export (11:36 Toronto), **without wiping**. Fresh read-only pulls into `renellence-ops/data/backfill-2026-10-27/`,
the same scope, cleaning and build as Oct 22 (fixed ids), then `migration-load/delta.js` (dry run first, backup first:
`data/backups/2026-10-27T19-25-13-504Z`). **Status: committed to v2 2026-10-27.** No schema change.

| # | Change | Why |
|---|---|---|
| 81 | Added: 20 contacts (17 new since Oct 22 + 3 left out then that now qualify by new activity), 11 clinics, 6 attendees, 11 orders, 31 order lines, 6 payments, 237 interactions, 44 AI summaries, 3 tasks, 19 agreements, 26 signers, 12 onboardings, 3 forecasts | Missing since the Oct 22 export |
| 82 | Existing rows not edited in v2 since the load took the newer source values (e.g. 4 orders delivered, 5 onboardings completed, 9 tasks done); rows edited in v2 only had blank fields filled | Owner: "v2 wins, HubSpot fills gaps" |

Rules: Oct 22 decisions stand (the 162 contacts left out then stay out); nothing deleted in v2 since came back (a row is
added only if it was not in the Oct 22 load). Report: `backfill-2026-10-27/migration-load/delta-commit.log`.

## 22. Quo calls and texts from unknown numbers (`renellence-edge/db/v2-014-quo-unmatched.sql`), 2026-10-27, approved by Yousef

Owner's rule (2026-10-23, option 2): Quo never creates contacts; calls/texts from numbers not in v2 are held quietly and
attach when a contact gets that number. The owner approved the holding table on 2026-10-27. **Status: applied to v1 and
v2 2026-10-27** (`renellence-ops/ops/fixes/apply-v2-014.js`, dry runs first; the trigger proven in a rolled-back savepoint).

| # | Change | Why |
|---|---|---|
| 83 | New table `quo_unmatched` (phone, kind, direction, quo_id UNIQUE, line_id, occurred_at, payload, attached_contact_id, attached_at; RLS on, admins read; touch_updated_at + log_changes triggers) | Calls/texts waiting for a contact, never shown to reps |
| 84 | New functions `migration_uid(text)` (the migration's fixed ids) and `attach_quo_unmatched()`; trigger `attach_quo_unmatched` AFTER INSERT OR UPDATE OF phone, mobile_phone ON contacts | Any path that creates a contact (Pulse, Edge, n8n intake, imports) picks up its held calls/texts and Quo summaries |

Code: Pulse `api/quo.js` (Quo webhook: known number -> interactions source quo; unknown -> quo_unmatched; summaries ->
ai_outputs; the 647 automated line's outgoing texts skipped). Add `quo_unmatched` to the SOP (System section).

## 23. Notification kind for the 3 pm streak nudge (`renellence-edge/db/v2-015-streak-nudge.sql`), 2026-10-28, approved by Yousef

Owner (2026-10-28): Nell's Nudge (Final Mockup (3) N4) also goes to the phone at 3 pm on workdays. **Status: applied to v2
2026-10-28** (`renellence-ops/ops/fixes/apply-v2-015.js`, dry run first). **Not on v1**: the test login there does not own
the type; run the one line in v1's SQL editor (as postgres) so tests can store a nudge.

| # | Change | Why |
|---|---|---|
| 85 | `notifications_kind` gets the value `streak_nudge` | The 3 pm push is logged once per rep per day like the other pushes (dedupe key `nudge:<user>:<day>`) |

Code: Pulse `api/cron.js` (tick: workdays 3:00-3:30 pm Toronto, a rep with a phone connected, under the day goal and
nothing counted since noon) and `api/_nell.js`.

## 24. Two Pulse test orders marked disapproved (data only), 2026-10-28, asked by Yousef

Aria disapproved three of the owner's Pulse test orders (sales-form runs 21342, 21452 and 21455, `approved: false`), but the
workflow never told Pulse. The three orders (1f012f3a…, 99e0d0a6…, 8ded53df…) were set `submitted` → `rejected` (Pulse shows
"Disapproved"). From now on the workflow's "Pulse: Order Decision" step does this (`api/cron.js` op=order_decision). No schema change.

## 25. The four disapproved Pulse test orders removed (data only), 2026-10-28, asked by Yousef

Owner: "delete all of those ones that got disapproved". Orders 1f012f3a…, 99e0d0a6…, 8ded53df…, 7cdd966c… (all the
owner's own Pulse tests at one customer, all `rejected`) were soft-deleted (`deleted_at` set, SOP: never hard-delete), like
the first test order b4bcf978 on 2026-10-27. Nothing else changed. No schema change.

## 26. Leigh Bishop moved from Emily to Lucas (data only), 2026-10-28, asked by Yousef

Owner: "if its not lucas change it to lucas". Contact 47114c8b… (Leigh Bishop) had `owner_id` = Emily (8e7b8b7d…); set to
Lucas (d8b51a6c…) with `updated_at`. Only the contact's owner changed: past interactions, orders and tasks keep who did
them (Emily had no open tasks on her). No schema change.

## 27. Claude job run log and result kinds (`renellence-edge/db/v2-016-ai-runs.sql`), 2026-10-28, approved by Yousef

The owner approved the Claude API system (2026-10-28: one Supabase function `claude-jobs` runs every job; prompts from the
Data Map page). **Status: applied to v2 2026-10-28** (`renellence-ops/ops/fixes/apply-v2-016.js`, dry run first: change,
checks and a test write, rolled back). **Not on v1**: its login (test_runner) doesn't own the enum types, so v1 has neither
this nor v2-015 yet; it needs the v1 owner login.

| # | Change | Why |
|---|---|---|
| 85 | New table `ai_runs` (one row per Claude run: job, prompt version and hash, models planned and used, result claude/rules/none, attempts, fallbacks, tokens, cost_usd, validation, blocked, stopped, cap, month spend before/after, output, ms; RLS on, admins read; append-only, no triggers) | The run log and the $100/month cost cap (`ops/claude` ledger, moved from a local file into v2 so the Supabase function can use it) |
| 86 | `ai_outputs_kind` gains `data_health`, `enrichment`, `gap_ranking`, `monday_prep`, `focus_actions`, `meeting_notes` | Where each job's result is kept (call summaries, voice notes and lead clean-up already had kinds) |

Added to the SOP (2026-10-28), with the exception that data_health, gap_ranking, monday_prep and meeting_notes rows link to
no single record (the rep, week or month is in `output_json`).

Data (no schema change), same day: settings rows `claude` ({monthly_cap_usd: 100, jobs_on: {}}) and `claude_prompts` (the
shared prompt plus ten job prompts from the Data Map page; `renellence-ops/ops/claude/sync-prompts.cjs`). The live tests of
the jobs on 2026-10-28 wrote real proposals to `ai_outputs` (1 data_health, 2 lead_cleanup, 3 call_summary, 1
monday_prep, 1 gap_ranking, 1 meeting_notes, 2 enrichment) and their `ai_runs` rows; they are ordinary results awaiting
review, not test data.

## 28. City location cache for the Territory map (data only), 2026-10-28

No schema change. renellence-admin's Territory map keeps the coordinates of each CITY (never a clinic or a person's address),
looked up on OpenStreetMap's Nominatim, in a new `settings` row `geo_cities` (`{"ON|toronto": [lat, lng]}`, or `0` for no such
place). The row is created the first time an admin opens Territory on v2; each save goes through `asUser`, so `change_logs`
records it. Reassign (same app) changes `contacts.owner_id`, open `tasks.assignee_id` and `forecasts.rep_id` from this month on,
one `change_logs` batch per reassign; nothing else.

## 29. Emily's Leads clean-up (data only), 2026-10-28, asked by Yousef ("b")

From the owner's check of Emily's Leads page. `renellence-ops/ops/fixes/emily-cleanup-2026-10-28.js` (dry run first; backup in
`renellence-ops/data/backups/emily-cleanup-*.json`; source 'import', one batch).

- Soft-deleted two staff numbers that Quo -> HubSpot -> the HubSpot pull had made into customers: "Yousef" (+1 647 863 0027) and
  "Brittany Houston" (+1 778 707 9023). Neither had orders.
- Merged four duplicates (calls, meetings, notes, tasks, orders moved to the one kept; the other `merged_into_contact_id` + `deleted_at`;
  blanks filled): Kylie Cheng (The Scene Medical; kept the one with history, lead source event), Bhav Dhillon (kept Gold Tan and
  Sunset Spa, email added), Jessie Tian ("Jessie Heos Toronto" merged in, its number as mobile), Leigh Bishop (Emily's "DrLeigh
  Bishop" merged into Lucas's, #26). PL Bastian left as is.
- Emily's Leads after: Other Warm 43 (10 new), Social Media 51 (5 new), Events and Training 14 (3 new), Cold 0.

## 29. Final data clean: clinic phones/addresses from the web (data only), 2026-10-28, asked by Yousef

Owner's four rules: (1) fill missing addresses/numbers/names from Google, high confidence only; (2) delete @renellence,
@accuristix, FedEx and Purolator accounts; (3) flag contacts named Yousef/Emily/Brittany/Aria/Lucas/Sam (not the staff
users); (4) flag contacts with no name. No schema change.
- **(1)** Web research (two Sonnet research agents, own sites first) on the 403 clinics missing an address part or phone and
  the 37 contacts missing a last name. Only `high` values, only into blank fields, never overwriting:
  117 clinics changed: 117 `main_phone`, 3 `street`, 4 `postal_code`, 1 `province` (125 `change_logs` rows, source `import`,
  batch 61949005-892f-47c0-9763-d3b71bf77e2e). No last name reached high confidence, so none was written. "Mysite"
  (fb7b3869…) was left out by hand (site-builder default name). Script `renellence-ops/ops/fixes/final-clean-2026-10-28.js`
  (dry run first); backup `renellence-ops/data/backups/final-clean-v2-2026-10-28T20-14-19-404Z.json`. Still blank after:
  285 clinic phones, 148 clinics with an address gap (mostly clinics with no website).
- **(2)** 0 matches in v2 (contacts or clinics); nothing deleted.
- **(3) and (4)** listed for the owner, nothing changed: 2 staff-name contacts ("Yousef" 49feb434…, "Brittany Houston"
  74a1663d…) and 14 no-name contacts. Most came from the old Quo->HubSpot webhook creating phone-only HubSpot contacts for
  unknown numbers, which the HubSpot pull copied into v2; that path is fixed in hubspot-automation cfb832a. The owner chose
  to keep the 16 Quo-made contacts with only Quo activity (no soft-delete).

## 30. Quo-made contacts removed (data only), 2026-10-28, asked by Yousef

Owner: "remove yousef, brittany houston, remove everything made by the quo problem except if it has activity (other than the
call that originally created the customer)". "Yousef" (49feb434…) and "Brittany Houston" (74a1663d…) were already
soft-deleted at 20:09 UTC by the HubSpot intake (deleted in HubSpot). Of the other Quo-made contacts, 3 had nothing but the
one call/text that created them and were soft-deleted with that interaction: 2ac3ef7a… (no name, Toronto Cosmetic Clinic),
42bec5cd… (no name, +14374762072), 2c1d7a4b… (Elizabeth Savytska). Each call/text went back to `quo_unmatched` (waiting), so it
attaches again, once, if a rep creates a contact with that number. Script `renellence-ops/ops/fixes/remove-quo-made-2026-10-28.js`
(dry run first; refuses any contact with other activity); backup `data/backups/remove-quo-made-v2-2026-10-28T20-18-57-300Z.json`.
The Quo-made contacts with more activity stay. The HubSpot records are untouched. No schema change.

## 30. Sam's pages clean-up (data only), 2026-10-28, asked by Yousef

`renellence-ops/ops/fixes/sam-cleanup-2026-10-28.js` (dry run first; backup in `renellence-ops/data/backups/sam-cleanup-*.json`; source 'import').

- Merged "Ireen Girgis" (made by her Oct 23 onboarding) into "Ireen Grigis" (Royal West Medical, her orders); the kept one is now
  spelled **Girgis**. Every reference moved (forecast, task, email, the Oct 23 onboarding, its agreement and signer); 6 emails that were
  on both were kept once. The merged one: `merged_into_contact_id` + `deleted_at`. Its phone +1 416 200 3209 is only in the backup
  (the kept one already has a phone and a mobile).
- Renamed three follow-ups imported with wrong titles: Angie, Amy Thompson and Michelle Osow are now "Follow up with <name>".

## 31. Last nameless contacts: 2 removed, 4 named (data only), 2026-10-28, asked by Yousef

Owner: "remove 6046691811, c153b3ed, the rest if ur sure or fairly sure edit it". Soft-deleted 3a21e6d1… (no name,
+16046691811, 2 Quo calls, requeued to `quo_unmatched`) and c153b3ed… (completely empty) with
`remove-quo-made-2026-10-28.js --any-quo` (backup `remove-quo-made-v2-2026-10-28T20-21-32-322Z.json`). Named from their own
emails / Quo call summaries (`renellence-ops/ops/fixes/name-nameless-2026-10-28.js`, blank fields only, backup first):
9d510bcd… Taylor Wettlaufer (Rx Cosmetics), 5d6dc307… Louise (MD Skin Lab), 8b7482ed… Dorsa (Advanced Aesthetics),
113cf1ae… Anna (Vita Cosmetic and Laser Clinic). Then (owner: "rename front desk lines to front desk") first_name "Front Desk" on 0c5a2c73… (Miracle Beauty), 82936191… and
0da77e42… (Wellness Centre 4 You). Still nameless: YS Cosmetic, Gates Beauty, Cesthetique (web search found no person). No schema change.

## 32. Account Review edits applied (data only), 2026-10-28, asked by Yousef

Owner: "apply those 9". The manager's 9 contact edits from the Account Review page (artifact 4NcdbdwTeHF4SCGxfjGTkW, db `c/`,
all made 2026-10-22; no clinic edits) applied with `renellence-ops/ops/fixes/account-review-apply.js` (dry run first; a field
edited in the apps since the load would have been kept, none was). Changed (7 contacts): Mehrnoush Sohrabirad role injector /
designation rn; Vlassopoulos (Koukla Aesthetics) first_name Alaini, email koukla1@shaw.ca, role injector, designation other;
Tereza Gindi role injector -> manager; Tatiana Fras and Sonilla Majeed owner Info -> Emily; Amanda Lau owner Info -> Brittany;
Anne-Marie Pion linked to clinic HubSpot 219789014003. 2 contacts already had the values. The 3 reassigned contacts had no open
tasks or forecasts. Backup `data/backups/account-review-v2-2026-10-28T20-26-24-008Z.json`. No schema change.

## 31. Lucas's duplicates merged (data only), 2026-10-28, asked by Yousef

`renellence-ops/ops/fixes/merge-contacts.js renellence-ops/data/merges/lucas-2026-10-28.json` (a reusable merge: every reference moves to the
one kept, except change_logs; a row the kept one already has is kept once and the copy is in the backup; dry run first; backup in
`renellence-ops/data/backups/merge-*.json`).

- Faranak Laalroshan, Jessica Carl, Igor Wilderman and Bryce Leontowicz: the empty copies from the launch-event list merged into the
  real records (their event RSVP moved; a duplicate Friday check-in pick removed).
- Rana Zeineddine merged into Rana Majed-Zeineddine (same phone; her Oct 27 order moved to the onboarded record).
- Pinkal Ghindi (event, misspelt) merged into Pinkal Gandhi.
- Lucas's Leads after: Events and Training 28 (14 new), Other Warm 55 (16 new), Onboarded 6.

## 33. Messy names from the Pulse test pass (data only), 2026-10-28, asked by Yousef

Owner: "edit the ones you have high confidence for, and mark the rest". `renellence-ops/ops/fixes/messy-names-2026-10-28.js`
(dry run first; each edit checks the old value; backup `data/backups/messy-names-v2-2026-10-28T20-58-07-701Z.json`; source
'import', batch 7de757c0-e0b1-4d99-9e7c-c44bbdbb9372, 9 `change_logs` rows). No schema change.
- aab0120b… "Service Thelaserclinic.ca" -> "Front Desk" (The Laser Clinic's service@ inbox; owner rule for shared lines).
- 4d8cedfc… "Patel" moved from first to last name (Ibody, designation md, shows as "Dr. Patel").
- cae00e7e… "Atlas Atlas" -> "Allahyar Atlas" (his email allahyar.atlas1@).
- d11f37e0… Hasti unlinked from the placeholder clinic "Just an Injector Not Owner", which was soft-deleted (no other links).
- Clinic typos: "Vita Cosmetic and Laser CLinic" -> "Clinic", "Tara Comsmetic Clinic" -> "Tara Cosmetic Clinic".
- Left for the owner (not sure enough): 625bed0a… "Northern" (director@northernlightswomensclinic.com, no person name),
  15715d1f… Bita's clinic "Elite Medical Clo" (cut off; no website) and no owner, the three nameless contacts (YS Cosmetic,
  Gates Beauty, Cesthetique; web search in #31 found no person), and 41 first-name-only contacts (#29 found no last name at
  high confidence).

## 34. Full v2 audit: safe fixes (data only), 2026-10-28, asked by Yousef

A read-only audit of all 37 tables, then the owner said "make the safe fixes". `renellence-ops/ops/fixes/audit-safe-fixes-2026-10-28.js`
(dry run first; each fix checks the old value; backup `data/backups/audit-safe-fixes-v2-2026-10-28T21-09-52-120Z.json`; source
'import', batch ce1dc5ae-a573-4624-ab38-c31201d60577). No schema change.
- Rana's Oct 27 Shopify order #123365466 had landed on her merged-away copy (#31) and was moved to the kept record (8608bb6a…).
- Ina Zhou: the empty copy 053dccf9… merged into 6943fdd0… with `merge-contacts.js data/merges/audit-2026-10-28.json` (her event
  RSVP moved; backup `merge-2026-10-28T21-09-54-482Z.json`).
- 7 clinics with no live contact soft-deleted (left by merges): Essence of Beauty Skin Health and Aesthetics, Shawna Leifso-Subtly
  You Inc., Dr Ireen Girgis, Nurse Injector Bhav, The Scene Medical, Toronto Cosmetic Clinic, Espace Skins.
- Studio Sheeque: the email that sat in the contact's and the clinic's phone fields removed. US zips cleared as postal codes on
  O Esthetics (15205) and Thrive Aurora (60504). One shipping city written in Arabic -> Montreal.
- 3 MD signers on agreements completed Oct 27 (Vero Dorval, Vijeta Singh, Fariba Shahin) marked signed at the completion time.
- 3 duplicate open follow-ups soft-deleted (Kandaeya Daniel, Min Je Woo, Sareena Multani; one copy of each kept).
- 6 Quo calls/texts on the deleted staff contacts "Yousef" and "Brittany Houston" soft-deleted.
- 35 signer names trimmed of stray spaces.
- Not changed, after a closer look: 8 Compass picks on merged contacts (each kept contact already has its own pick that week) and
  29 "off" Gmail connection rows (some updated today, part of the connect flow).
- Open owner questions from the audit: shared phone numbers log one Quo call on both contacts (45 times); 29 Shopify orders with
  no rep and 80 with a rep who isn't the owner; 36 "medical directors" with role injector (4 other) and 5 md designations on
  non-physicians; 34 unsigned onboardings, 21 waiting training agreements, 9 MD agreements with no order; 142 contacts with no
  role, 39 with no email or phone; 2 customers with orders but no shipping address; duplicate clinic names in two cities (Gold
  Tan and Sunset Spa, Dream Esthetiques MD); order #106565379 delivered with no lines; a call with Tara Tameta dated Nov 4.

## 35. The 5-minute timer in three parts (pg_cron, no table change), 2026-10-28, approved by Yousef (data-flow improvement 5)

`db/006-cron-parts.sql`, applied to v2. The one job `my-fifty-tick` (all steps in one 60-second Vercel run) is now three jobs,
each every 5 minutes with the same Vault key: `my-fifty-tick` (`part=core`: Meta, pushes, nudge, snapshot, order resends, Stripe
retries, alarms), `my-fifty-tick-hubspot` (`part=hubspot`: the HubSpot pull, the bridge) and `my-fifty-tick-sync`
(`part=sync`: SignatureAPI, Gmail). Undo: re-run `db/003-cron.sql`.

## 36. Shared Quo numbers on one contact, MD flags from the onboarding form (data + code), 2026-10-28, asked by Yousef

Owner's answers to the #34 audit questions: shared numbers "one contact only, let Claude decide"; medical directors "whichever is
pulled from the onboarding form is the source of truth"; old paperwork and the smaller items left as they are. No schema change.
- Quo, existing rows: `renellence-ops/ops/fixes/quo-shared-numbers-2026-10-28.js` soft-deleted the second copy of 45 calls/texts
  (backup `data/backups/quo-shared-v2-2026-10-28T22-17-54-137Z.json`, source 'import', batch 51522d1b-5cec-4031-ae07-bcc90bcb74d7).
  Kept on: Gina Maalouf (9, not Ireen Girgis), Ladan Koupaei (14, Emily's line and contact, not Ireen), Kazimir Duclervil (3, not
  Monica), Kendaeya Daniel (5, not Rita Tamas), Elvira Soloman (13, not Elizabeth Broniek), Naghmeh Badiei (1, not Elham Hajebi).
  None left on two contacts.
- Quo, from now on (`api/quo.js` contactsFor): a number two contacts share goes on one only: the line rep's own contact, then
  not the medical director, then the most history, then the oldest. Test `test/db/quo.test.js` (shared number).
- MD flags: `renellence-ops/ops/fixes/md-from-onboarding-2026-10-28.js` (backup `data/backups/md-from-onboarding-v2-2026-10-28T22-20-54-783Z.json`,
  batch b4299929-6990-4934-b68f-4eefc59c9815). The form makes someone an MD when its MD section names them, or when the injector
  ticks MD and names no other MD. MD flag on: Chelan Schwindt, Christine Paggos, Liat Skribovski, Nima Naghshgar, S. Blesko, Ireen
  Girgis, Loredana Litoiu, Olga Gaponenko, Rana Elsabbagh, Tiffany Liu. Designation md and role physician: Loredana, Olga, Rana,
  Tiffany, Neel Bector, Rita Tamas. Stevie Blanchard designation rn. Contacts the form says nothing about were left alone.
- Left flagged (the form names no MD for them): Bimpe Ayeni (RN), Marlon Navarro (RPN), Samira Rafiei (NP).

## 37. Live Edge forecasts flow into v2 (code, no schema change), 2026-10-29, asked by Yousef

Owner: "if they make a new forecast on old edge will it show on pulse and new edge" ... "do #2 (its necessary for now)".
Live Edge (renellence-edge `main`) keeps forecasts in its own KV store (`territory:<rep>`), never in HubSpot, so nothing
carried them into v2 after Oct 22. Now each save in live Edge (`api/_v2forecasts.js`) posts what changed to Pulse
`/api/intake` (`{wf:'Edge', kind:'forecasts'}`, `api/_edgefc.js`), kept once in `ingest_events` (source n8n, via webhook),
written to `forecasts` with change_logs source `edge_app`:
- ids are the Oct 22 migration's (`uid('forecast:territory:<rep>:<rowId>')`), so a loaded forecast changed in live Edge
  updates the same v2 row (checked: 136 of the 160 rows in the Oct 22 copy found by id; the other 24 were skipped then);
- a save writes the rows it added or edited and deletes (deleted_at) the rows it removed; rows it didn't change are left
  as v2 has them (only added if v2 never had them), so edits in Pulse / new Edge are not overwritten;
- once per rep (first read or save after the change) a catch-up sends the whole list: adds what v2 lacks, updates or
  deletes only rows untouched in v2 since Oct 22; an empty list never deletes;
- the migration's skip rules: no quantity, no date, test rows, contact not in v2, admin@'s own rows.
Test `test/db/edge-forecasts.test.js`; live Edge `test/v2forecasts.test.js`. Undo: revert the two commits.
