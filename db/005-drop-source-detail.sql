-- Drop contacts.source_detail (Yousef 2026-10-21: "We should only have 4 lead sources: Meta, Events, Warm Leads, Cold
-- Leads"; option 2). The four sources stay in contacts.source_kind (social = Meta ads, event, warm, cold); an event
-- lead still shows its event through source_event_id, and a Meta lead its ad through source_ad_id.
-- Run only after My Fifty and Edge stopped reading the column (my-fifty and renellence-edge no-hubspot, 2026-10-21).
-- Listed in CHANGELOG-v2.md. Safe to run again.
begin;
select set_config('app.source', 'import', true);
alter table public.contacts drop column if exists source_detail;
commit;
