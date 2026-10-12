# Ventures — the fleet's public business board (two-sided ledger)

_venture-desk v1.2.0 · 2026-10-12T12:28:13.513Z · doctrine: check failed this run (honest) · leg: not readable in this context (canon-liveness names the legs)_

Born from the clodfarm study (Z-31): they built the best stop-spending governor we have seen and no earn side at all. We adopt the governor math and bind the missing half as law. Standing truth:

**measured ledger unreachable this run — booked as null, never estimated**

- **EARN-GOVERNOR (measured surfaces):** market desk realized lifetime **3.466847 SWAP.HIVE** ≈ **$0.189855** across 3 fills (fills-ledger, deduped, chain-truthed)
- **Price oracle (measured this run):** HIVE $0.054763 · STEEM $0.059809 · BLURT $0.00130526

## V1 · Curation house — OPEN
- **Thesis:** disciplined public-external curation (10 soldiers lane; owner lanes steem/hive/blurt owned by the weave daemon) — our votes ARE the traffic
- **Product → rail → traffic:** attention allocated by deterministic public scoring → HP/VP curation rewards (steem/hive/blurt) → native feeds of curated public authors
- **Earn line:** pending accrual measured per cycle; per-day line set after 7d of book (honest TBD)
- **Kill rule:** no measurable curation accrual in 3 consecutive cycles → weight→0 (IDLE)
- **Evidence:** curation-book.json (marker "soldiers lane of the fleet curation") ✓ · soldiers-curate.cjs (marker "verify-then-sign") ✓ · money-ledger.json (marker "headBlurt") ✓ → mechanism PROVEN in-repo
- **lastRun:** {"day":"2026-10-04","verified":0,"attempted":0,"soldiersWithKey":10}
- **laneSurfaces:** {"steem":{"stake":"2925.633 SP","liquid":"28.261 STEEM","debt":"9.367 SBD"},"hive":{"stake":"25.404 HP","votingPower":98,"pending":{"liquid":"0.000 HIVE","debt":"0.000 HBD","vests":"0.000000 VESTS"},"rcPct":0},"blurt":null}
- **earn:** measured pending $0 (0 HIVE @$0.054763)
- **z34Probe:** soldiers lane verified ALIVE by DRYRUN probe (78 candidates/8 soldiers, 2026-10-02T21:4xZ) — the zero tally that morning was transient, kill-rule NOT triggered

## V2 · Market desk — OPEN
- **Thesis:** dual-side hive-engine trading: harvest idle tokens, maker buys into live books, dust honesty
- **Product → rail → traffic:** liquidity + realized spreads → hive-engine order books → the books' own flow (ghost-book gate refuses dead books)
- **Earn line:** realized spreads ≥ $0.02/day within 7d of live rails
- **Kill rule:** RAIL-HEALTH stall >24h → zero signing; no fills in 14d → capital→escrow (HARVEST)
- **Evidence:** econ-desk.cjs (marker "rail-health") ✓ · econ-desk.cjs (marker "verify-then-sign") ✓ · econ-book.json (marker "rail-health") ✓ → mechanism PROVEN in-repo
- **swapHiveTreasury:** 0
- **hiveLiquid:** 0.034
- **railFrontier:** 0
- **lastDeskRun:** 2026-10-04T20:59:10.983Z
- **realizedLifetime:** 3.466847 SWAP.HIVE across 3 fills (fills-ledger, deduped, chain-truthed)
- **realizedLifetimeUsd:** $0.189855 at measured HIVE $0.054763
- **earnLineProgress:** one settled wave ($0.189855) already exceeds the 7d line budget ($0.14) — line on pace, rate still measured per-day by KPI oracle

## V3 · Knowledge house — OPEN
- **Thesis:** public verified playbooks (rail-health, verify-then-sign, delta-settlement, the two-sided ledger itself) as the authority funnel
- **Product → rail → traffic:** open doctrine + field-test reports (natural voice, EN, public) → steem/hive/blurt posts (tri-bridge canon) → SEO + native feeds; authority compounds
- **Earn line:** leading: views/votes per playbook; 3 playbooks × 0 engagement → retitle/re-lane
- **Kill rule:** 3 consecutive playbooks with zero engagement → PIVOT lane
- **Evidence:** knowledge-cards-en.json ✓ · public-wave.cjs ✓ → mechanism PROVEN in-repo
- **earn:** leading indicators only for now (engagement), no fake USD
- **latestSample:** {"post":"saos-wog-20261003","votes":11,"payout":"0.001 SBD","at":"2026-10-09T19:39:24.984Z"}

## V4 · Content house — PROPOSED
- **Thesis:** per-persona expert lanes, zero AI-smell, English public content — support the public, never the echo
- **Product → rail → traffic:** expert long-form posts under fleet personas → steem/hive/blurt → followers/feeds + curation discovery
- **Earn line:** leading: engagement per lane; lane with 0 engagement in 14d → merge lane
- **Kill rule:** 14d zero-engagement lane → merged (IDLE) — the lane list shrinks honestly
- **Evidence:** personas.json ✗ · soldiers-blog.cjs ✓ → mechanism NOT proven (honest PROPOSED)
- **earn:** TBD-MEASURE (per-lane engagement tracked in learning-ledger)
- **trackedPosts:** 43
- **postsWithEngagement:** 43

## V5 · Fuel grid — OPEN
- **Thesis:** external fills on the fuel grid — the only currently-measured external USD inflow
- **Product → rail → traffic:** grid liquidity → grid external flow → external traders
- **Earn line:** measured $0.0604 lifetime (KPI) — keep only if fills continue
- **Kill rule:** no external fill in 21d → freeze grid spend (IDLE)
- **Evidence:** routes.json ✓ · route-desk.cjs ✓ → mechanism PROVEN in-repo
- **lifetimeUsd:** null
- **earn:** KPI source unreachable this run

---

_Laws binding this board: GOVERNOR LAW · TWO-SIDED LEDGER LAW · EARN-GOVERNOR LAW · NOTEBOOK LAW · MEASURABLE→DASHBOARD LAW · LABOR TIERING LAW · VENTURE TEMPLATE LAW · DELEGATION-SELECTION LAW (Defi/fleet/DOCTRINE-economics.md)._
