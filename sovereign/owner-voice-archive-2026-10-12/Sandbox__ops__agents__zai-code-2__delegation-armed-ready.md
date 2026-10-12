# האצלת-SP — ARMED-AND-READY (מחכה-לך או ל-custodian) · 2026-10-11

**מדידת-בסיס (RPC-ציבורי, 2026-10-11):** k = SP/VESTS = 0.00062019 (headcorner 4,025.8-SP-עצמיים מ-6,491,266.77-VESTS).
**⚠️ חובה לחשב-מחדש את k ברגע-הביצוע** (k נע-עם-האספקה).

## ה-ops המדויקים (5 × delegate_vesting_shares, batch-יחיד על-@headcorner, תפקיד-active):

```json
[
  ["delegate_vesting_shares", {"vesting_shares": "34828.198686 VESTS",  "delegatee": "haran",       "delegator": "headcorner"}],
  ["delegate_vesting_shares", {"vesting_shares": "39987.931825 VESTS",  "delegatee": "cashmachine", "delegator": "headcorner"}],
  ["delegate_vesting_shares", {"vesting_shares": "108515.637573 VESTS", "delegatee": "wic",         "delegator": "headcorner"}],
  ["delegate_vesting_shares", {"vesting_shares": "107064.462627 VESTS", "delegatee": "woq",         "delegator": "headcorner"}],
  ["delegate_vesting_shares", {"vesting_shares": "110934.262481 VESTS", "delegatee": "tov",         "delegator": "headcorner"}]
]
```

**סה"כ: 248.9 SP · headcorner אחרי: 3,776.9 SP-עצמיים (אפקטיבי ~3,671) — מעל-רצפת-האוצר 3,000.**

## תנאי-סף לביצוע (שניים-משלושה):
1. **רוטציית-P0 בוצעה** (מועדף) — או הוראת-בעלים מפורשת "בצע-עכשיו-למרות-P0".
2. **סינכרון-custodian:** רק-סשן-אחד חותם מ-@headcorner באותו-רגע (הסנדבוקס-המקביל מנהיע-כרגע).
3. רצפת-RC של headcorner נמדדת-ירוקה ברגע-הביצוע (RC-FLOOR gate של המנוע-יעשה-זאת-אוטומטית).

## אחרי-הביצוע:
- רישום-מעגלי-ב-`ops/AGENT-LEDGER.md` + txid-לכל-האצלה.
- אימות-עצמאי: `get_accounts` → `received_vesting_shares` של כל-יעד (readback-חוק-האורגניזם).
- עדכון-KPI-3 ב-`scoreboard.md`.

## הערת-בטיחות-הפוכה: אל-תאציל ל-@spaminator (VP 0% — דפוס-דגלול) ולא ל-@powerspan/@saos/@ynet (קליפות) — חוזר-על-סעיף 3 של השורש.
