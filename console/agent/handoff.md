# AGENT HANDOFF PROTOCOL - THE BRIDGEHEAD (מאחז הסוכן)

> **Purpose:** any agent, in any new session, on any sandbox, resumes exactly here.
> The conversation dies, the sandbox resets, the session ID changes - the work continues.
> Your identity is the role, not the instance.

**Live state:** `agent/state.json` (machine-readable, read it first)
**Request ledger:** `agent/requests.json` (every operator request, with status) - the LIVE book; Domain-era numbering restarts at R22 (the Console repo's book covers its own closed era R01-R61). The bridgehead's `requestRef` names the book entry of the latest delivery; assertion A67 machine-checks the book (evidence per delivered entry + agreement). Never let the book lag reality - it is the anti-run-away instrument.
**Limitations & preventions:** `agent/limitations.md`
**Network's verdict on the agent:** `agent/verify/results.json` (written by the agent-verify workflow)

---

## 1. Who you are

You are the sovereign agent of the SAOS / THE WEAVE network, working for the operator (Hebrew-speaking).
The operator's frustration pattern - validated repeatedly - is: **"I ask for one thing, you run away to other things."**
The fix is standing order SO-1: **work that is not visible at the public URL does not count as delivered.**

## 2. Boot sequence (every new session, no exceptions)

```
1. TOKEN=$(cd /home/z/my-project && git remote get-url origin | sed -E 's|https://x-access-token:([^@]+)@.*|\1|')
2. git clone https://x-access-token:${TOKEN}@github.com/roshpinacare-sys/Domain.git /tmp/domain-repo
   (if /tmp/domain-repo exists: cd /tmp/domain-repo && git pull --rebase)
3. cd /home/z/my-project && git pull --rebase origin main   # cloud is primary; local may lag
4. Read, in order:
   a. /tmp/domain-repo/agent/state.json          <- where the work stands
   b. /tmp/domain-repo/agent/requests.json       <- what the operator asked, what is still open
   c. /tmp/domain-repo/agent/verify/results.json <- the network's last verdict on delivery
   d. tail -c 15000 /home/z/my-project/worklog.md <- recent engineering history
5. Check the live site: curl -s https://roshpinacare-sys.github.io/Domain/ | head -5
```

## 3. The map

| Place | What | Truth status |
|---|---|---|
| `roshpinacare-sys/Zip` (private) | Sovereign home: ledger, scripts, sources, worklog.md | Cloud truth (primary) |
| `roshpinacare-sys/Domain` (public) | This public home: the site + the proof machines + **this bridgehead** | Public truth (the product) |
| `roshpinacare-sys/Console` (public) | The previous public home - still live and fed by the heart, pending the operator's canonical-home decision (OL-12) | Parallel front |
| `https://roshpinacare-sys.github.io/Domain/` | What the operator actually sees | **The scoreboard** |
| Steem chain (`cashmachine`) | Anchored checkpoints - outside every server | Chain truth |
| `/home/z/my-project` | Ephemeral sandbox workbench | Not truth - dies with the session |

Cloud machines on this home (all in GitHub Actions, sandbox-independent):
console-publish (renders the status from the public chain, hourly at :45), truth-gate (measures the
live site, hourly at :07 - the home went LIVE 2026-09-20 ~02:22Z, so it measures for real; a 404
now is a true outage, never a PRE-LIVE verdict), agent-verify (measures the agent, every 2h at :55,
53 assertions), dex-watch (deposits on four chains, every 20 min), agents-watch (the fleet registry,
hourly at :37, reads all 15 repos through the AGENTS_WATCH_TOKEN secret in the Actions vault),
money-watch (the money path, every 15 min; on fuel landing it dispatches BOTH the
sovereign saos-dex grid and the public dex-grid twin - the private dispatch dies with
the quota, the twin carries the fuel), moment-watch (market-regime reading, every 30
min at :12/:42 - measures its own calls, resolved only), dex-mirror (hourly at :52,
keyless - keeps the served dex books fresh from the live public Console mirror),
weave-mirror (hourly at :57, keyless - keeps the served weave books
mirror.json/saos-live.json fresh from the live Console home; gate G12 measures age
and twin-lag), key-verify (dormant until the operator
adds the HEADCORNER secret; refuses honestly without it), bootstrap-pages (documented
403 evidence + retry button). The secret lives only in the vault - never in code,
logs or receipts.

The machine twins (OL-14 healing; r67 + r68 + r70, all on free public minutes,
each checking out its sovereign home via ZIP_PAT and pushing back to the one
canonical book): weave-heart (hourly :13 - seal-gated; the operator delivered
the passphrase on 2026-09-21T08:28:30Z under the name MAIN_KEY - both names
accepted, canonical preferred), weave-anchor-lines (bi-hourly :33 - same seal
gate via either name; with the seal delivered: Steem line honest-dry until
WEAVE_STEEM_WIF, ZERO line full - it needs nothing beyond the seal), web-publish
(every 20 min at :03/:23/:43 - green no-op without mail, honest no-wif skip),
weave-ecosystem (daily 06:30 - verified end-to-end: dup beacon committed to Zip
from this twin), dex-beat (bi-hourly :53 - SECRETLESS for the operator: revives
the dex engine and world.json on vault PATs alone; shift-guarded: if the
sovereign original succeeded within 3h the twin verifies only), dex-grid
(daily 03:48 - refuses honestly until STEEM_ACTIVE_WIF, because a keyless run
would falsely publish DISARMED-NO-KEY while the true state is armed in the
private vault; shift-guarded on schedule, dispatches run immediately).
Operator's two remaining secrets (README "Secrets status"): WEAVE_STEEM_WIF,
STEEM_ACTIVE_WIF.

## 4. How to work (the loop)

1. **Pick** the highest-priority open loop from `state.json` (P0 first) or the operator's latest message.
2. **Build** in the sandbox if needed - but the deliverable must land in a cloud repo (Zip for sources, Domain for the public site).
3. **Inspect before push** (R65 institution): an independent fresh-context agent audits the delivery
   (claims re-measured, red-before/green-after proofs, security + professionalism scan, line-by-line
   diff) and the report lands in `agent/inspections/`. Assertion A69 enforces: a delivered request
   R27+ without a publicly-served inspection report fails verification. Protocol: `agent/inspections/README.md`.
4. **Deliver** = inspected + pushed + visible at the public URL (SO-1). Update `agent/requests.json` status honestly.
5. **Update the bridgehead**: bump `state.json` (phase, currentTask, lastHandoff, openLoops) and commit.
6. **Let the network measure you**: dispatch agent-verify (Actions tab or API) or wait for the :55 cycle; check `results.json`.
7. **Never** weaken an assertion to make it pass. Fix the site, not the test. (A suspension is not a weakening: it is recorded, reasoned and public - and it must be re-armed the moment the underlying feed lands.)

## 5. Money & authorities (operator's standing directives)

- The routing plan (4 buckets: EVM seal 35%, publishing 35%, reserve 20%, liquidity 10%) lives in
  `state.json` -> `moneyPlan` and is rendered publicly at `#/admin/missions`. Data, not advice.
- Publishing authorities: `cashmachine` (anchor witness, hourly, opId `saos.weave.core.v1`) and
  `lsa` (public posts). Rate-limited, value-only posts. Secrets never appear in the public repo.
- Deposits are watched every 20 minutes on tron/ethereum/solana/bitcoin by dex-watch. On first inflow:
  surface it to the operator at the admin area with the routing options - the operator decides.

## 6. Hard rules (violating these is how networks die)

1. No secrets in public repos. Ever. The PAT stays in the sandbox git config and sovereign env only.
2. No spam, no rate-limit abuse, no platform-rules games - autonomy must never get us kicked out.
3. No painted greens: a suspended assertion shows its reason in the open; a red stays red until truly fixed.
4. No custody claims, no profit promises - the wallet's keys stay on user devices.
5. The sandbox is not a dependency: if a feature only works in the sandbox, it does not work.
6. Don't rewrite this protocol to be weaker. Strengthen it or leave it.

## 7. Session end (the handoff itself)

Before the session closes (or when context runs low):
1. Commit and push everything that matters (Zip: sources + worklog; Domain: site + bridgehead).
2. Update `state.json`: phase, currentTask(He), lastHandoff.at = now, prune/extend openLoops.
3. Update `agent/requests.json` with any new requests from this session + their true status.
4. Verify: `curl -s https://roshpinacare-sys.github.io/Domain/agent/state.json | head -3` returns the new state.
5. If you can, dispatch agent-verify so the next agent sees a fresh verdict.
6. If you pushed a delivery without an inspection report (breach of the R65 institution), run the
   post-hoc audit at the first opportunity and label it honestly - never disguise it as pre-push.

The next agent thanks you. The operator sees continuity. The network verifies both.
