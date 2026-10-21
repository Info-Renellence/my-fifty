-- Removes every row made by scripts/seed-demo.js (run before go-live). Real setup data (products, settings, staff) stays.
-- Demo rows are: users @demo.invalid; clinics, contacts and orders with legacy_id 'demo-…'; events named '… (demo)';
-- and everything hanging off them, including their change_log rows.
-- Test run 2026-10-21 (test/run/seed-test-data.js and the testing agent) adds: users test.*@demo.invalid; legacy_id 'demo-test-…';
-- contacts owned by a demo user or with an @demo.invalid email (people added through the app during the run);
-- clinics named 'Testrun …' that nobody is left at; ad_objects with meta_id 'demo-test-…'; ingest_events with a 'demo-test' key.
--
-- change_log is append-only and has real foreign keys to contacts and users, so this one clean-up runs with triggers
-- off (session_replication_role = replica, which also turns off the foreign-key checks for this transaction). That is
-- only acceptable because every row removed here is fictional; never use this pattern on real data.
begin;
set local session_replication_role = replica;

create temp table demo_users on commit drop as select id from users where email like '%@demo.invalid';
create temp table demo_contacts on commit drop as select id from contacts where legacy_id like 'demo-%' or email::text like '%@demo.invalid'
  or owner_id in (select id from demo_users);
create temp table demo_orders on commit drop as select id from orders where legacy_id like 'demo-%' or contact_id in (select id from demo_contacts);

delete from notifications where contact_id in (select id from demo_contacts) or order_id in (select id from demo_orders) or user_id in (select id from demo_users);
delete from ai_outputs where contact_id in (select id from demo_contacts) or interaction_id in (select id from interactions where contact_id in (select id from demo_contacts));
delete from tasks where contact_id in (select id from demo_contacts);
delete from files where contact_id in (select id from demo_contacts) or order_id in (select id from demo_orders);
delete from interactions where contact_id in (select id from demo_contacts);
delete from payments where order_id in (select id from demo_orders);
delete from order_lines where order_id in (select id from demo_orders);
delete from onboardings where primary_contact_id in (select id from demo_contacts) or injector_contact_id in (select id from demo_contacts) or md_contact_id in (select id from demo_contacts);
delete from agreement_signers where contact_id in (select id from demo_contacts) or agreement_id in (select id from agreements where contact_id in (select id from demo_contacts) or order_id in (select id from demo_orders));
delete from agreements where contact_id in (select id from demo_contacts) or order_id in (select id from demo_orders);
delete from orders where id in (select id from demo_orders);
delete from event_attendees where contact_id in (select id from demo_contacts);
update contacts set source_event_id = null where id in (select id from demo_contacts);
delete from events where name like '% (demo)';
delete from forecasts where contact_id in (select id from demo_contacts);
delete from contacts where id in (select id from demo_contacts);
delete from clinics where legacy_id like 'demo-%' or (name like 'Testrun %' and not exists (select 1 from contacts c where c.clinic_id = clinics.id));
delete from ad_objects where meta_id like 'demo-test-%' and parent_id is not null;
delete from ad_objects where meta_id like 'demo-test-%';
delete from ingest_events where external_key like '%demo-test%';
delete from user_connections where user_id in (select id from demo_users);
delete from change_log where contact_id in (select id from demo_contacts) or actor_user_id in (select id from demo_users)
   or entity_id in (select id from demo_contacts) or entity_id in (select id from demo_orders) or entity_id in (select id from demo_users)
   or (entity_type in ('clinics', 'events', 'interactions', 'tasks', 'order_lines', 'payments', 'agreements', 'agreement_signers', 'onboardings')
       and not exists (select 1 from clinics c where c.id = entity_id) and not exists (select 1 from events e where e.id = entity_id)
       and not exists (select 1 from interactions i where i.id = entity_id) and not exists (select 1 from tasks t where t.id = entity_id)
       and not exists (select 1 from order_lines l where l.id = entity_id) and not exists (select 1 from payments p where p.id = entity_id)
       and not exists (select 1 from agreements a where a.id = entity_id) and not exists (select 1 from agreement_signers g where g.id = entity_id)
       and not exists (select 1 from onboardings o where o.id = entity_id));
-- Edge demo rows (renellence-edge/db/seed-edge-demo.sql): every id starts with ed9e0000.
delete from event_attendees where id::text like 'ed9e0000%';
delete from agreement_signers where id::text like 'ed9e0000%';
delete from agreements where id::text like 'ed9e0000%';
delete from forecasts where id::text like 'ed9e0000%';
delete from marketing_requests where id::text like 'ed9e0000%' or contact_id in (select id from demo_contacts);
delete from expenses where id::text like 'ed9e0000%' or external_id like 'demo-%';
delete from tasks where id::text like 'ed9e0000%';
delete from targets where id::text like 'ed9e0000%';
delete from events where id::text like 'ed9e0000%';
delete from change_log where entity_id::text like 'ed9e0000%';
delete from users where id in (select id from demo_users);
-- Settings the demo touched on real people (snoozes, the "joined your Fifty" bookmark).
update users set settings = settings - 'snoozed' - 'fifty_seen_at' where settings ?| array['snoozed', 'fifty_seen_at'];

commit;
