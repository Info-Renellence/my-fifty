# Scenarios tried (one line each; check here before running one)

Format: time · area · scenario · result

- 09:30 · setup · network guard: fetch/https/socket to Gemini, n8n, Google OAuth, Gmail, FCM push, Quo, Meta, my-fifty.vercel.app, example.com · all refused; Supabase v2 allowed (`docs/test-run/offline-proof.txt`)
- 09:31 · setup · app connectors with fake keys (Gemini, n8n, Gmail token, web push) under the guard · each fails safely with its own "unreachable" answer
- 09:32 · setup · baseline `npm test` under the guard · 348 of 358 pass; the 10 that fail need rights the test login does not have (auth.users, session_replication_role), not app bugs
- 09:33 · data · `users` rows as they are in v2 today · info@renellence.com settings are a JSON list, not an object (finding F2)
- 09:36 · R24 · wire order through act.order · writes a "succeeded" payment row (finding F1)
- 09:36 · R5/R12 · lead whose only visit was cancelled; visit cancelled today · counted as touched (finding F3)
- 09:36 · R1-R4 · every order status, deleted order, mixed free/paid/zero-price lines, sample order marked paid, samples + test payment · ok
- 09:36 · R6 · cancelled visit vs going cold; going_cold_days setting 20 · ok
- 09:36 · R8 · cancelled/scheduled calls+visits, texts, video calls not counted · ok
- 09:36 · R9/R10 · 11:30 PM Toronto call is yesterday; atLocal / ymd across both DST changes · ok
- 09:36 · R15-R18 · test payment earlier than real payment · counted on the test payment's date (finding F4)
- 09:36 · R15-R18 · wire counted on placed day; Dec 31 11:30 PM Toronto in Q4, Jan 1 out; reorder after another rep's first sale · ok
- 09:36 · R11/R12 · today's list order of the four groups, dedupe, reached-today, snoozed, lead > 24 h · ok
- 09:39 · data · fake data seeded (6 test users, 325 people, 164 orders, Meta/Quo/Gmail/n8n/push/Gemini shaped rows) · ok
- 09:40 · wipe · wipe-demo.sql selections pick every fake row and no real row (rolled back) · ok
