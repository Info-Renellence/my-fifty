# My Fifty

Renellence's phone app for reps: today's list, My Fifty, candidates and leads, logging calls and visits (by voice or
typing), orders and samples, and rewards. It is a web app built to be added to the Home Screen.

It is separate from Edge. All data is read from and written to **Supabase "v2"** (`ojphplepzuwchjtuycpv`). There is
no HubSpot. The screens follow "Edge – Final Mockup" (L1–L25, without L12 and L16–L18; the product picker is the
original #12).

## How it is built
- `index.html`, `app.css` and `app.js`: the whole app, in plain JavaScript with no build step. `sw.js` handles phone notifications.
- `api/data.js`: every read (`GET /api/data?op=…`). `api/act.js`: every write (`POST /api/act {op}`).
  `api/cron.js`: the timer (new-lead pushes, the morning summary, the Gmail pull).
- `api/_book.js`: the rules worked out from the records (lead / candidate / Fifty, going cold, today's list, the
  day goal and the streak). `api/_rewards.js`: Rewards (the programs are written in code for now).
- Sign-in: Supabase Auth with Google, @renellence.com only, plus an active row in `users`.
- Integrations, done the way Edge does them:
  - Gemini writes up voice notes, using the person's and clinic's details as context (`api/_voice.js`).
  - Web push for reminders (`api/_push.js`).
  - Gmail sends email and pulls client emails (`api/_gmail.js`).
  - Call and Text open the Quo app.
  - Orders go to n8n (`api/_n8n.js`).

## Rules
- **Data:** follow `renellence-edge/docs/data-model-sop.md`. Never add or change a table or field without the
  owner's yes, and log every v2 change in `CHANGELOG-v2.md`.
- **UI:** follow the mockup. Don't invent screens.
- **Demo data:** all fictional (`scripts/seed-demo.js` → `db/seed-demo.sql`). Remove it with `db/wipe-demo.sql`.

## Environment (Vercel project `my-fifty`)

| Variables | What they are for |
|---|---|
| `POSTGRES_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Set by the Vercel "v2" Supabase connection |
| `MYFIFTY_SECRET` | Encrypts stored tokens; push keys are derived from it |
| `CRON_SECRET` | The timer's key |
| `GEMINI_API_KEY` | Voice notes (the same key as Edge) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The Google OAuth client that Supabase signs in with; Gmail uses it too |
| `N8N_MYFIFTY_URL`, `N8N_MYFIFTY_KEY` | The n8n order branch |

## Tests
- `npm test` runs everything and reports coverage. It fails below 90% of lines.
  - `npm run test:unit`: `test/unit/`, the pure rules. No database or network, and the clock is frozen.
  - `npm run test:db`: `test/db/`, run directly on Supabase v2. Each test runs in its own transaction that is rolled back, so nothing is kept. Outside services (Google, Gemini, n8n, web push) are faked.
- `node test/smoke.js`: an end-to-end check against the demo data.
- `node test/serve.js` then `node test/screens.js <dir>`: screenshots of every screen.
