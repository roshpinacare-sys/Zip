# EXPANSION-PLAN — סולם-ההרחבה בין-רשתות (2026-10-11, task 9-d)

> **בעלות (COORDINATION.md rule 2):** Zip · `sovereign/EXPANSION-PLAN-2026-10-11.md` + Sandbox · `probes/*` · **agent 9-d (expansion-agent)** · 2026-10-11 · מטרה: סולם-הרחבה מדורג Hive/Blurt/EVM-testnet/Solana עם שערי go/no-go כבולים למשמעת STASIS/מילת-owner.
> **הכלל:** קובץ זה additive בלבד. הוא אינו נוגע ב-STASIS, בכספות, בקבצי-חימוש (blurt-arm.json), בגיטליקס, או בכל מסילת-הון. Stage 3 להלן **אסור** בלי מילת-owner מפורשת שנרשמה ב-`COORDINATION.md`.

---

## 1. מסגרת-המשמעת (ירושה — לא שינוי)

הסולם יורש את ארבעת המנגנונים הקיימים, בלי לחדש אותם:

| מנגנון | מקור (repo · file) | מה יורש הסולם |
|---|---|---|
| STASIS | saos-dex · `grids/state/STASIS.json` + `grids/brake.mjs` (resumePolicy: root-cause + judge-green + owner word) | כל מסילה בסולם נפתחת רק בתוך STASIS; סגירת-STASIS = עצירת-הכל |
| מילת-owner | Zip · `COORDINATION.md` rule 5 | Stage 3 (מסילות-הון) דורש מילה מפורשת שנרשמה ב-COORDINATION.md |
| טקס-חימוש | steem@saos-cockpit · `mini-services/saos-engine/state/blurt-arm.json` (approvedBy trace + order + gates; R294 requiresArmFile) | ה-pattern לכל חימוש-מסילה: קובץ-arm + מפעיל-שופט + fail-closed |
| חוקי-הסנדבוקס | Sandbox · SECURITY.md + agents/gate | keys/broadcast = operator-only; ה-probes להלן קוראים בלבד |

**טירת-חשיפה (מ-7-b):** digests של ה-probes = טירה-A (public-by-design — נתוני-שרשרת בלי-מפתחות). שום פרמטר-אסטרטגיה, כתובת-מטמון או roster אינו יורד ל-digests.

---

## 2. הסולם (ארבעה-שלבים, פר-רשת)

| Stage | שם | מותר | אסור | שער-יציאה (go/no-go) |
|---|---|---|---|---|
| **0** | probes (no keys) | קריאות-RPC ציבוריות: מצב-רשת, feed-מחירים, tickers, node-health | מפתחות, אימות, שידור, כתיבת-מצב | **0→1:** ≥7 digests יומיים `ok:true` על דקות-ציבור (Sandbox), אפס-מפתחות בהיסטוריית-ה-probe, fail-honest נשמר (red probe נשאר red). no-go: digest מזויף-הצלחה אחד = עצירת-הסולם כולו |
| **1** | market intelligence | קריאות-עומק: ספר-פנימי, נזילות, gas, reserves (testnet), node-sets | פוסטים, מפתחות, שידור, החזקת-מצב חוץ-גיט | **1→2:** מסילת-ה-intel נרשמה בטבלת-הבעלויות ב-COORDINATION.md; לפחות צרכן-אחד מוכח (למשל R294 שותה node-health של Blurt); עדיין אפס-מפתחות |
| **2** | social presence | פרסום/הצבעה **דרך מסילות posting-authority קיימות בלבד** (pattern: steem engine CI_SOCIAL_ARMED + R294 custody-judge + requiresArmFile) | active/owner/memo keys; מסילות-חתימה חדשות | **2→3:** מילת-owner מפורשת ב-**COORDINATION.md** + קובץ-arm פר-מסילה (pattern blurt-arm.json) + שופט-שרשרת fail-closed + STASIS-lift עם resumePolicy מלא |
| **3** | capital lanes | מסילות-הון (עסקאות, המרות, נזילות) עם מפתחות **רק דרך כספות-ה-vault הקיימות** (vault-home / Domain Actions vault) | **כל חומר-מפתח בקוד, ב-digest, ב-repo, או ב-probe — אסור לחלוטין** | אין שער-הלאה מהסולם הזה; סגירת-מסילה = STASIS |

---

## 3. רשת 1 — Hive (עדיפות 1, הקרובה-במשפחה)

**קיים היום:**
- saos-jummper · `src/jumpper/freeops.py` — הכלכלה המדויקת של custom_json כאטסטציה-חינם (attestation ≠ enforcement), ממוספרת מול mainnet.
- saos-jummper · `src/jumpper/witness.py` — קריאת-heads בלבד מ-RPC-ציבוריים; `xlock.py` — "signs and never broadcasts"; `anchor.py` — מודל-gas מדויק ל-EVM (תוצר-מדוד, לא שיווק).
- saos-dex · `src/lib/dex/chain.ts` — משפחת-Graphene (ref_block+expiration) כבר ממומשת ומאומתת — Hive היא אותו-דיאלקט.
- **(חדש ב-task 9-d)** Sandbox · `probes/hive-probe.mjs` + `.github/workflows/hive-probe.yml` — Stage-0 יומי.

**חסר:**
- קיום-חשבונות/רשות-posting של הצי על Hive (ה-roster שלנו על Steem; Blurt נמדד — Hive לא) → קריאת `get_accounts` read-only ב-Stage-1.
- מסילת-posting ל-Hive (אין כיום; ה-posting-authority שלנו היא Steem).

**שער 0→1 (נמדד 2026-10-11):** Hive RPC חי — `api.hive.blog` ענה 200, head_block 110683598; ספר-פנימי חי (best_bid 0.05568 / best_ask 0.05591, spread 40.3bps); witness-feed 0.055 HBD/HIVE. ה-digests ייאספו יומית ב-`Sandbox/probes/hive/`.

---

## 4. רשת 2 — Blurt (עדיפות 2, כבר חמושה)

**קיים היום:**
- steem@saos-cockpit · `mini-services/saos-engine/blurt.mjs` — BLURT_NODES failover + BLURT_ROSTER (9 חשבונות קיימים עם posting authorities, נמדד 2026-10-11).
- טקס-R294 · `state/blurt-arm.json` — armed `staged-trial` (owner-word trace 1a12b258c9776305; gates מחמירים: minPostChars 1800, dayCap 1); custody-judge + final-judge fail-closed.
- **(חדש ב-task 9-d)** Sandbox · `probes/blurt-probe.mjs` — סולם-node-health מרובה-צמתים. **ייעודי-בלבד — לא נוגע ב-blurt.mjs או בטקס-החימוש.**

**ממצא-node-health שנמדד (2026-10-11, ה-intel ש-R294 ביקש):**

| node | מצב מהסנדבוקס הזה | ראייה |
|---|---|---|
| `https://blurt-rpc.saboin.com` | ✅ חי, 797ms, מסונכרן (skew 0s) | head 64395586, block-time מתאים |
| `https://rpc.blurt.blog` | ⚠️ לא-יציב מ-IP-דאטה-סנטר: 200 OK ב-curl ראשון, **http_429** ב-probe דקות-אחר-כך (והצי מדד 403 קודם) | rate-limit לסביבות-ענן |
| `https://rpc.blurt.world` | ❌ NXDOMAIN (מאושש את מדידת R294) | fetch failed |
| `https://blurt-rpc.blurtlatam.com` | ❌ TLS-eof | fetch failed |

**חסר:** שום-דבר ב-Stage 0-1. שוק-פנימי: `get_order_book`/`get_feed_history` **לא קיימים** בצמתים-ציבוריים של Blurt (נמדד) — intel-שוק ל-Blurt חייב מקור-חוץ (נרשם כ-honest limitation ב-digest).

---

## 5. רשת 3 — EVM L2 testnet (עדיפות 3; **testnet בלבד — כלל-קשה**)

**קיים היום:**
- saos-dex · `src/lib/dex/relay-eth.ts` — שתי-טירות: (1) כוונת-עיגון EIP-191 חתומה — אפס-גז, תמיד-פעילה; (2) שידור EIP-1559 — חמוש-ונעול עד-מימון ("unfunded — pending funding", לא נספר ל-breaker). fence.ts נעול-מארחים.
- saos-jummper · `src/jumpper/anchor.py` — מודל-gas מדויק (EIP-2028/7623) מאומת מול mainnet-tx אמיתי.
- saos-sovereign-platform · SAOSRelay.sol — מימוש-קונטרקט מקומי (anvil בלבד).

**חסר:** בחירת-L2-testnet (קריטריון: public testnet עם faucet יציב — Sepolia/Base-Sepolia/Arbitrum-Sepolia; **אסור mainnet**); probes של gas/height/chainId; אפס-custody — ה-faucet והמימון הם תחום-ה-owner.

**שער 0→1:** probes read-only על RPC-testnet ציבורי (chainId, gas, block) — נכתב כהרחבה של `probes/` אחרי ש-0→1 של Hive/Blurt נסגר. **no-go מוחלט:** כל בקשה לחבר mainnet-EVM לפני Stage-3 מלא.

---

## 6. רשת 4 — Solana (עדיפות 4; read-only)

**קיים היום:** saos-dex · `src/lib/dex/relay-sol.ts` — SPL Memo v2, רצפת-rent נמדדה (~890,880 lamports, roast-67 devnet), חתימת-Ed25519 מזרע-ריבוני; saos-jummper · `src/jumpper/solana.py`.

**חסר:** probes (getVersion/getEpochInfo/getBlockHeight — קריאה-בלבד). **כלל:** Solana נשאר read-only בסולם הזה; Stage 2-3 לא מוגדרים (אין social rails ל-fleet על Solana; capital lane דורש owner-word נפרד לגמרי).

---

## 7. תשתית-ה-Stage-0 שנבנתה (task 9-d)

| רכיב | מקום | תכונות |
|---|---|---|
| `probes/hive-probe.mjs` | Sandbox @ `24ebca2` | 6 קריאות-ציבוריות; timeout 12s + retry×2 + failover-3-endpoints; 4 selftest-vectors עם fetch-mock; exit-honest |
| `probes/blurt-probe.mjs` | Sandbox @ `24ebca2` | סולם-4-צמתים כולל canaries-מתים; block-skew staleness-check; 4 selftest-vectors; exit-honest |
| `.github/workflows/hive-probe.yml` | Sandbox @ `24ebca2` | יומי 05:41 UTC + dispatch; selftest-gate → probes → commit-digest (`probe-runner[bot]`, `git pull --rebase` לפני-push) → honest-exit; **אפס-סודות** |
| digests | Sandbox `probes/hive/*.json`, `probes/blurt/*.json` | append-יומי; schema `roshpinacare.{hive-stage0,blurt-node-health}-probe/1` |

## 8. מה התוכנית הזאת לא עושה (במפורש)

- לא נוגעת ב-STASIS, ב-gitleaks, ב-signer/vault/blurt-arm, בקבצי-delegation.
- לא מכניסה מפתח, כתובת-מטמון, או פרמטר-אסטרטגיה לשום digest/repo.
- לא משדרת כלום לאף-רשת. Stage 2+ מתחיל רק עם מילת-owner ב-COORDINATION.md.
- לא מחליפה את R294 — מספקת לו intel.

## 9. הצעדים-הבאים (בסדר-הסולם)

1. **מיד:** לתת ל-Sandbox workflow לרוץ יומי; לאסוף 7 digests (שער 0→1).
2. **Stage-1 Hive:** `get_accounts` read-only לבדיקת roster על Hive; עומק-ספר שבועי (order_book 50-levels).
3. **Stage-1 Blurt/EVM/SOL:** הרחבת `probes/` (gas+chainId testnet; SOL epoch-reads) — אותם-חוקים.
4. **ל-R294:** הטבלה בסעיף 4 — saboin ראשון נשאר נכון; שקול 429-backoff ל-rpc.blurt.blog.
