# fleet-rotation (T-67) — phase A

**Owner directive** (trace 1a12fa8a24c05655, 2026-10-12): "no keys in public, nothing, no
exposed secrets that would let them breach us; examine everything and optimize; broad execution."

## The measured wall (zero-trust, re-measured tonight)

- census-v2 receipts (2026-10-12T02:33–03:18Z, verify-only): **10 steem army accounts carry
  FULL LIVE QUADS derivable from vault material that was publicly recoverable since
  2026-09-12** (R11 ALIVE-ALERT), plus 3 hcsoldier active+posting and **9 hive
  active+posting** (fork-era keys).
- Everything exposed that is NOT owner authority gets rotated in **phase A** (this lane).
- **Owner authorities stay untouched in phase A** → the old owner WIF remains a valid
  recovery path for every account. Phase B (owner rotation) = separate explicit dispatch
  after phase A receipts verify.

## The roster (cap; runtime matches are the go)

| chain | accounts | rotated roles | signer |
|---|---|---|---|
| steem | cashmachine haran israelnews lsa macrame siq tov wic wog woq | active, posting, memo | matched **owner** WIF |
| steem | hcsoldier4 hcsoldier5 hcsoldier6 | active, posting | matched **active** WIF |
| hive  | cashmachine haran israelnews lsa macrame siq wic wog woq | active, posting | matched **active** WIF |

headcorner / cornerstone posting are NOT touched in phase A (live lanes depend on them;
posting-only exposure is reputational, not financial). blurt out of scope tonight.

## Laws (all enforced in-code, measured, not claimed)

1. **byte-law**: `condenser_api.get_transaction_hex` must equal local serialization
   (rot3-broadcast.mjs proven path) — else the account is skipped honestly.
2. **consensus digest**: `sha256(chainId || serialized-minus-tx-level-ext-byte)` (node-oracle 2026-10-08).
3. **self-verified signatures** before any broadcast.
4. **chain-judge pre**: a matched WIF must reproduce the LIVE on-chain authority, else skip.
5. **chain-judge post**: RPC authority must equal the new pubkey, else `ROTATED-VERIFY-PENDING`.
6. **incremental custody**: per account, the new material is sealed-PUT into
   `ROT2_FLEET_KEYS` on steem + saos-runtime + Domain BEFORE the next account is touched.
7. **seal + meta v4**: all new keys re-sealed as `KEYS-ROT2-<date>.zip.enc` under the
   gen2-era pass, `recovery-meta.json` v4 repointed (inner sha pinned) and pushed to the
   private vault home — custody consumers (census, arming, social) resolve the NEW keys
   automatically on their next run.
8. **public receipt**: fingerprints only. Zero material in logs, receipts, or this repo.

## Recoverability

- Phase A leaves owner authorities valid → owner can always reset active/posting/memo.
- Old WIFs remain sealed in the historical archives (git history) — deprecated, not deleted.
- New material: 3× repo secrets (incremental) + ROT2 archive in the private vault home.

## Phase B (pending owner wake / explicit dispatch)

Rotate the OWNER authorities of the 10 quads accounts (owner-signed, the R245/R255 proven
path), then re-run census verify-only to prove the old pubs are dead chain-wide.
