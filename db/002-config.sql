-- My Fifty: real setup data for Supabase v2 (not demo). Safe to run again.
-- Products: the staff sales form catalogue (renellence-page /assets/isf/form.json, read 2026-10-20).
begin;
select set_config('app.source', 'import', true);
insert into products (sku, name, family, line, unit, list_price, active) values
  ('SAL400', 'saypha® lips Lidocaine 1 ml', 'syringe'::products_family, 'lips', 'syringe', 225.00, true),
  ('EXPRECELL', 'Exprecell Single Syringe System (5 Syringes/Box)', 'other'::products_family, 'prp', 'box', 100.00, false),
  ('SAF100', 'saypha® filler Lidocaine 1 ml', 'syringe'::products_family, 'filler', 'syringe', 225.00, true),
  ('MSK100', 'Hyaluronic Acid Face Mask', 'other'::products_family, 'skin_care', 'each', 115.00, true),
  ('PHA100', 'Pure HA Non-cross-linked Hyaluronic Acid', 'other'::products_family, 'skin_care', 'each', 230.00, true),
  ('MN1490', 'Magic Needle Cannula 14G 90MM Box of 25', 'cannula_box'::products_family, 'cannula', 'box', 185.00, true),
  ('MN1690', 'Magic Needle Cannula 16G 90MM Box of 25', 'cannula_box'::products_family, 'cannula', 'box', 185.00, true),
  ('MN1670', 'Magic Needle Cannula 16G 70MM Box of 25', 'cannula_box'::products_family, 'cannula', 'box', 185.00, true),
  ('MN1890', 'Magic Needle Cannula 18G 90MM Box of 25', 'cannula_box'::products_family, 'cannula', 'box', 185.00, true),
  ('MN1870', 'Magic Needle Cannula 18G 70MM Box of 25', 'cannula_box'::products_family, 'cannula', 'box', 185.00, true),
  ('MN2090', 'Magic Needle Cannula 20G 90MM Box of 25', 'cannula_box'::products_family, 'cannula', 'box', 185.00, true),
  ('MN2070', 'Magic Needle Cannula 20G 70MM Box of 25', 'cannula_box'::products_family, 'cannula', 'box', 185.00, true),
  ('MN2290', 'Magic Needle Cannula 22G 90MM Box of 25', 'cannula_box'::products_family, 'cannula', 'box', 185.00, true),
  ('MN2270', 'Magic Needle Cannula 22G 70MM Box of 25', 'cannula_box'::products_family, 'cannula', 'box', 185.00, true),
  ('MN2257', 'Magic Needle Cannula 22G 57MM Box of 25', 'cannula_box'::products_family, 'cannula', 'box', 185.00, true),
  ('MN2560', 'Magic Needle Cannula 25G 60MM Box of 25', 'cannula_box'::products_family, 'cannula', 'box', 185.00, true),
  ('MN2550', 'Magic Needle Cannula 25G 50MM Box of 25', 'cannula_box'::products_family, 'cannula', 'box', 185.00, true),
  ('MN2540', 'Magic Needle Cannula 25G 40MM Box of 25', 'cannula_box'::products_family, 'cannula', 'box', 185.00, true),
  ('MN2737', 'Magic Needle Cannula 27G 37MM Box of 25', 'cannula_box'::products_family, 'cannula', 'box', 185.00, true),
  ('MN3027', 'Magic Needle Cannula 30G 27MM Box of 25', 'cannula_box'::products_family, 'cannula', 'box', 185.00, true),
  ('MES2712', 'Mesbio Intradermal Hypodermic Needle 27G 12MM Box of 100', 'needle_box'::products_family, 'needle', 'box', 42.00, true),
  ('MES278', 'Mesbio Intradermal Hypodermic Needle 27G 8MM Box of 100', 'needle_box'::products_family, 'needle', 'box', 42.00, true),
  ('MES274', 'Mesbio Intradermal Hypodermic Needle 27G 4MM Box of 100', 'needle_box'::products_family, 'needle', 'box', 42.00, true),
  ('MES3012', 'Mesbio Intradermal Hypodermic Needle 30G 12MM Box of 100', 'needle_box'::products_family, 'needle', 'box', 51.00, true),
  ('MES308', 'Mesbio Intradermal Hypodermic Needle 30G 8MM Box of 100', 'needle_box'::products_family, 'needle', 'box', 51.00, true),
  ('MES304', 'Mesbio Intradermal Hypodermic Needle 30G 4MM Box of 100', 'needle_box'::products_family, 'needle', 'box', 51.00, true),
  ('MES3112', 'Mesbio Intradermal Hypodermic Needle 31G 12MM Box of 100', 'needle_box'::products_family, 'needle', 'box', 46.06, true),
  ('MES318', 'Mesbio Intradermal Hypodermic Needle 31G 8MM Box of 100', 'needle_box'::products_family, 'needle', 'box', 53.10, true),
  ('MES314', 'Mesbio Intradermal Hypodermic Needle 31G 4MM Box of 100', 'needle_box'::products_family, 'needle', 'box', 53.00, true),
  ('MES3212', 'Mesbio Intradermal Hypodermic Needle 32G 12MM Box of 100', 'needle_box'::products_family, 'needle', 'box', 46.06, true),
  ('MES328', 'Mesbio Intradermal Hypodermic Needle 32G 8MM Box of 100', 'needle_box'::products_family, 'needle', 'box', 57.82, true),
  ('MES324', 'Mesbio Intradermal Hypodermic Needle 32G 4MM Box of 100', 'needle_box'::products_family, 'needle', 'box', 62.72, true),
  ('MES3312', 'Mesbio Intradermal Hypodermic Needle 33G 12MM Box of 100', 'needle_box'::products_family, 'needle', 'box', 53.90, true),
  ('MES338', 'Mesbio Intradermal Hypodermic Needle 33G 8MM Box of 100', 'needle_box'::products_family, 'needle', 'box', 54.00, true),
  ('MES334', 'Mesbio Intradermal Hypodermic Needle 33G 4MM Box of 100', 'needle_box'::products_family, 'needle', 'box', 62.72, true),
  ('MES3412', 'Mesbio Intradermal Hypodermic Needle 34G 12MM Box of 100', 'needle_box'::products_family, 'needle', 'box', 95.00, true),
  ('MES348', 'Mesbio Intradermal Hypodermic Needle 34G 8MM Box of 100', 'needle_box'::products_family, 'needle', 'box', 95.00, true),
  ('MES344', 'Mesbio Intradermal Hypodermic Needle 34G 4MM Box of 100', 'needle_box'::products_family, 'needle', 'box', 95.00, true),
  ('SAVP300', 'saypha® volume plus Lidocaine 1 ml', 'syringe'::products_family, 'volume_plus', 'syringe', 245.00, true),
  ('SAV200', 'saypha® volume Lidocaine 1 ml', 'syringe'::products_family, 'volume', 'syringe', 225.00, true),
  ('HDB100', 'saypha Headband', 'other'::products_family, 'misc', 'each', 0.00, true),
  ('LIP101', 'ReneLuxe Lip Peptide', 'other'::products_family, 'misc', 'each', 0.00, true),
  ('LIP100', 'saypha Lip Balm', 'other'::products_family, 'misc', 'each', 0.00, true),
  ('ICE102', 'saypha lips Pink Ice Pack', 'other'::products_family, 'misc', 'each', 0.00, true),
  ('ICE100', 'Renellence saypha Blue Ice Pack', 'other'::products_family, 'misc', 'each', 0.00, true),
  ('SAYPHA-PAMPHLET', 'saypha Fact Sheet', 'syringe'::products_family, 'misc', 'syringe', 0.00, true),
  ('ICE101', 'Renellence Orange Ice Pack', 'other'::products_family, 'misc', 'each', 0.00, true)
on conflict (sku) do update set name = excluded.name, family = excluded.family, line = excluded.line, unit = excluded.unit, list_price = excluded.list_price, active = excluded.active;

-- My Fifty rules (read by api/_book.js). Yousef 2026-10-20: 8 touchpoints a day (calls and visits), Going Cold after
-- 30 days with no order or visit, 50 is the goal, new ad leads stay at the top of Today for 24 hours.
insert into settings (key, value) values ('my_fifty', '{"daily_goal": 8, "going_cold_days": 30, "fifty_goal": 50, "new_lead_hours": 24}'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Ontario holidays: the streak skips them, like weekends (the same list as Edge, renellence-edge/api/_bizdays.js).
insert into settings (key, value) values ('holidays', '["2026-01-01","2026-02-16","2026-04-03","2026-05-18","2026-07-01","2026-09-07","2026-10-12","2026-12-25","2026-12-28","2027-01-01","2027-02-15","2027-03-26","2027-05-24","2027-07-01","2027-09-06","2027-10-11","2027-12-27","2027-12-28"]'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Admins who can sign in now. Reps are added at go-live (with the real import), so the demo never shows real names.
insert into users (email, name, kind, active, language) values
  ('admin@renellence.com', 'Yousef Kamel', 'admin', true, 'en'),
  ('info@renellence.com', 'Renellence', 'admin', true, 'en')
on conflict (email) do nothing;

commit;
