-- My Fifty's timer in Supabase v2: every 5 minutes, call https://my-fifty.vercel.app/api/cron with the key.
-- (Vercel's free plan only runs daily timers; new-lead pushes and the 7:30 morning summary need more.)
-- The key is CRON_SECRET from the Vercel project, kept in Supabase Vault as 'my_fifty_cron_key' (added separately,
-- never written in this file). Turns on the pg_cron and pg_net extensions. Listed in CHANGELOG-v2.md.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'my-fifty-tick';
select cron.schedule('my-fifty-tick', '*/5 * * * *', $$
  select net.http_get(
    url := 'https://my-fifty.vercel.app/api/cron?op=tick',
    headers := jsonb_build_object('X-Cron-Key', (select decrypted_secret from vault.decrypted_secrets where name = 'my_fifty_cron_key')),
    timeout_milliseconds := 60000
  );
$$);
