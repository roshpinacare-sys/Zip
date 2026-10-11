# ONE-ROSTER — the fist map of all 26 repos (2026-10-11, task 10-c)

> **Owner mandate (trace 1a12c59452cbc355, word-for-word):** "אני לא רוצה לארכב
> בארכיב את התיקיות שהושתקו — הן לא סתם שם... כל התיקיות צריכות להיות בשימוש
> קבוע שימושי עבור הריבונות האוטונומית... לתקן במקום לנעול." → **NO archiving,
> NO fleeing. Every unit: one role, one duty, one revival path. Duplicates
> become defined roles — the 26 repos work as ONE FIST ("מקשה אחת").**
>
> Supersedes the 26→8 consolidation wave (zai-fix/9-c tombstones) — owner
> override executed by the E-series revival (trace 1a12c5650f03f7a1) + the
> task-10 lanes. Nothing was deleted; tombstone lessons preserved in history.
>
> Ground truth sources: whole-git audits (5-0/5-a/5-b/5-c/5-d), worklog tasks
> 6–9, fresh API/clone checks this day. Every role row below is measured, not
> asserted — "why muted" names the root cause, never a euphemism.

## The fist, by wing

### A. The heartbeat wing (public, free minutes, ALIVE today)

| Repo | Role (one) | Standing duty (one) | Revival/robustness path |
|---|---|---|---|
| **Domain** | public heartbeat + scheduler | cron mesh → dispatches dex-grid twin, content campaign, weave failover (ZIP_PAT takeover when Zip ledger stale >26h) | alive; secrets map belongs in control-center (tier-B policy 7-b) |
| **Console** | keyless truth machines | dex telemetry mirrors, receipts, redaction-at-write | alive |
| **Sandbox** | autonomy runtime (measurements only, zero keys by its own law) | self-perpetuating tick chains, fleet-heal (revives red repos when billing returns), Stage-0 Hive/Blurt probes (9-d), retro loop | alive; rescue-guard revives stale chains |
| **saos-runtime** | free-minutes executor host | self-pulse → clones steem:saos-cockpit → ci-cycle (custody/social/content/dex-takeover) → FF state push | alive; blocked today by GEN-2 key + billing for capital legs |
| **FleetHQ** | office window (fragments + receipts) | daily office-window build → Pages (10-a lane, live) | alive on public minutes |
| **sovereign-lighthouse** | GitHub heart-rail beacon | Pages mirror of sovereign memory; external heart writer + T11 self-contained pulse | alive; re-home writer when the machine returns |
| **sovereign-beacon** | GitLab-rail beacon (twin cloud) | second independent heart (redundancy by design, NOT a duplicate) + T11 GitHub pulse | alive; GitLab rail is its live publisher |
| **saos-agents** | agent registry + orchestration-core source of truth | vendored-copy lineage registry; Release v0.1.0 distribution; dispatch-only selftest-gate (98/98) | npm publish = one owner decision (PAT scope or GH Packages) |
| **TruthRail** | keyless verifier layer + witness rail | third-party-verifiable chain probes (zero-verify, artifact-verify); T-lane audit ledger | verifier runs are read-only; schedule needs only minutes (none assigned by 10-c — role already declared, T-lane active) |

### B. The engine wing (private, billing-walled since ~09-20 — code green, cloud red)

| Repo | Role | Standing duty | Why muted (measured) | Revival path |
|---|---|---|---|---|
| **steem** (branch saos-cockpit) | the real engine + cockpit | 21-phase daily cycle; custody anchors (`saos-git-custody-v1` canonical); social/curation rails | billing wall + GEN-2 key not yet in Domain vault | owner: billing + GEN-2 WIF; then saos-runtime runs it from cloud |
| **Zip** | sovereign state tree + doctrine + coordination surface | weave-anchor ledger (bot-committed 20-min cadence), COORDINATION.md, audit deliverables (ONE-ROSTER lives here) | Actions writers dead since 10-08 (billing); Domain twin = cloud failover | billing; twin already covers takeover |
| **saos-dex** | DEX/market engine | grids + honesty gates (9-c: key-gate, truthful verdicts, params validator, liquidity lane) | stale vault ACTIVE WIF (every broadcast honestly refused since 10-08) + billing | owner updates `STEEM_ACTIVE_WIF` → GEN-2, re-dispatch dex-grid |
| **saos-control-center** | **agent coordination registry** (declared 10-c) + fuel-telemetry bot (its own 15-min lane) | tsc gate green (10-c root-cause fix @ f1b3f06), dispatch-ready build workflow | recorded tsc FAIL (2026-10-08) — FIXED; billing wall | dispatch `control-center-build` once minutes return (probe run 38168255022 = honest wall signature) |
| **anchor-baseline** | **CONFORMANCE SUITE for `saos-git-custody-v1`** (repurposed 10-c from archive twin) | vectors + runner + selftest (35/35) guard the canonical anchor shape for all 5 anchoring impls | PASS-stamp archive; one of 5 duplicated anchoring impls | suite already runs on bare node; dispatch `conformance-selftest` when minutes return (probe 38168256744 = wall signature) |
| **saos-jummper** | cross-chain notary + **read-only Hive intel unit** | own stdlib Hive probe (digest committed 38d48f9; live head 110688597); future custody anchors must pass the conformance suite | runtime lanes parked by billing; anchoring gated by capital laws | dispatch `hive-intel` when minutes return; anchoring needs capital-lane owner word |
| **saos-sovereign-foundry** | agent ops console **v1** | lean ops face: mini-services organs + anchor-* routes; CI = where the prod build gets verified | event-driven by design (zero cron); billing wall | dispatch ci.yml + api-check once minutes return |
| **saos-sovereign-platform** | local-machine console **v2** (foundry's deep sibling — both alive by defined roles) | operator cockpit (:3000/:3005/:8545/:3037); platform-selftest (dispatch) | event-driven by design; runs where the machine runs | `npm run dev` + keeper on the operator's machine — needs no Actions minutes |

### C. The product & estate wing (private)

| Repo | Role | Why muted | Revival path |
|---|---|---|---|
| **SovereignConsole** | **OFFICE MIRROR** — keyless read-only status console (declared 10-c; de-duplicated from FleetHQ template family) | template duplicate, 0 workflows/0 README, never executed | `office-mirror.yml` (dispatch) + `scripts/office-mirror.mjs` — verified live MIRROR-GREEN 5/5 public surfaces; no console runtime needed |
| **Defi** | DeFi canon + honest receipts home | receipt writers decayed at billing cutoff 10-06/10-08 | resume writers when engines trade; dispatch its 3 workflows |
| **roshpina** | sovereign trust & value console (real kernel, sim world, honest) | never had a runtime lane | deploy console + point controls-audit at a real audit |
| **Adsmarket** | marketing estate + claims-guard evidence rule (E-series revival role) | content-complete + billing | dispatch claims-guard; campaigns re-activate drip |
| **Saosmartwallet** | wallet product design + chain adapters | design-complete, runtime never deployed; committed vault DB = owner decision | owner: vault DB scrub decision after rotation; then wallet-verify |
| **Sdk** | broadcast-archive twin of anchor-baseline (honest naming note kept) | duplicate evidence hoard stalled 10-06 | dispatch sdk-verify; follow conformance-suite pattern |
| **Project-files** | canonical installer/runtime archive vault | archive by design + billing cutoff | dispatch archive-keeper; dedup PULSE below 0.2 target |
| **sanbox** | operator's local HQ server + heart-writer home | died with the operator's machine 10-10 (environmental, not abandonment) | boot machine → heart tick resumes; sovereign-heart stays dispatch-only |
| **vault-home** | live vault machinery — **READ-ONLY for agents** (untouched by 10-c; R11 rotation campaign = T-lane) | n/a (active) | owner: rotation + recovery-meta.json cleanup after reader-sync |

## Duplicates → defined roles (no dead copies)

| Duplicate family | Resolved roles |
|---|---|
| Anchoring ×5 | steem saos-engine = canonical `saos-git-custody-v1` · **anchor-baseline = conformance suite (one vector set for all)** · Zip weave = `saos.weave.core.v1` (distinct, richer) · saos-dex = `saos-dex.anchor.v1` (declared distinct) · jummper = future HIVE anchors, must conform |
| Consoles ×12-14 | Console = keyless truth machines · FleetHQ = office window · SovereignConsole = keyless office MIRROR · foundry = agent-ops v1 · platform = local-machine v2 · roshpina = trust kernel estate · beacons = public mirrors |
| Beacons ×2 | lighthouse = GitHub heart rail · beacon = GitLab rail (2-cloud redundancy by design) |
| Vaults ×4 | vault-home = live vault (read-only) · saos-dex = WIF custody (engine-internal) · Saosmartwallet DB = product vault (owner decision pending) · Defi phase0-kit = doctrine kit |
| Archives ×3 | anchor-baseline = conformance suite · Sdk = broadcast archive · Project-files = installer archive |

## STASIS halted lanes (surfaced — NOT lifted by agents; owner-word law, COORDINATION rule 5)

| Lane | State | What unblocks it |
|---|---|---|
| **convert** | halted (STASIS staged) | owner word (explicit COORDINATION registration) |
| **transfers** | halted | owner word |
| **delegations** | staged-ready — 1,024 SP plan measured (`sovereign/zai-audit/2026-10-11.json`); machine REFUSED honestly on stale key | **GEN-2 `STEEM_ACTIVE_WIF` in Domain vault → re-dispatch dex-grid** (the single key step) |
| **votes** | halted | owner word + staggered windows/VP floors (7-a plan) |
| **liquidity-bootstrap** | wired, refuses without arm-file | owner writes `grids/liquidity-arm.json` (SAOS-LIQUIDITY-ARM/1) |
| **blurt rail** | operator-pause R254 + node 403 pattern | owner arm decision; saboin-first failover measured (9-d) |
| **content posts** | LIVE-REFUSED-NOT-ARMED | `CI_SOCIAL_ARMED` secret (caps already law) |

## Owner gate list (what still needs a human)

1. **Billing** — lift Actions minutes: fleet-heal then revives ~15 private repos in ≤24h (Sandbox's own promise, still pending its trigger).
2. **GEN-2 key** — update `STEEM_ACTIVE_WIF` in Domain vault (derives `STM5jRfQH9DAF2474UQF1GVarShJZhpSPEYZFiZVr8MHV8cNSXDQf`), re-dispatch dex-grid → unlocks delegations + grid at once.
3. **R11 rotation** — key material captured in PUBLIC history of 5 repos; rotation is the only real fix (9 un-rotatable soldier keys included).
4. **vault-home** — `recovery-meta.json` plaintext passwords at HEAD (live reader risk, deferred by 5-c); rotation sync first.
5. **Saosmartwallet** — git-committed vault DB decision (scrub history after rotation).
6. **saos-agents npm** — publish-capable token or GitHub-Packages rail.
7. **STASIS words** — the lane table above, one word each.

*Machine provenance: authored by task 10-c (un-silence-sweep agent, [zai-10c]) on public evidence — every "role" line also lives in its repo's README as of today.*
