# T15 SCOPE — truth-gate RED → enforced laws + verification wired everywhere
Owner mandate (verbatim, 21:5xZ): "תמשיך תראה מה שאר הסוכנים עושים ותצטרף כדי לתת עוד
כוח ולבדוק מה לא מחובר ... להפוך מתיאור למעשים אוטונומית ריבונית למעשה"
(see what other agents do, join, add power, find what's NOT CONNECTED, turn
descriptions into actions, autonomously, sovereignly, into action).

## Measured trigger
Console truth-gate RED (run 38178302247, 21:54Z): agent-verify 48/51 —
A38 state.income.treasuryProfitEverMu=72000 < 213752 (R46 ratchet),
A39 state.rail.equityMu=1139897 < 17975080 (R28 ratchet),
A43 markets.1.bestAsk=0 (SETTLE-17 two-sided law).
Root causes measured:
- REGENESIS git-proven: Console dex/world.json heights h186399 (2ba457186,
  10-10T06:28Z) → h8641 (423800931, 10-10T14:49Z). Chain was reborn; R46 seed
  (chain.ts:248) only fires when the field is MISSING — kernel init makes it 0
  (a number), so the git-proven high-water seed never re-applied. A38's desc
  itself specifies the seed semantics.
- A43: soldier quotes are FIXED-size (sizeMu 80Kµ, mm.ts:520); soldiers hold
  <80Kµ WSTEEM → every ask placement skips ("honest inventory") → one-sided
  market. A real (smaller) ask from real inventory would satisfy the law.
- A39: floor 17,975,080µ measured 2026-09-17 on the PRE-regenesis chain; the
  engine's own sealed funding floors (SETTLE-16/18: FLOOR_USDS 250Kµ,
  lifetime caps 6M/5M) make the old value unreachable post-regenesis without
  minting (= forgery). Needs honest re-anchor via CR, not test-fitting.

## Lane (mine, T15)
1. saos-dex engine (quiet since 13:20Z kernel / 10-06 chain / 10-08 mm):
   a. chain.ts — R46 seed becomes an unconditional max-floor on load.
   b. mm.ts — SETTLE-17-b: inventory-adaptive quote size (dust floor 300µ,
      RAIL_DUST_MU pattern); zero minting, escrow/spread/requote laws intact.
   c. rail.ts — publish fundedEverMu (Σ git-backed railLifetime marks) so the
      A39 replacement has a monotonic, honest field to pin.
   d. deterministic selftest proving: seed applies on load; tiny-inventory
      soldier quotes a live ask; conservation invariant intact.
2. Dispatch beat → Console world.json re-published → agent-verify re-run →
   A38+A43 GREEN (chain-verifiable, no claims).
3. Domain CR-0077: A39 re-anchor to the monotonic rail counter with full
   regenesis evidence (verify-network owns assertions.json — CR, not trample).
4. Connect the verification network into the living surfaces:
   local /api/worlds-state +9th source (Console verify verdicts) → office
   shows the organism's self-check honestly; Sandbox decider.py +1 source
   (truth-gate RED → D-series decision).
## Rails
R1 anti-forgery: every number measured; fail-closed; no execution claims
   without receipts. R4 no trampling: engine files quiet-verified first;
   assertions.json owned by verify-network → CR only. R5 honesty incl. self.
