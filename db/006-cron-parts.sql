-- The 5-minute tick in three parts (owner 2026-10-28, data-flow improvement 5): each part gets its own Vercel run (60 s)
-- instead of sharing one, so a slow HubSpot pull no longer squeezes SignatureAPI and Gmail. api/cron.js ?part=:
--   core     Meta leads, pushes, the 3 pm nudge, forecast snapshot, order resends, Stripe retries, freshness alarms
--   hubspot  the 5-minute HubSpot pull (the bridge)
--   sync     SignatureAPI, then Gmail
-- Same key as before (Vault 'my_fifty_cron_key'). Re-runnable. Listed in CHANGELOG-v2.md (#35).
select cron.unschedule(jobid) from cron.job where jobname in ('my-fifty-tick', 'my-fifty-tick-hubspot', 'my-fifty-tick-sync');
select cron.schedule('my-fifty-tick', '*/5 * * * *', $$
  select net.http_get(
    url := 'https://my-fifty.vercel.app/api/cron?op=tick&part=core',
    headers := jsonb_build_object('X-Cron-Key', (select decrypted_secret from vault.decrypted_secrets where name = 'my_fifty_cron_key')),
    timeout_milliseconds := 60000
  );
$$);
select cron.schedule('my-fifty-tick-hubspot', '*/5 * * * *', $$
  select net.http_get(
    url := 'https://my-fifty.vercel.app/api/cron?op=tick&part=hubspot',
    headers := jsonb_build_object('X-Cron-Key', (select decrypted_secret from vault.decrypted_secrets where name = 'my_fifty_cron_key')),
    timeout_milliseconds := 60000
  );
$$);
select cron.schedule('my-fifty-tick-sync', '*/5 * * * *', $$
  select net.http_get(
    url := 'https://my-fifty.vercel.app/api/cron?op=tick&part=sync',
    headers := jsonb_build_object('X-Cron-Key', (select decrypted_secret from vault.decrypted_secrets where name = 'my_fifty_cron_key')),
    timeout_milliseconds := 60000
  );
$$);
