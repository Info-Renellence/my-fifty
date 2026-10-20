-- My Fifty: changes to Supabase v2 (project ojphplepzuwchjtuycpv), approved by Yousef 2026-10-20.
-- Every change here is listed in CHANGELOG-v2.md. Safe to run once on the empty v2 model (edge-model.sql).
-- Run with: npx supabase@2.121.0 db query --linked --project-ref ojphplepzuwchjtuycpv -f db/001-my-fifty.sql

begin;

-- 1. contacts.role is a fixed list (L13 Add a person: Physician, Nurse injector, Clinic owner, Manager, Other).
create type public.contacts_role as enum ('physician', 'nurse_injector', 'clinic_owner', 'manager', 'other');
alter table public.contacts alter column "role" type public.contacts_role using null;
comment on column public.contacts."role" is 'Their role at the clinic: physician · nurse_injector · clinic_owner · manager · other';

-- 2. Lead source: four groups (social · event · warm · cold) plus a free-text detail.
--    Social leads link to ad_objects through source_ad_id; the platform (Instagram, Facebook) goes in source_detail.
alter type public.contacts_source_kind rename to contacts_source_kind_old;
create type public.contacts_source_kind as enum ('social', 'event', 'warm', 'cold');
alter table public.contacts alter column source_kind type public.contacts_source_kind using null;
drop type public.contacts_source_kind_old;
alter table public.contacts add column source_detail text;
comment on column public.contacts.source_kind is 'Where they first came from: social · event · warm · cold (set once)';
comment on column public.contacts.source_detail is 'Detail of the source: Instagram, Facebook, Referral, Clinic visit … Empty when a rep added them';

-- 3. What they use today (L7/L8 person card): two fixed lists.
create type public.contacts_filler as enum ('saypha', 'juvederm', 'restylane', 'teoxane_rha', 'belotero', 'revanesse', 'stylage', 'other');
create type public.contacts_prp as enum ('eclipse_prp', 'regenlab', 'arthrex_angel', 'emcyte', 'exprecell', 'other');
alter table public.contacts add column fillers_used public.contacts_filler[] not null default '{}';
alter table public.contacts add column prp_used public.contacts_prp[] not null default '{}';
comment on column public.contacts.fillers_used is 'Fillers they use (fixed list)';
comment on column public.contacts.prp_used is 'PRP / PRF systems they use (fixed list)';

-- 4. Order notes (L10/L15): a note for approval and a shipping note. The invoice email is contacts.secondary_email.
alter table public.orders rename column notes to approval_note;
alter table public.orders add column shipping_note text;
comment on column public.orders.approval_note is 'Note for whoever approves the order';
comment on column public.orders.shipping_note is 'Note for the warehouse / shipping';

-- 5. My Fifty tags what it writes, so reports can tell it apart from Edge.
alter type public.interactions_source add value 'my_fifty';
alter type public.change_log_source add value 'my_fifty';
-- 6. The "New Instagram lead" push (L1).
alter type public.notifications_kind add value 'new_lead';

commit;

-- The enum values above must be committed before anything below can use them.
begin;

-- 7. updated_at keeps itself current on every table that has it.
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  for t in select c.table_name from information_schema.columns c
           where c.table_schema = 'public' and c.column_name = 'updated_at'
             and c.table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')
  loop
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- 8. change_log: one row per changed field, written by a trigger on the business tables.
--    Who and from where come from the transaction (set_config('app.user_id' / 'app.source')), which the
--    My Fifty server sets; otherwise the signed-in Supabase user; otherwise an integration (db_trigger).
create or replace function public.log_changes() returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor uuid := nullif(current_setting('app.user_id', true), '')::uuid;
  src text := coalesce(nullif(current_setting('app.source', true), ''), 'db_trigger');
  batch uuid := coalesce(nullif(current_setting('app.batch_id', true), '')::uuid, gen_random_uuid());
  old_j jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) else '{}'::jsonb end;
  new_j jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) else '{}'::jsonb end;
  row_id uuid := coalesce((new_j->>'id')::uuid, (old_j->>'id')::uuid);
  cid uuid;
  k text;
  secret boolean;
begin
  if actor is null then
    select u.id into actor from users u where u.auth_user_id = (select auth.uid());
  end if;
  cid := case tg_table_name
           when 'contacts' then row_id
           when 'onboardings' then coalesce((new_j->>'primary_contact_id')::uuid, (old_j->>'primary_contact_id')::uuid)
           else coalesce((new_j->>'contact_id')::uuid, (old_j->>'contact_id')::uuid)
         end;
  if tg_table_name in ('order_lines', 'payments') then
    select o.contact_id into cid from orders o where o.id = coalesce((new_j->>'order_id')::uuid, (old_j->>'order_id')::uuid);
  end if;
  if tg_op = 'INSERT' then
    insert into change_log (at, actor_user_id, actor_kind, source, action, entity_type, entity_id, contact_id, batch_id)
    values (now(), actor, case when actor is null then 'integration' else 'user' end::change_log_actor_kind, src::change_log_source,
            'create', tg_table_name, row_id, cid, batch);
  elsif tg_op = 'DELETE' then
    insert into change_log (at, actor_user_id, actor_kind, source, action, entity_type, entity_id, contact_id, batch_id)
    values (now(), actor, case when actor is null then 'integration' else 'user' end::change_log_actor_kind, src::change_log_source,
            'delete', tg_table_name, row_id, cid, batch);
  else
    for k in select key from jsonb_each(new_j) loop
      continue when k in ('updated_at', 'created_at');
      continue when (old_j->k) is not distinct from (new_j->k);
      secret := (tg_table_name = 'user_connections' and k = 'credentials');
      insert into change_log (at, actor_user_id, actor_kind, source, action, entity_type, entity_id, contact_id, field, old_value, new_value, batch_id, is_sensitive)
      values (now(), actor, case when actor is null then 'integration' else 'user' end::change_log_actor_kind, src::change_log_source,
              case when k = 'owner_id' then 'reassign' when k = 'deleted_at' and (new_j->>k) is not null then 'delete' else 'update' end,
              tg_table_name, row_id, cid, k,
              case when secret then '"***"'::jsonb else old_j->k end,
              case when secret then '"***"'::jsonb else new_j->k end,
              batch, secret);
    end loop;
  end if;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['users', 'clinics', 'contacts', 'user_connections', 'territory_rules', 'tasks', 'forecasts', 'targets',
                           'interactions', 'products', 'orders', 'order_lines', 'payments', 'agreements', 'agreement_signers',
                           'onboardings', 'ad_objects', 'events', 'event_attendees', 'marketing_requests', 'files', 'settings']
  loop
    execute format('create trigger log_changes after insert or update or delete on public.%I for each row execute function public.log_changes()', t);
  end loop;
end $$;

-- settings has no id column; its key is logged as the entity.
create or replace function public.log_settings() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into change_log (at, actor_user_id, actor_kind, source, action, entity_type, field, old_value, new_value)
  values (now(), nullif(current_setting('app.user_id', true), '')::uuid,
          case when nullif(current_setting('app.user_id', true), '') is null then 'system' else 'user' end::change_log_actor_kind,
          coalesce(nullif(current_setting('app.source', true), ''), 'db_trigger')::change_log_source,
          lower(tg_op), 'settings', coalesce(new.key, old.key),
          case when tg_op <> 'INSERT' then old.value end, case when tg_op <> 'DELETE' then new.value end);
  return null;
end $$;
drop trigger log_changes on public.settings;
create trigger log_changes after insert or update or delete on public.settings for each row execute function public.log_settings();

-- change_log is append-only (SOP section 7): no updates or deletes, admins included; `at` is set by the database.
create or replace function public.change_log_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then new.at := now(); return new; end if;
  raise exception 'change_log is append-only';
end $$;
create trigger append_only before insert or update or delete on public.change_log for each row execute function public.change_log_append_only();

-- 9. Row-level security (SOP section 7). A rep sees and edits their own contacts and what hangs off them;
--    admins see everything. The My Fifty server and n8n use the service connection, which bypasses RLS.
create or replace function public.me() returns uuid language sql stable security definer set search_path = public as $$
  select id from users where auth_user_id = (select auth.uid()) and active is not false
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from users where auth_user_id = (select auth.uid()) and kind = 'admin' and active is not false)
$$;
create or replace function public.can_see_contact(cid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from contacts c where c.id = cid and c.owner_id = public.me())
$$;
create or replace function public.can_see_order(oid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from orders o where o.id = oid and (o.rep_id = public.me() or public.can_see_contact(o.contact_id)))
$$;

do $$
declare t text;
begin
  for t in select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Reference data every signed-in person reads.
create policy read_all on public.users for select to authenticated using (true);
create policy read_all on public.products for select to authenticated using (true);
create policy read_all on public.settings for select to authenticated using (true);
create policy admin_all on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.users for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.products for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Contacts and their clinics.
create policy own on public.contacts for all to authenticated
  using (public.is_admin() or owner_id = public.me()) with check (public.is_admin() or owner_id = public.me());
create policy seen_through_contacts on public.clinics for select to authenticated
  using (public.is_admin() or exists (select 1 from contacts c where c.clinic_id = clinics.id and c.owner_id = public.me()));
create policy add on public.clinics for insert to authenticated with check (true);
create policy edit on public.clinics for update to authenticated
  using (public.is_admin() or exists (select 1 from contacts c where c.clinic_id = clinics.id and c.owner_id = public.me()));

-- Everything that hangs off a contact.
create policy by_contact on public.interactions for all to authenticated using (public.can_see_contact(contact_id)) with check (public.can_see_contact(contact_id));
create policy by_contact on public.tasks for all to authenticated
  using (assignee_id = public.me() or public.can_see_contact(contact_id)) with check (assignee_id = public.me() or public.can_see_contact(contact_id));
create policy by_contact on public.forecasts for all to authenticated using (public.can_see_contact(contact_id)) with check (public.can_see_contact(contact_id));
create policy by_contact on public.ai_outputs for select to authenticated using (public.is_admin() or created_by = public.me() or public.can_see_contact(contact_id));
create policy by_contact on public.agreements for select to authenticated using (public.can_see_contact(contact_id));
create policy by_agreement on public.agreement_signers for select to authenticated
  using (exists (select 1 from agreements a where a.id = agreement_id and public.can_see_contact(a.contact_id)));
create policy by_contact on public.onboardings for select to authenticated using (public.can_see_contact(primary_contact_id) or public.can_see_contact(injector_contact_id));
create policy by_contact on public.files for select to authenticated using (public.is_admin() or uploaded_by = public.me() or public.can_see_contact(contact_id));
create policy by_contact on public.event_attendees for select to authenticated using (public.can_see_contact(contact_id));
create policy by_order on public.orders for select to authenticated using (public.can_see_order(id));
create policy by_order on public.order_lines for select to authenticated using (public.can_see_order(order_id));
create policy by_order on public.payments for select to authenticated using (public.can_see_order(order_id));

-- Per person.
create policy own on public.notifications for select to authenticated using (user_id = public.me() or public.is_admin());
create policy own on public.user_connections for select to authenticated using (user_id = public.me() or public.is_admin());
create policy own on public.targets for select to authenticated using (rep_id is null or rep_id = public.me() or public.is_admin());
create policy own on public.metric_snapshots for select to authenticated using (rep_id is null or rep_id = public.me() or public.is_admin());
create policy own on public.marketing_requests for select to authenticated using (requester_id = public.me() or public.is_admin());

-- Admin only.
create policy admin_all on public.events for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.ad_objects for select to authenticated using (public.is_admin());
create policy admin_all on public.ad_metrics_daily for select to authenticated using (public.is_admin());
create policy admin_all on public.territory_rules for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_read on public.ingest_events for select to authenticated using (public.is_admin());
create policy admin_read on public.change_log for select to authenticated
  using (public.is_admin() or (contact_id is not null and public.can_see_contact(contact_id)));

-- 10. Indexes for the columns the rules and the app filter on.
create index if not exists contacts_owner_id_idx on public.contacts (owner_id);
create index if not exists contacts_clinic_id_idx on public.contacts (clinic_id);
create index if not exists users_auth_user_id_idx on public.users (auth_user_id);
create index if not exists interactions_contact_id_idx on public.interactions (contact_id, occurred_at desc);
create index if not exists interactions_user_id_idx on public.interactions (user_id, occurred_at desc);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id, status, due_at);
create index if not exists tasks_contact_id_idx on public.tasks (contact_id);
create index if not exists orders_contact_id_idx on public.orders (contact_id);
create index if not exists orders_rep_id_idx on public.orders (rep_id);
create index if not exists order_lines_order_id_idx on public.order_lines (order_id);
create index if not exists payments_order_id_idx on public.payments (order_id);
create index if not exists agreements_contact_id_idx on public.agreements (contact_id);
create index if not exists agreements_order_id_idx on public.agreements (order_id);
create index if not exists onboardings_primary_idx on public.onboardings (primary_contact_id);
create index if not exists onboardings_injector_idx on public.onboardings (injector_contact_id);
create index if not exists change_log_contact_idx on public.change_log (contact_id, at desc);
create index if not exists change_log_entity_idx on public.change_log (entity_type, entity_id);
create index if not exists notifications_user_idx on public.notifications (user_id, sent_at desc);
create index if not exists user_connections_user_idx on public.user_connections (user_id, kind);
create index if not exists event_attendees_contact_idx on public.event_attendees (contact_id);

commit;
