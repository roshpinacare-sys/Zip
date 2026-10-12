# STATE-REPORT 2026-09-30 — רופא-הצי (אבחון-עצמי נטול-מפתחות)

נמדד: 2026-09-30T14:52:51.061Z · קריאה-בלבד מהשרשרת · אפס-סודות

## הון הרשת

| חשבון | SP נטו | VP% | RC% | מואצל-אליו | מאציל |
|---|---|---|---|---|---|
| @cashmachine | 30.2 | 0 | 100 | 30 | 5.1 |
| @haran | 33.3 | 0 | 100 | 30 | 234.3 |
| @israelnews | 48.7 | 90.4 | 98 | 48.6 | 0 |
| @lsa | 34.8 | 0 | 100 | 31 | 1 |
| @macrame | 30.1 | 0 | 100 | 30 | 1.9 |
| @siq | 31.1 | 90.4 | 96.8 | 31 | 4.6 |
| @tov | 31.2 | 90.4 | 96.9 | 31.1 | 4.6 |
| @wic | 32.6 | 0 | 100 | 32.5 | 2.4 |
| @wog | 31.2 | 0 | 100 | 31.1 | 4.6 |
| @woq | 33.5 | 0 | 98 | 33.4 | 1.5 |
| @headcorner | 4278.9 | 98.8 | 100 | 244 | 380.1 |

**סה"כ SP נטו: 4615.6** · VP≥90%: 4/12 · VP≥20%: 4/12

## תוכן-חי (7 ימים) — כיסוי-קהל 31%

- @israelnews/saos-israelnews-20260930 — קולות 7 (צי 3 · חוץ 4) · פנדינג 0.074 SBD
- @siq/saos-siq-20260930 — קולות 3 (צי 3 · חוץ 0) · פנדינג 0.001 SBD
- @siq/saos-siq-20260929 — קולות 3 (צי 3 · חוץ 0) · פנדינג 0.001 SBD
- @tov/saos-tov-20260930 — קולות 3 (צי 3 · חוץ 0) · פנדינג 0.001 SBD
- @tov/saos-tov-20260929 — קולות 3 (צי 3 · חוץ 0) · פנדינג 0.001 SBD
- @woq/saos-woq-20260929 — קולות 4 (צי 4 · חוץ 0) · פנדינג 0.001 SBD
- @headcorner/saos-receipts-20260930 — קולות 3 (צי 3 · חוץ 0) · פנדינג 0.000 SBD
- @headcorner/saos-daily-20260930 — קולות 3 (צי 3 · חוץ 0) · פנדינג 0.000 SBD
- @headcorner/cloud-pulse-20260930 — קולות 3 (צי 3 · חוץ 0) · פנדינג 0.000 SBD
- @headcorner/saos-transparency-20260929 — קולות 3 (צי 3 · חוץ 0) · פנדינג 0.000 SBD
- @headcorner/saos-grid-20260929 — קולות 4 (צי 4 · חוץ 0) · פנדינג 0.000 SBD
- @headcorner/saos-daily-20260929 — קולות 3 (צי 3 · חוץ 0) · פנדינג 0.000 SBD
- @headcorner/cloud-pulse-20260929 — קולות 3 (צי 3 · חוץ 0) · פנדינג 0.000 SBD
- @headcorner/saos-ledger-20260928 — קולות 3 (צי 3 · חוץ 0) · פנדינג 0.000 SBD
- @headcorner/saos-daily-20260928 — קולות 3 (צי 3 · חוץ 0) · פנדינג 0.000 SBD
- @headcorner/the-weave-2026-09-28-mul1p9rx — קולות 3 (צי 3 · חוץ 0) · פנדינג 0.000 SBD

## כלכלה

- פנדינג על פוסטים-חיים: ≈ 0.079 SBD
- STEEM נזיל בצי: 910.969
- תביעות-ממתינות: אין

## פערים-כנים

- VP-regen: 7 soldiers below 20% (cashmachine@0%, haran@0%, lsa@0%, macrame@0%, wic@0%, wog@0%, woq@0%) — natural ~20%/day recovery, engine gates re-admit them automatically
- audience gap: 16 posts with missing fleet votes (next sweep fills idempotently)

## רכבת-ה-CI

- `steem/self-audience.yml` — 14:30 UTC daily — publish → delegate → cross-vote → doctor
- `Domain/anchor-execute` — hourly :55 — dayRoot signatures OP+BASE (secret-gated)
- `Domain/daily-claim.yml` — 02:37 UTC daily — posting-only claim compounding
- `Domain/cloud-heart` — grid heartbeat + weave-anchor-lines dispatch

---
ריבונות = למדוד את עצמך בכנות, כל-יום, בלי-לבקש רשות.
