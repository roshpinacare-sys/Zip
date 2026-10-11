# KEY-PROOF-LATEST — הוכחה-עומדת של מתים (R11) · saos/key-proof/1

> **עודכן:** 2026-10-11T21:06:46Z · מקור: Sandbox `proof/key-proof.mjs` (ריצה-חיה, selftest 26/26) · ארטיפקט-מלא: `roshpinacare-sys/Sandbox` `proof/out/key-proof-2026-10-11.json` @ f084ee57 · מטא: `sovereign/zai-audit/key-proof-2026-10-11.json`
>
> ## 🟢 שער-R11 מתמוסס בהוכחה עומדת
>
> **ספירת-פסקים: DEAD=9 · ALIVE-ALERT=0 · UNKNOWN=0 · UNKNOWN-NOT-CHAIN-TESTABLE=3 · incident=false**
> אין אזעקה. כל חומר-מפתח שדלף להיסטוריית-git הציבורית של
> `roshpina · anchor-baseline · saos-jummper · Sdk · Adsmarket` לא מאשר דבר על אף
> חשבון-צי: אף אחד מהמפתחות-הנגזרים אינו רשות-חיה של 14 חשבונות-הצי, ואף חשבון
> על-השרשרת כולה (get_key_references, 345 מפתחות-נבדקים) לא מפנה אליהם.

## השיטה (4 שלבים · קריאה-בלבד)

1. **SCAN** — קלונים טריים של 5 ריפואי-הדליפה, הליכה על כל-ה-blobs בכל-ההיסטוריה
   (1,825 blobs · 19.5MB · 1,412 קומיטים), חילוץ-מועמדים לפי-דפוס: WIF /
   סיסמת-מאסטר P… / hex64 בהקשר-מפתח / STM ציבורי / kv-סיסמה / ארכיוני-מפתחות.
2. **DERIVE** — לכל מועמד: גזירת-מפתח-ציבורי (secp256k1 BigInt ג'קוביאני +
   base58check + ripemd160 טהור — פורט אפס-תלות מ-Domain/gate-crypto.js, מעוגן
   ב-KATs); לסיסמאות: מטריצת 14 חשבונות × 4 תפקידים × (תקן-Steemit + 6 סדרי-זרע).
3. **CHAIN** — `get_accounts` של 14 חשבונות-הצי (56 גופי-מפתח-חיים) ·
   `get_key_references` לכל מפתח-נגזר (מפקד-אזכור גלובלי) · עדות-רוטציה:
   הליכה מדופדפדת ב-account_history של headcorner (8,787 ops / 87 עמודים עד
   חלון 2026-10-08T15:00-19:00Z, הגיע-לקצה) — הרוטציה ל-GEN-2 מתועדת
   בקומיט-על-השרשרת 8edc45ed… (17:29:09Z, block 110266615) וה-active החי =
   GEN-2 הצפוי (התאמה מאומתת).
4. **VERDICT** — DEAD / ALIVE-ALERT / UNKNOWN(-NOT-CHAIN-TESTABLE) לכל חומר,
   דרך auditor-צנזורה בקוד לפני-כתיבה.

**חוק-הצנזורה (ברזל):** בארטיפקט נכתב רק sha256-16hex של החומר + מפתח-ציבורי
נגזר + מטא-מקום. אף חומר-פרטי, אף סיסמה, אף תוכן-קובץ. הפרה = כשל-קשה,
כלום לא נכתב. הערכים חיים בזיכרון בלבד.

## הטבלה-העומדת (hash → מפתח-ציבורי → פסק)

| hash16 | סוג | מפתח-ציבורי נגזר | פסק | מקום-ראשון (מופיע ב-5 ריפואים אלא-אם-צוין) |
|---|---|---|---|---|
| `68c891d39dce9928` | pubkey | `STM8mSbBz8zsMfBow2xa1yfTuNhdp6KZf3v7kAs1BSQAB1AMQM1Fw` | **DEAD** | docs/KEY-INCIDENT.md (מ-2026-09-10) |
| `a060933235738c89` | pubkey | `STM8c9vp3hUnNsXHaWLPTpcYWkPpK5GrnySgN51FiGX9dxhwVz8YZ` | **DEAD** | docs/KEY-INCIDENT.md (מ-2026-09-10) |
| `fabbcdf2278d8858` | pubkey | `STM6u99ogJKojfZC94VCs73N3wVRxnm9XTjVSmkSm2BE59yDEuH6b` | **DEAD** | docs/KEY-INCIDENT.md (מ-2026-09-10) |
| `5ad1a13d7cb91a44` | pubkey | `STM7pmsRp7QrEnuGT6EWfnJMuSiAU9wXSoNUJRBYQio5qfGCSrax5` | **DEAD** | docs/KEY-INCIDENT.md (מ-2026-09-10) |
| `9e3af764371b8d68` | pubkey | `STM8PFEEhF9g3PMZu9mu9vso56bzP6i4aMYM73aWL8CkcKi4LEGLR` | **DEAD** | state/hive-intel-latest.json (רק-jummper) |
| `e76c845274793ed2` | pubkey | `STM82sVNpRXV86ARhL1mPoqjBTQUsdR5YwUg2dGAtJognb4cZveYH` | **DEAD** | state/hive-intel-latest.json (רק-jummper) |
| `9805443d09068ce9` | pubkey | `STM7ZReKWfMREwGQp4jDe8mxPXuLQLUro4WXks2s7rTzjAjpsGi3Y` | **DEAD** | state/hive-intel-latest.json (רק-jummper) |
| `b9f93d6be956f71b` | pubkey | `STM6aq8Ymd7NRVk2ry7buNHSFYCy5yGMKBXMZAa7hS7rtVL4VarGb` | **DEAD** | state/hive-intel-latest.json (רק-jummper) |
| `0b7273ebe23da4e3` | pubkey | `STM6wjYfYn728hR5yXNBS5GcMoACfYymKEWW1WFzDGiMaeo9qUKwH` | **DEAD** | state/hive-intel-latest.json (רק-jummper) |
| `658d061ca1a85765` | archive | — | UNKNOWN-NOT-CHAIN-TESTABLE | agent/vault/KEYS-ACCESS-README-HE.md |
| `dadf2d6c8cfdc1aa` | passphrase | — (מטריצת 392 גזירות: 0 התאמות-חיות) | UNKNOWN-NOT-CHAIN-TESTABLE | agent/vault/recovery-meta-2026-09-12.json (`keys_access_2026_09_12`) |
| `fd51fe837e016ea9` | archive | — | UNKNOWN-NOT-CHAIN-TESTABLE | agent/vault/KEYS-ACCESS-2026-09-12.tar.enc |

`DEAD` = אינו רשות-חיה באף חשבון-צי **וגם** אין-אזכור-גלובלי בשרשרת כולה —
טלפון-מנותק. `UNKNOWN-NOT-CHAIN-TESTABLE` = לא-ניתן-לבדיקה-בשרשרת מתוכנן
(ראו למטה). `ALIVE-ALERT` היה צורח כאן — אין.

## רענון-שבועי

Workflow `key-proof` ב-Sandbox: **יום-ד' 04:23 UTC** (cron `23 4 * * 3`) +
workflow_dispatch · selftest-כשער (26/26) → ריצה-חיה → קומיט של `proof/out/`
חוזר ל-main (github-actions[bot], rebase-before-push ×5, `[skip ci]`).
כל ריצה מייצרת `key-proof-<UTC-date>.json` + `KEY-PROOF-LATEST.json`;
המטא-מסונכרן לכאן. אם ריצה-עתידית תמצא ALIVE-ALERT — `summary.incident=true`
והטבלה כאן תתהפוך לאזעקה (ולא-טיפול-אוטומטי: זו החלטת-owner+orchestrator).

## מה עדיין דורש באמת את ה-owner

- **ארכיוני-הכספת המוצפנים** (`KEYS-ACCESS-2026-09-12.tar.enc` + ה-README
  הנלווה) — לעולם לא נפתחו על-ידי-המכונה מעצם-חוק-הצנזורה; מתועדים כאן
  כ-hash-בלבד. פתיחה/השמדה = החלטת-owner בלבד.
- **9 החיילים** (cashmachine, haran, israelnews, lsa, macrame, siq, tov, wog,
  woq) — פסק-המתים כאן מכסה חומר שדלף לגיט-ציבורי; הרוטציה-עצמה של רשויות-
  ה-owner שלהם (tx_missing_owner_auth) דורשת-מפתחות-owner:
  **sovereign/ceremonies/soldiers-key-ceremony.md** (מסילת 11-b).
- שים-לב: ריצת 2026-10-11 מצאה שגם מפתחות שפורסמו-טריים ב-2026-10-11
  (`state/hive-intel-latest.json`) מתים-מטבעם — הם גופי-מפתח שאינם בשימוש
  באף רשות-חיה.

---
*משמעת: קריאה-בלבד בשרשרת ובהיסטוריה · אפס-שידורים · אפס-כתיבות-שרשרת ·
אפס-נגיעה בכספת · טוקן ב-env בלבד, מעולם לא נדפס · trace 1a12c9d6f5df1b95*
