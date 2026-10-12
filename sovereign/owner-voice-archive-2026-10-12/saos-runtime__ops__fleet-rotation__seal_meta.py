#!/usr/bin/env python3
"""Seal the ROT2 archive + write recovery-meta v4 (T-67 phase A).
Inputs: /tmp/rot-result.json (contains material), GEN2ZIP env (seal pass).
Outputs: steem-engine/agent/vault/KEYS-ROT2-<ts>.zip.enc + agent/recovery-meta.json v4.
Prints fingerprints/shas only — zero material to logs. Plaintext shredded."""
import json, os, subprocess, hashlib, time

STEEM = os.environ.get("ROT_STEEM_DIR", "steem-engine")
RESULT = "/tmp/rot-result.json"
GEN2ZIP = os.environ.get("GEN2ZIP")
if not GEN2ZIP:
    print("ABORT: GEN2ZIP absent")
    raise SystemExit(1)

rot = json.load(open(RESULT))
rotated = [a for a in rot.get("accounts", []) if str(a.get("verdict", "")).startswith("ROTATED")]
if not rotated:
    print("ABORT: nothing rotated — no seal")
    raise SystemExit(1)

# 1) material bundle (plaintext, /tmp only)
material = {"format": "saos-rot2-keys/1", "at": rot.get("at"), "accounts": {}}
for a in rotated:
    material["accounts"].setdefault(a["chain"], {})[a["account"]] = a["material"]
plain = "/tmp/rot2-keys.json"
json.dump(material, open(plain, "w"))

# 2) zip + seal (house formula: aes-256-cbc pbkdf2 iter 300000)
ts = time.strftime("%Y-%m-%d", time.gmtime())
inner = "/tmp/rot2-keys.zip"
outname = f"KEYS-ROT2-{ts}.zip.enc"
outfile = os.path.join(STEEM, "agent", "vault", outname)
if os.path.exists(inner):
    os.remove(inner)
subprocess.run(["zip", "-j", "-q", inner, plain], check=True)
inner_sha = hashlib.sha256(open(inner, "rb").read()).hexdigest()
subprocess.run(["openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
                "-in", inner, "-out", outfile, "-pass", "env:GEN2ZIP"], check=True)
outer_sha = hashlib.sha256(open(outfile, "rb").read()).hexdigest()

# 3) roundtrip proof
rt = "/tmp/rot2-rt.zip"
subprocess.run(["openssl", "enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "300000",
                "-in", outfile, "-out", rt, "-pass", "env:GEN2ZIP"], check=True)
rt_sha = hashlib.sha256(open(rt, "rb").read()).hexdigest()
if rt_sha != inner_sha:
    print("ABORT: roundtrip mismatch")
    raise SystemExit(1)

# 4) meta v4 (repo-side system custody doctrine: pass VALUE lives in private meta)
meta_path = os.path.join(STEEM, "agent", "recovery-meta.json")
meta = json.load(open(meta_path))
roster = []
for a in rotated:
    roster.append({"chain": a["chain"], "account": a["account"], "roles": sorted(a["material"].keys())})
v4 = dict(meta)
v4.update({
    "keysZipPass": GEN2ZIP,
    "keysZipFile": "agent/vault/" + outname,
    "keysZipSha256": outer_sha,
    "keysZipInnerSha256": inner_sha,
    "rot2": {
        "id": "ROT2-PHASE-A-" + ts,
        "at": rot.get("at"),
        "sealedFor": "fleet-rotation-a (T-67, owner trace 1a12fa8a24c05655)",
        "roster": roster,
        "ownerAuthorities": "UNTOUCHED in phase A (recovery window; phase B = separate explicit dispatch)",
        "note": "supersedes prior keysZip for LIVE use: prior archives stay in git history for archaeology",
    },
    "sealedAt": rot.get("at"),
    "format": "recovery-meta-4",
})
json.dump(v4, open(meta_path, "w"), indent=2)
open(meta_path, "a").write("\n")

# 5) shred plaintext
for f in (plain, inner, rt):
    try:
        with open(f, "r+b") as fh:
            fh.write(os.urandom(os.path.getsize(f)))
        os.remove(f)
    except OSError:
        pass

print(json.dumps({
    "sealed": outname,
    "innerSha": inner_sha[:16],
    "outerSha": outer_sha[:16],
    "roundtrip": "MATCH",
    "accounts": len(roster),
    "meta": "v4",
}))
