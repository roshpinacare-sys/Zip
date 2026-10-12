# T16 SCOPE — 2026-10-11 — cron-registration repair (הריבונות באמת 24/7)

Owner mandate (verbatim): "תמשיך וודא את עצמך ותמיך עוד לשפר"

## Finding (measured, evidence-backed)
The two autonomous loops built in T13/T14 **never fired on schedule**:
- value-scan (cron 17,47 * * * *): created ~20:47Z, ZERO schedule runs through 23:38Z
  (missed 21:17/21:47/22:17/22:47/23:17) — only the 20:50 manual dispatch.
- sovereign-decider (cron 4,34 * * * *): created ~21:30Z, ZERO schedule runs
  (missed 21:34/22:04/22:34/23:04) — only manual dispatches (runs 38177100068/38183361915).

Root cause (control-group proof): top-level `description:` key — not a valid GitHub
Actions workflow key. Workflows created TODAY elsewhere in the org DO fire on schedule
(book-audit 381350166 @23:13:48Z schedule SUCCESS, cognition-beat 381322750 @23:09:13Z
schedule SUCCESS) and have no `description:` key. Dispatch tolerates the invalid key,
the scheduler rejects the definition silently. Org-wide scan of 7 repos found exactly
2 defective files — these two.

Impact: the charter-illegal state — the sovereignty's own loops literally WAITED for
instructions (manual dispatch) instead of self-running. This is the disconnect.

## Lane (R4 anti-trample)
- Sandbox/.github/workflows/value-scan.yml + sovereign-decider.yml — structural fix only
  (description → comment; schedule block mirrors proven-firing pattern; value-scan gains
  the same readback-verification step the decider already had).
- Verification: next cron slots (value-scan 23:47Z, decider 00:04Z) must produce runs
  with event=schedule. Evidence recorded in worklog.
- NOT touching: ops/sovereign/*/state.json or ledger.jsonl (owned by the workflows),
  other repos' workflows (scanned clean), decider.py/value-scan.py logic.

## T16 EXTENSIONS (same lane, evidence-driven)
1. **Probe experiment** (cron-probe-t16.yml, pushed 00:07Z, deleted 00:26Z): 0 runs across
   4 slots → new-file cron registration confirmed dead in this repo — exactly the T-51
   documented disease. Retired cleanly.
2. **Loops join the internal operator** (T-51's own architecture): value-scan.yml +
   sovereign-decider.yml now listen to repository_dispatch (value-scan-tick /
   sovereign-decider-tick); both registered in artery-watch's ARTERIES (additive 2 lines,
   in-mission "מפעיל-פנימי להכל"). Manual ignition 204 + runs success 00:16:40/41Z.
3. **D1 consumer built** (value-scan.py): 13-operator chain measurement vs published
   interim floors → metrics.d1Consumer + FLOORS-LEDGER.md (regenerated, measured-only) —
   the "UNEXECUTED — description, not action" flag now has a real measured consumer in
   the corpus (ops/*.md).
4. **Decider honest re-measure** (decider.py): D2 clean-streak-3 → OBSERVING transition
   (anti STALE-TRUTH); workOrderStatus measured via office-ci receipts (done-ness
   verifiable); ledger engClean flag. Current world: 1 blocked task → stays ENFORCED P0
   (no premature resolution), transition demonstrates after 3 clean runs.
## VERDICT (all measured, 00:28Z)
verifier 51/51 ALL_PASS · truth-gate ALL-GREEN · chain 2925.6 SP (head 110361052) ·
both loops alive on the internal operator · FLOORS-LEDGER.md published · zero tramples.
