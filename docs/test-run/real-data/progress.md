# My Fifty real-data run: progress (Thu 2026-10-22, 7:30 PM to 11:50 PM Toronto)

Lane B of the real-data run. Database: Supabase v1 with a fresh copy of v2's real data. Nothing connected to v2.
No customer data here: counts and "a contact in X's book" only.

## Latest (9:10 PM)
- All 8 real books read end to end (every read screen, 0 errors); rules match independent database counts for every user.
- Rep against rep: 560 reads of other books refused; every write by another rep or head office on a fake person refused.
- Screens on 5 real books checked at phone size against the mockup; random taps (writes blocked) gave no page errors.
- Fixes pushed (each gate-checked, nothing new failing against the baseline): 044419d (RD6 order steps), 6af06a5 (RD2 long
  text), d03e28a (RD8 no first name), b53ccc6 (RD10 merged duplicates).
- Waiting on the owner: RD1 (high: wire "Mark as received" refused for head office), RD3, RD4, RD5, RD7; data notes RD9, RD11, RD12.
- Next: head office and admin views, final re-run from 11:15, report by 11:50.

## Earlier (8:00 PM)
- All 8 real books read end to end (about 800 people, every read screen): 0 errors.
- Fifty, Candidates, Onboarded (primary contact only), lead groups, streak and Q4 Booster match independent database counts for every user.
- Rep against rep on the real books: 560 reads of other books, all refused.
- Findings: RD1 (high, owner), RD2 (low, fixed), RD3 (medium, owner), RD4 (medium, owner), RD5 (owner), RD6 (medium, fixed),
  RD7 (medium, owner), RD8 (low, fixed). See `report.md` at the end; details in `tried.md`.
- Fixes committed: 044419d (RD6), 6af06a5 (RD2), d03e28a (RD8). Pushed after the gate (compared by name with the baseline).
