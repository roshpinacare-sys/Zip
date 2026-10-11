# EXPOSURE EXECUTION — 2026-10-11 (task 9-b, exposure-convergence)

Execution of the **7-b tiered exposure policy** against the still-public surface (Domain, Console, FleetHQ + on-chain). Companion data: `sovereign/zai-audit/exposure-execution-2026-10-11.json`. Coordination lane: `[zai-9b]` in COORDINATION.md.

## What ran

1. **YAML ops-hygiene sweep** — Domain: 55/65 workflows scrubbed (batches aa/4–ad/4 @ b343ac6..ddaed00, recovered from the dead attempt and re-verified on latest main incl. post-bot-commit YAML parse of all 65 files). Console: 17/18 workflows scrubbed this lane (@ d99c36ad + aa626094; 165 ops/secret-map comment lines out). Removed: Hebrew ops-playbook blocks, secret-name/custody commentary, schedule-rationale comments, R/r/T/OL/CR task-code trails. Preserved: workflow names, dispatch names, trigger types, step logic, `dex-grid.yml` (comments + minute only — load-bearing for money-watch), `content-campaign.*` (9-a closed), `gitleaks*.yml` (forbidden lane).
2. **Cron-minute randomization** — same intervals, intra-hour/inter-repo ordering kept (e.g. Console `weave-census :06` still precedes Domain anchor line `:20`, which still precedes `console-publish :38`). Sample old→new: Domain dex-beat `53 */4`→`12 */4`, anchor-execute `55 13`→`8 13`, daily-digest `5 1`→`2 1`, weave-anchor-lines `:33`→`:20`, dex-grid `43 3`→`26 3`; Console trigger-mesh `23 */3`→`44 */3`, money-watch `31 */2`→`33 */2`, rea-desk `27 4 * * 2`→`52 4 * * 2`.
3. **Telemetry redaction (tier-B out, tier-A stays)** — write-time steps recovered/verified on both repos (Domain 6d85c5a: 14 writers; Console 300f42bf: 9 writers) and **closed the live HEAD surface** with one-time passes over exactly the wired file lists: Domain @ 010550d (32/43 files changed), Console @ 902cef9b (8/11, incl. `receipts/r35-full-cycle.json`: custody `TYVw…` + `destTron TG6S…` masked). Personal addresses → 4-char prefix + …, grid commit/spread/peg-out params → coarse bands, roster account fields → masked, secret-name fields → `[redacted]`. Kept: 64-hex digests, deposit receive addresses, counts, verdicts, hashes. Validated locally on real files + a synthetic tier-B fixture; key-set integrity verified (0 keys dropped/added); `agent/verify/assertions.json` deliberately NOT redacted (it is the live verifier's fixture — redacting it would fake-fail honest verification).
4. **Anchor hash-only audit** — no code change needed: every anchor payload already carries hash+timestamp+version only. `saos-git-custody-v1` (steem engine + t38) = `{branch, tip, at, src, fp}`; `saos.weave.core.v1` (Zip weave-anchor, run by Domain weave-anchor-lines) = checkpoint index + Merkle root + headHash + commit + attestation counts + `at`. Daily @headcorner transparency posts are keyless real numbers (tier A) and were content-audited clean by 9-a.
5. **Email hygiene** — 0 workflows in any local clone configure a gmail `user.email` (all bots are `noreply.github.com` / `saos.local` placeholders); nothing to fix, count recorded. The ~2,465 historical gmail-author commits (7-b) stand — history rewrite is forbidden; future commits are noreply.
6. **FleetHQ quick pass** — verified clean: 0 workflows, 0 Hebrew, 0 personal addresses, 0 roster tables; receipts are machine lineage/boot telemetry. No change.

## Before → after, per 7-b tier

| Tier | Exposure item | Before (7-b audit) | After (this lane) | Residual |
|---|---|---|---|---|
| **A** public-by-design | Keyless proofs, chain data, digests, counts, deposit receive addrs, daily transparency posts | Public, correct | **Preserved** — redaction keeps tier-A (verified: digests/deposits/counts survive every pass) | none new |
| **B** internal | Ops-playbook Hebrew comments in YAML | 55 Domain + 17 Console files carried full playbook, secret custody map, schedule rationale | **Removed** at HEAD (165+ lines Console; batches Domain) | git history retains originals; 3 Domain workflows keep Hebrew runtime echo strings (log-only) |
| **B** | Full cron/schedule map (fixed minutes + rationale) | Predictable schedules, rationale inline (`:41/:07/03:43/13:55/02:01`…) | Minutes randomized minute-only, rationale deleted, chains order-consistent | Minute values still readable in repo (R6); exact-minute predictability of the *pattern* gone |
| **B** | Telemetry with strategy params + roster + personal addresses (world/grid/portfolio/deposits/receipts) | `commitPct 0.9/200/50bps`, fee-law formula, roster tables, `TG6Srs…`, `TYVwwu…ZxTy` served live from Pages/raw HEAD | **Masked/banded at HEAD + every future write** (Domain 32 files, Console 8 files incl. r35) | History retains originals (R2); `assertions.json`/content-review reports untouched by design |
| **B** | `key-check.json` roster/key-role matrix, `r35-full-cycle.json`, `grid-policy.json` | key-check takedown'd (prior lane); r35 live with full custody address; grid-policy params in dex/grid.json | r35 masked at HEAD; grid.json params banded | originals in history (R2) |
| **B** | Anchor payloads | (7-b feared strategy text on-chain) | **Audit: already hash+timestamp+version only** — no change needed | historical posts permanent (R5) |
| **C** secret | R11 vault + passphrase in public history of 5 repos | CRITICAL | **Unchanged — owner-blocked** (rotation is the only fix; no history rewrite, no .gitleaksignore edits in this lane) | **R1 CRITICAL — still the #1 risk** |
| **C** | Secret-name map in YAML | Secret names + vault custody narrative in comments | Map/narrative comments removed; live `env:` secret references kept to avoid breaking Actions pairing | exact names enumerable from workflows (R4 — owner renames secret + workflow together) |
| **C** | gmail commit identity | ~2,465 historical gmail-author commits | future commits noreply (bots verified); 0 gmail in workflows | history stands (owner lane) |

## Bottom line

Tier-A surface: intact and now provably the only thing write-paths emit. Tier-B surface: stripped from every HEAD file, schedule and comment of Domain + Console; the live Pages/raw exposure is closed for strategy params, rosters and personal addresses, and future commits are redacted at write time. Tier-C: untouched by law (owner-blocked rotation, history, secret names). The fleet's public face now shows **what the machine measured — not how to aim at it.**

## Verification shortcuts for the next reader

```
git -C Domain show 010550d --stat        # one-time redact pass (32 files)
git -C Console show 902cef9b --stat      # one-time redact pass (8 files, r35 included)
git -C Console show d99c36ad aa626094    # Console yaml hygiene batches ca/cb
git -C Domain log --oneline b343ac6..ddaed00   # Domain yaml batches aa..ad
node agents/redact-telemetry.mjs <file>  # idempotent; fails closed on bad json
```
