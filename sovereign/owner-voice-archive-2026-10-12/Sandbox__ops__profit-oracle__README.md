# profit-oracle · פעימת-רווחיות-עומדת יומית (STANDING DAILY PROFIT PULSE)

**zai-14b · trace 1a12d502a99b7021** — מצטרף ל-OWNER-WORD: *"the autonomy itself checks profitability daily"*.
הקבלה לשער-הבית (ops/fresh-oracle, zai-12b): אפס-תלות · ESM · node≥18 · fail-open כן · union-receipt
(prior נשמר מילה-במילה, runs מוגבל-12) · סריקת-סודות לפני-כתיבה · אימות-readback. **אפס-מפתחות** — קריאות-ציבוריות בלבד, אין-חתימה, אין-STASIS.

## EN · What it answers, daily (05:29 UTC)

| Check | Question | Verdicts |
|---|---|---|
| **V-WORTH** | What is the fleet worth right now? `get_dynamic_global_properties` (vests→SP ratio) + `get_accounts` on the exact 14-account roster + `get_order_book(10)` mid → own-SP / eff-SP / liquid STEEM+SBD / netWorthSbdEquiv | GREEN = all calls measured · UNKNOWN = any call failed (fail-open, never guessed) |
| **V-GRID-EDGE** | What does the pnl-desk say? verdict + `postLaw.edgePct` + `lifetime.realizedSbd` (desk law: weekly edge ≥ +1% = grid may place). The **value is data, not verdict** — placement authority stays in the desk (one-room law) | GREEN = fetched+parsed · UNKNOWN = fetch/shape fail |
| **V-ZOMBIE-LADDER** | Is the zombie ladder still standing? `database_api.find_limit_orders {"account":"headcorner"}` (method verified live, ECONOMIC-PLAN appendix-א' call #15) → open SBD/STEEM + count + zombie sub-ladder (buys ≤ 0.0995 SBD/STEEM) vs prior run | GREEN = standing/filled · AMBER = vanished (fill or owner-cancel — needs account-history proof) · UNKNOWN = fail/first run |

**Daily profit delta:** netWorth vs previous run → `PROFIT` (> +0.5%) · `FLAT` (±0.5%) · `LOSS` (< −0.5%) · `UNKNOWN`.

**Roster (14, exact):** headcorner · posters cashmachine, haran, israelnews, lsa, macrame · micros siq, tov, wic · wog, woq · soldiers hcsoldier4/5/6 — verbatim from ECONOMIC-PLAN-2026-10-11.md appendix-א' call #3 (`get_accounts[14 fleet]`, measured by zai-10d 19:54Z). hcsoldier1/2/3 are outside the manifest (LOST-NO-CUSTODY, ONE-ROSTER-2026-10-11.md). Baseline replay verified: own-SP 4294.4 / eff-SP 3556.0 / zombie 91.195 SBD ×5 orders @0.0985 — the formulas reproduce the 19:54Z numbers.

## עברית · מה-הוא-עונה כל-יום

שלוש שאלות: **מה-שווי-הצי** (own/eff-SP + נזיל + mid → netWorthSbdEquiv), **מה-אומר-שולחן-ה-pnl** (verdict + שוליים-שבועיים + realized — הנתון הוא נתון, ההכרעה ב-desk), ו**האם-סולם-הזומבי-עומד** (פקודות-פתוחות של headcorner מול-הריצה-הקודמת; נעלם = AMBER עד-שמתברר מילוי-או-ביטול-בעלים). ומעל-הכל: **דלתא-רווחיות יומית** על netWorth — PROFIT/FLAT/LOSS/UNKNOWN.

## Receipt contract — `receipts/profit-oracle-latest.json` (consumers, do not break)

```json
{"ok":true, "at":"<ISO>", "agent":"profit-oracle v1 (zai-14b)",
 "summary":{"GREEN":n,"AMBER":n,"RED":n,"UNKNOWN":n,
   "ownSp":num,"effSp":num,"liquidSteem":num,"liquidSbd":num,"mid":num,
   "netWorthSbdEquiv":num,"deltaVsPriorPct":num_or_null,
   "gridVerdict":"...","gridEdgePct":num_or_null,"ladderOpenSbd":num_or_null,
   "ladderCount":num,"ladderZombieSbd":num,
   "verdict":"PROFIT|FLAT|LOSS|UNKNOWN"},
 "runs":[…≤12], "prior":{…seed receipt verbatim or null}}
```

Top-level `summary` = latest run (freshness field: `at`). `ladderCount`/`ladderZombieSbd` are additive conveniences. Consumers today: FleetHQ `office/retro.mjs` (14-c) · Domain `index.html` research panel (14-d) · office retro proposals · registered on the Zip bus as feed `sandbox-profit-oracle` (schema `roshpinacare.profit-oracle/1`, tier A, daily 05:29 UTC).

## Run it

```sh
node ops/profit-oracle/oracle.mjs --selftest   # offline vectors, zero network — must be all green
node ops/profit-oracle/oracle.mjs              # live: writes receipt + ops/profit-oracle/verdict.md
```

Workflow: `.github/workflows/profit-oracle.yml` — daily cron `29 5 * * *` (odd-minute, distinct from token-watchdog 05:40 / hive-probe 05:41) + dispatch; selftest gate → live → commit receipt+verdict `[skip ci]` with rebase-loop ×5 → honest-exit summary. **No secrets needed — every source is public.**
