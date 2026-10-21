-- Payment terms for wire orders (Yousef 2026-10-21: "we need a terms field. right now its 30 days only but it may
-- change in the future"). Listed in CHANGELOG-v2.md section 7. Safe to run again.
--
-- A wire order counts as sold when it is placed; collecting the money is tracked separately: one pending wire
-- payment row is written when the order is placed, and it becomes succeeded (paid_at = the day the money arrived)
-- when an admin marks it received. The due date is worked out, never stored: invoice date (or the order date
-- before invoicing) + the order's terms.
begin;
select set_config('app.source', 'import', true);

-- The customer's own terms in days. Empty = the standard terms (settings 'payments'.default_terms_days).
alter table contacts add column if not exists payment_terms_days integer
  check (payment_terms_days is null or payment_terms_days between 0 and 365);
comment on column contacts.payment_terms_days is 'Wire payment terms in days for this customer; null = settings payments.default_terms_days';

-- The terms copied onto a wire order when it is placed, so changing a customer's or the standard terms later
-- never moves the due date of an order already placed.
alter table orders add column if not exists payment_terms_days integer
  check (payment_terms_days is null or payment_terms_days between 0 and 365);
comment on column orders.payment_terms_days is 'Wire orders: the payment terms in days at the time the order was placed';

-- The standard terms (a row, not structure): 30 days today; change the number here to change it for new orders.
insert into settings (key, value) values ('payments', '{"default_terms_days": 30}'::jsonb)
  on conflict (key) do nothing;

commit;
