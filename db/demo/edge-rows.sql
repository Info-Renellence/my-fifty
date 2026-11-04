-- Fictional demo rows for the new Edge screens (Yousef 2026-10-21: "Yes, fictional rows"). Rows only, no structure.
-- They hang off the two demo books (admin@ and info@, contacts with legacy_id 'demo-…') so the Home ring, Forecast,
-- Events, Requests and Expenses have something to show. Every id here starts with 'ed9e0000' so
-- my-fifty/db/wipe-demo.sql can remove them; rows tied to demo contacts go with those contacts anyway.
-- Safe to re-run: each insert skips rows that already exist.
begin;
select set_config('app.source', 'import', true);

create temp table bk on commit drop as
  select u.id as uid, u.email, case when u.email like 'admin@%' then 'demo-contact-' else 'demo-info-contact-' end as pre
    from users u where u.email in ('admin@renellence.com', 'info@renellence.com');

-- Each book's contacts in a stable order, with whether they have a paid-product order.
create temp table bc on commit drop as
  select b.uid, c.id as cid, c.first_name, c.last_name, c.email,
         row_number() over (partition by b.uid order by (exists (select 1 from orders o join order_lines l on l.order_id = o.id
            where o.contact_id = c.id and o.status not in ('rejected','cancelled') and not coalesce(l.is_free,false) and coalesce(l.unit_price,0) > 0)) desc,
            c.legacy_id) as n,
         exists (select 1 from orders o join order_lines l on l.order_id = o.id where o.contact_id = c.id
            and o.status not in ('rejected','cancelled') and not coalesce(l.is_free,false) and coalesce(l.unit_price,0) > 0) as buys
    from bk b join contacts c on c.owner_id = b.uid and c.legacy_id like b.pre || '%' and c.deleted_at is null;

create or replace function pg_temp.did(x text) returns uuid language sql immutable as
  $$ select ('ed9e0000' || substr(md5('edge-demo:' || x), 9))::uuid $$;

-- 1. Monthly targets, July 2026 to June 2027 (the demo's numbers)
insert into targets (id, rep_id, kind, metric, period_start_date, period_end_date, target_value)
select pg_temp.did('target:' || b.email || ':' || m.i), b.uid, 'target', 'ordered',
       (date '2026-07-01' + make_interval(months => m.i))::date,
       (date '2026-07-01' + make_interval(months => m.i + 1) - interval '1 day')::date,
       (array[30000,28000,35000,40000,40000,45000,35000,35000,40000,40000,45000,45000])[m.i + 1]
  from bk b cross join generate_series(0, 11) as m(i)
on conflict (id) do nothing;

-- 2. Upcoming events (both books' reps involved), with seats
insert into events (id, name, kind, starts_at, location, capacity, rep_ids)
select pg_temp.did('event:' || e.k), e.name, e.kind::events_kind, e.at::timestamptz, e.place, e.cap, (select array_agg(uid) from bk)
  from (values ('lips', 'Lips training (demo)', 'training', '2026-11-26 14:00-05', 'Sample Academy, Sampleton', 20),
               ('vienna', 'Vienna trip (demo)', 'clinic_event', '2026-12-10 09:00-05', 'Vienna', 3),
               ('launch', 'saypha launch (demo)', 'launch', '2027-01-22 18:00-05', 'Sampleton', 60)) as e(k, name, kind, at, place, cap)
on conflict (id) do nothing;

-- 3. Invites and attendance
insert into attendees (id, event_id, contact_id, status, invited_by_id)
select pg_temp.did('att:' || a.k || ':' || bc.cid), a.ev, bc.cid, a.st::attendees_status, bc.uid
  from bc join (values ('lips', 1, 'rsvp'), ('lips', 2, 'rsvp'), ('lips', 3, 'invited'), ('lips', 4, 'invited'),
                       ('vienna', 2, 'rsvp')) as x(k, n, st) on bc.n = x.n
  cross join lateral (select pg_temp.did('event:' || x.k) as ev, x.k, x.st) a
on conflict (id) do nothing;
-- Came to the demo Lips webinar (their own book's copy); the last one has had no call or visit since
insert into attendees (id, event_id, contact_id, status, invited_by_id)
select pg_temp.did('att:webinar:' || bc.cid),
       case when b.email like 'admin@%' then 'de000000-0000-4000-8000-000000000020'::uuid else 'de009685-0000-4000-8000-000000000020'::uuid end,
       bc.cid, 'attended', bc.uid
  from bc join bk b on b.uid = bc.uid where bc.n in (1, 30, 31)
on conflict (id) do nothing;

-- 4. Forecasts: next months for buyers, two late ones this month, first orders for non-buyers; a Vienna and an event tag
insert into forecasts (id, contact_id, rep_id, due_date, syringes, syringe_price, cannula_boxes, cannula_box_price, customer_benefit, created_by_id)
select pg_temp.did('fc:' || bc.cid || ':' || f.d), bc.cid, bc.uid, f.d::date, f.s, 225, f.cb, 185, f.tag::forecasts_customer_benefit, bc.uid
  from bc join (values
      (1, '2026-12-15', 200, 4, 'vienna'), (1, '2027-03-15', 100, 0, null),
      (2, '2026-12-15', 30, 2, 'event'),  (2, '2027-02-15', 30, 0, null),
      (3, '2027-01-15', 20, 0, null),     (4, '2026-12-15', 30, 0, null),
      (5, '2026-11-15', 10, 0, null),     (6, '2026-11-15', 10, 0, null),
      (7, '2026-10-10', 100, 0, null),    (8, '2026-10-14', 50, 0, null),
      (30, '2026-11-15', 10, 0, null),    (31, '2026-12-15', 10, 0, null),
      (32, '2026-11-15', 20, 0, null),    (33, '2027-01-15', 10, 0, null)) as f(n, d, s, cb, tag) on bc.n = f.n
on conflict (id) do nothing;

-- 5. Marketing requests
insert into marketing_requests (id, requester_id, contact_id, material, product_line, campaign, goal, details, status, created_at, in_design_at, ready_at, delivered_at)
select pg_temp.did('mr:' || bc.cid || ':' || r.k), bc.uid, bc.cid, r.material, r.line, r.campaign, r.goal, null, r.st::marketing_requests_status,
       now() - make_interval(days => r.ago),
       case when r.st in ('in_design','ready','delivered') then now() - make_interval(days => r.ago - 1) end,
       case when r.st in ('ready','delivered') then now() - make_interval(days => r.ago - 4) end,
       case when r.st = 'delivered' then now() - make_interval(days => r.ago - 6) end
  from bc join (values
      (2, 'post', 'Static social post', 'saypha', 'saypha lips · Fall 2026', 'Let her patients know she now offers saypha lips', 'in_design', 3),
      (1, 'invite', 'Event invitation', 'saypha', 'Lips training · Nov 26', 'Fill her two seats with injectors from her clinic', 'sent', 1),
      (3, 'flyer', 'Printed flyer', 'Exprecell PRF', 'Exprecell launch', 'A flyer for the waiting room', 'ready', 9),
      (4, 'post2', 'Static social post', 'saypha', null, 'Clinic social post', 'delivered', 29)) as r(n, k, material, line, campaign, goal, st, ago) on bc.n = r.n
on conflict (id) do nothing;

-- 6. Clinical training forms (waiting on a signature, and one signed)
insert into agreements (id, kind, contact_id, status, sent_at, completed_at, training_name, preferred_date, note)
select pg_temp.did('ag:' || bc.cid), 'training', bc.cid, t.st::agreements_status, now() - make_interval(days => t.ago),
       case when t.st = 'completed' then now() - make_interval(days => t.ago - 1) end, t.tr, t.pd::date, null
  from bc join (values (5, 'waiting', 5, 'saypha lips', '2026-11-26'), (6, 'completed', 12, 'saypha volume', null)) as t(n, st, ago, tr, pd) on bc.n = t.n
on conflict (id) do nothing;
insert into agreement_signers (id, agreement_id, contact_id, name, email, role, signing_order, status, signed_at)
select pg_temp.did('sg:' || bc.cid), pg_temp.did('ag:' || bc.cid), bc.cid, concat_ws(' ', bc.first_name, bc.last_name), bc.email, 'practitioner', 1,
       case when a.status = 'completed' then 'signed' else 'sent' end::agreement_signers_status, a.completed_at
  from bc join agreements a on a.id = pg_temp.did('ag:' || bc.cid)
on conflict (id) do nothing;

-- 7. Expenses from the receipt bot: three to tag, three already submitted
insert into expenses (id, user_id, vendor, amount, currency, expense_date, contact_id, category, description, status, submitted_at, source, external_id)
select pg_temp.did('ex:' || b.email || ':' || e.k), b.uid, e.vendor, e.amt, 'CAD', (current_date - e.ago),
       case when e.st = 'submitted' then (select cid from bc where bc.uid = b.uid and bc.n = e.n) end,
       case when e.st = 'submitted' then e.ty::expenses_category end,
       case when e.st = 'submitted' then e.descr end,
       e.st::expenses_status, case when e.st = 'submitted' then now() - make_interval(days => e.ago - 1) end,
       'telegram', 'demo-edge-' || b.email || '-' || e.k
  from bk b cross join (values
      ('r1', 'Sample Bistro', 310, 7, 'to_submit', null, null, null),
      ('r2', 'Sample Cafe', 42, 5, 'to_submit', null, null, null),
      ('r3', 'Sample Bakery', 64, 3, 'to_submit', null, null, null),
      ('s1', 'Sample Grill', 240, 12, 'submitted', 2, 'lunch', 'Lunch and learn with the clinic team'),
      ('s2', 'Sample Coffee Co.', 38, 15, 'submitted', 4, 'snacks_beverages', 'Coffee for the injectors'),
      ('s3', 'Sample Parking', 18, 19, 'submitted', 3, 'parking', 'Clinic visit')) as e(k, vendor, amt, ago, st, n, ty, descr)
on conflict (id) do nothing;

-- 8. This week's focus from the 1-on-1 (one already done)
insert into tasks (id, contact_id, assignee_id, created_by_id, title, kind, due_at, status, completed_at, source)
select pg_temp.did('focus:' || b.email || ':' || f.k), null, b.uid, b.uid, f.title, 'todo',
       date_trunc('week', now()) + interval '4 days 17 hours', f.st::tasks_status,
       case when f.st = 'done' then now() - interval '1 day' end, 'one_on_one'
  from bk b cross join (values ('a', 'Get both pending onboardings fully signed', 'open'),
                               ('b', 'First order from the newest candidate', 'open'),
                               ('c', 'Book a visit with the account going cold', 'open'),
                               ('d', 'Move or drop the late forecast', 'done')) as f(k, title, st)
on conflict (id) do nothing;

commit;
