# CLAUDE.md — My Fifty

Read README.md first. Short rules:
- Data: follow `../renellence-edge/docs/data-model-sop.md` strictly. Never add, rename or remove a table, field or enum
  value in Supabase v2 without asking Yousef first, and record every v2 change in CHANGELOG-v2.md.
- UI: follow "Edge – Final Mockup" exactly (L1-L25, not L12, L16-L18; product picker = original #12). Don't invent UI.
- No HubSpot. Everything reads and writes Supabase v2 (`ojphplepzuwchjtuycpv`).
- Vercel Hobby: 60 s functions, daily crons only, 12 functions max (data.js, act.js, cron.js; helpers start with `_`).
- Literal requires only (Vercel bundling).
- Demo data must be fully fictional; it is marked (legacy_id 'demo-', @demo.invalid) and removed with db/wipe-demo.sql.
- Show n8n workflow changes to Yousef before touching live workflows.
- Commit as `git -c user.name="Yousef Kamel" -c user.email="info@renellence.com"`; commit and push finished work.
