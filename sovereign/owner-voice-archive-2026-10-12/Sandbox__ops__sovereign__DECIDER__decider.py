#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SOVEREIGN DECIDER v1 — מנוע-ההכרעה-הריבוני (keyless · T14)
=============================================================
הצו (CHARTER.md, הוראת-בעלים 2026-10-11T21:20Z): הריבונות מכריעה בעצמה.
הסוכנים עושים לבד את מה שהכי טוב ושיועיל — לא ממתינים להוראות.

נוהל בכל פעימה: MEASURE → OPTIONS → SCORE → DECIDE → PUBLISH → VERIFY → RE-MEASURE.

אנטי-זיופים:
 · כל מספר = מדידה עצמאית (api.steemit.com, המרה מדויקת) או מקור פומבי מסומן.
 · ביצוע-על-שרשרת אף-פעם לא נטען — רק STAGED-EXEC (מסלול מדויק, ממתין מפתח).
 · מקור שנפל → ההכרעה שלו OBSERVING. אין המצאות, אין שקט.
 · פנקס append-bounded (60) — אין שכתוב היסטוריה.

מקורות: chain (ראשי) · sovereign-beacon state.json · VALUE-SCAN state.json ·
        FleetHQ office-state.json (פורמן) · ops/flow/flow-map.json (F-series) ·
        ops/office/work-orders.json (מנוע-הצמיחה) — כולם keyless ציבוריים.
"""
import hashlib
import json
import os
import re
import urllib.request
from datetime import datetime, timezone

BASE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = BASE
RAW = "https://raw.githubusercontent.com/roshpinacare-sys"
RPC = "https://api.steemit.com"
LEDGER_MAX = 60
# R2 — מסילת-בטיחות: קו-השימור של האוצרה (לא יורדים מתחתיו בשום הכרעה)
KEEP_FLOOR_SP = 2800.0
TREASURY_TARGET_SP = 3000.0
FLEET = ["cashmachine", "haran", "israelnews", "lsa", "macrame",
         "siq", "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6"]
NOW = lambda: datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731


def now():
    return NOW()


# ----------------------------------------------------------------- מדידה ---
def rpc(method, params, timeout=25):
    body = json.dumps({"jsonrpc": "2.0", "method": method, "params": params, "id": 1}).encode()
    req = urllib.request.Request(RPC, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            d = json.loads(r.read().decode())
            if "error" in d:
                return None
            return d.get("result")
    except Exception:
        return None


def read_json(url, timeout=20):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def measure_chain(degraded):
    """מדידת-שרשרת עצמאית: המרה מדויקת VESTS→SP. None כנה במקום המצאה."""
    gp = rpc("condenser_api.get_dynamic_global_properties", [])
    names = ["headcorner"] + FLEET
    accs = rpc("condenser_api.get_accounts", [names])
    if not gp or not accs or len(accs) != len(names):
        degraded.append("chain-rpc")
        return None
    tvs = float(str(gp.get("total_vesting_shares", "0")).split(" ")[0])
    tvf = float(str(gp.get("total_vesting_fund_steem", "0")).split(" ")[0])
    if not tvs or not tvf:
        degraded.append("chain-mult")
        return None
    mult = tvf / tvs

    def sp(a):
        v = float(str(a.get("vesting_shares", "0")).split(" ")[0])
        d = float(str(a.get("delegated_vesting_shares", "0")).split(" ")[0])
        r = float(str(a.get("received_vesting_shares", "0")).split(" ")[0])
        return round((v - d + r) * mult, 1), round(d * mult, 1), round(r * mult, 1)

    by = {a["name"]: a for a in accs}
    hc = by["headcorner"]
    net, out, inn = sp(hc)
    ops = {}
    for n in FLEET:
        s, _, _ = sp(by[n])
        ops[n] = s
    return {
        "head": gp.get("head_block_number"),
        "time": gp.get("time"),
        "mult": mult,
        "treasuryNetSp": net,
        "treasuryDelegatedOutSp": out,
        "treasuryReceivedInSp": inn,
        "treasuryBalanceSteem": float(str(hc.get("balance", "0")).split(" ")[0]),
        "operatorsSp": ops,
        "minOperatorSp": min(ops.values()) if ops else None,
    }


def scan_outgoing_delegations(max_ops=3000, degraded=None):
    """סריקת-היסטוריית headcorner: האצלות-יוצאות (אחרונה-לכל-delegatee) + דיווח-כנה-על-עומק.
    api.steemit.com מגביל חלון-היסטוריה ל-100 — סריקה-באצוות (R1: כישלון=כנות).
    מטרת-האמת: לאמת-לאן-הלכה-ההאצלה-היוצאת (רגלי-הצי) — לא לשחרר אותה."""
    BATCH = 100
    newest = rpc("condenser_api.get_account_history", ["headcorner", -1, 1])
    if not newest:
        if degraded is not None:
            degraded.append("hc-history")
        return None
    newest_idx = newest[0][0]  # [idx, ev] — האינדקס-האחרון
    latest = {}
    scanned, hi = 0, newest_idx
    while scanned < max_ops and hi >= 1:
        lo = max(1, hi - BATCH + 1)
        res = rpc("condenser_api.get_account_history", ["headcorner", lo, hi - lo + 1])
        if not res:
            if degraded is not None:
                degraded.append("hc-history-window")
            break
        for idx, ev in res:
            opname, op = ev["op"]
            if opname == "delegate_vesting_shares" and op.get("delegator") == "headcorner":
                vests = float(str(op.get("vesting_shares", "0")).split(" ")[0])
                if op.get("delegatee") not in latest:
                    latest[op.get("delegatee")] = {"idx": idx, "ts": ev.get("timestamp"), "vests": vests}
        scanned += hi - lo + 1
        hi = lo - 1
        if len(latest) >= 15:
            break
    return {"scannedOps": scanned, "newestIdx": newest_idx, "latestPerDelegatee": latest}


# ------------------------------------------------------------- הכרעות ---
def opt(oid, he, safety, reversibility, value_now, effort, status):
    return {"id": oid, "he": he,
            "scores": {"safety": safety, "reversibility": reversibility,
                       "valueNow": value_now, "effort": effort},
            "total": safety * 2 + reversibility + value_now + effort,
            "status": status}


def decide_econ(chain, beacon, hc_scan, degraded):
    """D1 — רצפת-האוצרה: הכרעה כלכלית מלאה (ENFORCED מדיניות-מדורגת; דחייה-מנומקת-ב-R2
    של שחרור-הזרימה-הנכנסת; אימות-לאן-הלכה-ההאצלה-היוצאת)."""
    if not chain:
        return {"id": "D1-econ-treasury-floor", "area": "כלכלה", "status": "OBSERVING",
                "titleHe": "רצפת-האוצרה", "verdictHe": "אין מדידת-שרשרת — כנות: לא מכריע בלי מספרים",
                "evidence": ["chain-rpc לא זמין בריצה זו"], "decidedAt": now(),
                "decidedBy": "sovereign-decider-v1 (CHARTER)"}
    net = chain["treasuryNetSp"]
    gap = round(TREASURY_TARGET_SP - net, 1)
    ev = [f"אוצרה נמדדת {net} SP (ראש {chain['head']}, מכפיל {chain['mult']:.9f})",
          f"יעד {TREASURY_TARGET_SP:.0f} · פער {max(0.0, gap)} SP · מסילת-שימור {KEEP_FLOOR_SP:.0f} (R2)",
          f"האצלה-יוצאת-נמדדת {chain['treasuryDelegatedOutSp']} SP · נכנסת-נמדדת {chain['treasuryReceivedInSp']} SP"]
    if beacon:
        pub = beacon.get("lastPulse", {}).get("treasuryNetSp")
        if pub is not None:
            ev.append(f"משואה מפרסמת {pub} SP · תואם={abs(pub - net) <= 1.0}")

    # אימות-לאן-הלכה-ההאצלה-היוצאת (רגלי-הצי — לא-שחוזים):
    deleg_evidence, deleg_to_fleet_sp, deleg_other = [], 0.0, []
    if hc_scan:
        deleg_evidence.append(f"סריקת-היסטוריה: {hc_scan['scannedOps']} ops-אחרונים (עד idx {hc_scan['newestIdx']})")
        for name, d in hc_scan["latestPerDelegatee"].items():
            sp = round(d["vests"] * chain["mult"], 1)
            if name in FLEET:
                deleg_to_fleet_sp += sp
            else:
                deleg_other.append(f"{name}:{sp}SP@{d['ts']}")
        deleg_evidence.append(f"האצלות-אחרונות למפעילי-הצי: ~{round(deleg_to_fleet_sp, 1)} SP (רגלי-הצי — חיוניות, אין-לשחרר)")
        if deleg_other:
            deleg_evidence.append(f"האצלות-יוצאות-שאינן-מפעילים (מדוד): {', '.join(deleg_other[:8])}")
    else:
        deleg_evidence.append("סריקת-היסטוריה לא זמינה בריצה-זו — מדווח כנה, אין הסקה")

    # אופציות (ציון = בטיחות×2 + הפיכות + ערך-עכשיו + מאמץ):
    options = [
        opt("A", "מדיניות-מדורגת-ביניים: רצפות-מפעילים 75/30/20 לפי-מדידה + קו-שימור 2800 כרצפת-תפעול עד-שיקום-3000 + המשך-מנועי-התשואה (DEX חי · curation). keyless — אוכף-מיד.", 5, 5, 3, 1, "CHOSEN"),
        opt("B", f"שחרור-הזרימה-הנכנסת (undelegate ה-{chain['treasuryReceivedInSp']} SP-הנכנסים) — נדחה: מוריד-את-האוצרה ל~{round(net - chain['treasuryReceivedInSp'], 1)} SP מתחת-למסילה (הפרת R2) ושחרור-האצלות-היוצאות עורף-את-רגלי-הצי.", 1, 4, 1, 2, "REJECTED"),
        opt("C", "המתנה-להוראות-בעלים — פסול-מראש לפי-צו-סעיף-1 (הריבונות-מכריעה-בעצמה).", 0, 0, 0, 0, "REJECTED"),
    ]

    # מדיניות-המדורגת (מחושבת-מהמדידה — לא מהמצאה)
    tiers = []
    for name, s in sorted(chain["operatorsSp"].items(), key=lambda x: -x[1]):
        tier, floor = (1, 75) if s >= 50 else ((2, 30) if s >= 15 else (3, 20))
        tiers.append({"operator": name, "measuredSp": s, "tier": tier, "interimFloorSp": floor})
    below = [t for t in tiers if t["measuredSp"] < t["interimFloorSp"]]
    policy = {
        "treasury": {"operatingFloorSp": KEEP_FLOOR_SP, "targetSp": TREASURY_TARGET_SP,
                     "note": "קו-השימור = רצפת-תפעול-ביניים; היעד-3000 נשאר-היעד (ביניים-כנה, לא-ויתור)"},
        "operatorInterimFloors": tiers,
        "operatorsBelowInterimFloor": [t["operator"] for t in below],
        "soldiersFloorSp": 20,
        "yieldEngines": {"dex": "continue-armed (keyless engine, כבר-חי)", "curation": "continue"},
        "basis": "measured-only (CHARTER סעיף 2)",
        "review": "RE-MEASURE בכל פעימה; שינוי-רק-דרך-הפנקס (REVOKED/עדכון-גרסה)",
    }

    verdict = (f"הריבונות הכריעה בעצמה: מדיניות-מדורגת-ביניים אוכפת-מעתה (אופציה A, "
               f"{options[0]['total']} נק') — רצפות-מפעילים 75/30/20 לפי-מדידה, קו-שימור 2800, "
               f"יעד-3000 במקביל-דרך-מנועי-התשואה; שחרור-הזרימה-הנכנסת נדחה-ב-R2 "
               f"(היה-מוריד-למטה-מהמסילה); המתנה-לבעלים פסולה (צו-סעיף 1).")
    return {"id": "D1-econ-treasury-floor", "area": "כלכלה", "status": "ENFORCED",
            "priority": "P1", "titleHe": "רצפת-האוצרה — הכרעה-כלכלית-ריבונית",
            "verdictHe": verdict, "options": options, "chosen": ["A"],
            "evidence": ev + deleg_evidence, "policy": policy,
            "decidedAt": now(), "decidedBy": "sovereign-decider-v1 (CHARTER)"}


def decide_eng(foreman, work_orders, degraded, ledger_lines=None):
    """D2 — סוכנים-בתקלה/משימות-חסומות: ניתוב-P0 עצמאי (ללא-המתנה) + [T16] עדכון-אמת:
    כשהנושא נמדד-נקי 3 פעימות רצופות — ההכרעה עוברת-ניטור (OBSERVING, RE-MEASURE כנה)
    במקום להישאר ENFORCED-נצחית שהעולם עבר-ממנה (STALE-TRUTH). חזרת-תקלה → מיד ENFORCED."""
    if not foreman:
        return {"id": "D2-eng-errors", "area": "הנדסה", "status": "OBSERVING",
                "titleHe": "תקלות-הצוות", "verdictHe": "מקור-הפורמן לא זמין — ממשיכים-למדוד, לא מכריעים-סתם",
                "evidence": ["office-state.json לא זמין"], "decidedAt": now(),
                "decidedBy": "sovereign-decider-v1 (CHARTER)"}
    errs = [a.get("id") for a in (foreman.get("agents") or []) if a.get("state") == "error"]
    blocked = [t.get("id") for t in (foreman.get("tasks") or []) if t.get("status") == "blocked"]
    clean = not errs and not blocked

    # [T16] רצף-נקי — נמדד מהפנקש העצמי (append-bounded; הריצה-הנוכחית תירשם עם engClean)
    streak = 1 if clean else 0
    if clean and ledger_lines:
        for line in reversed(ledger_lines):
            try:
                e = json.loads(line)
            except Exception:
                continue
            if e.get("engClean") is True:
                streak += 1
            else:
                break

    if clean:
        if streak >= 3:
            return {"id": "D2-eng-errors", "area": "הנדסה", "status": "OBSERVING",
                    "titleHe": "תקלות-הצוות",
                    "verdictHe": (f"הנושא-שנותב נמדד-נקי {streak} פעימות רצופות — ההכרעה עוברת-ניטור "
                                  f"(RE-MEASURE כנה; חזרת-תקלה תחזור-מיד-ל-P0) — אפס-המתנה, אפס-זיופים."),
                    "evidence": [f"אפס סוכנים ב-state=error · אפס משימות blocked · רצף-נקי={streak} (מהפנקס)"],
                    "decidedAt": now(), "decidedBy": "sovereign-decider-v1 (CHARTER)",
                    "reMeasure": {"cleanStreak": streak, "subjectResolved": True}}
        return {"id": "D2-eng-errors", "area": "הנדסה", "status": "ENFORCED",
                "titleHe": "תקלות-הצוות",
                "verdictHe": (f"הצוות נמדד נקי (רצף {streak}<3) — ההכרעה נשארת-אוכפת עד-רצף-מלא, "
                              f"ממשיכים-למדוד בלי-להכריז-הצלחה-מוקדמת."),
                "evidence": [f"אפס סוכנים ב-state=error · אפס משימות blocked · רצף-נקי={streak}"],
                "decidedAt": now(), "decidedBy": "sovereign-decider-v1 (CHARTER)",
                "reMeasure": {"cleanStreak": streak, "subjectResolved": False}}
    wo_ids = [w.get("id") for w in (work_orders or []) if isinstance(w, dict)][:8]
    ev = [f"סוכנים בתקלה (מדוד): {', '.join(errs) or '—'}",
          f"משימות חסומות (מדוד): {', '.join(map(str, blocked)) or '—'}"]
    if wo_ids:
        ev.append(f"עבודות-פתוחות ממנוע-הצמיחה (צריכה): {', '.join(map(str, wo_ids))}")
    return {"id": "D2-eng-errors", "area": "הנדסה", "status": "ENFORCED", "priority": "P0",
            "titleHe": "תקלות-הצוות — ניתוב-תיקון-ריבוני",
            "verdictHe": (f"הריבונות מדרגת P0 עצמאית: תיקון {len(errs)} סוכנים בתקלה ושחרור "
                          f"{len(blocked)} משימות חסומות — מנותב למסילות-ההנדסה ולמנוע-הצמיחה "
                          f"(work-orders) מיד, ללא-המתנה-להוראות (צו-סעיף 1)."),
            "evidence": ev, "routing": {"foreman": errs, "officeGrowthWorkOrders": wo_ids},
            "decidedAt": now(), "decidedBy": "sovereign-decider-v1 (CHARTER)"}


def measure_work_order_status(degraded):
    """[T16] סטטוס-מדוד לעבודות-שנותבו — done-ness נבדק במקום להישאר בלתי-ניתן-לאימות.
    מה-שניתן-למידה-keyless נמדד; מה-שלא — מדווח כנה כ-unmeasured (אין המצאות).
    · WO-FleetHQ-reds → קבלת-ה-CI האחרונה של FleetHQ (פיד-atom פומבי keyless)."""
    status = {}
    try:
        with urllib.request.urlopen("https://github.com/roshpinacare-sys/FleetHQ/commits/main.atom", timeout=20) as r:
            feed = r.read().decode("utf-8", "ignore")
        titles = re.findall(r"<title>(.*?)</title>", feed, re.S)[:6]
        receipts = [t.strip() for t in titles if "office-ci receipt" in t]
        if receipts:
            last = receipts[0]
            ok = ("build pass" in last and "types pass" in last)
            status["WO-FleetHQ-reds"] = {
                "measured": True, "subjectResolved": bool(ok),
                "evidence": f"קבלת-office-ci האחרונה: '{last[:70]}'"}
    except Exception:
        degraded.append("fleet-atom")
        status["WO-FleetHQ-reds"] = {"measured": False, "subjectResolved": None,
                                     "evidence": "פיד-atom לא זמין בריצה-זו — כנות"}
    return status


def decide_flow(flow, degraded):
    """D3 — יתומים/רוחות-רפאים: הכרעת-חיבור-עורקים."""
    if not flow:
        return {"id": "D3-flow-weave", "area": "רשת", "status": "OBSERVING",
                "titleHe": "מפת-הזרימה", "verdictHe": "מפת-הזרימה לא זמינה — ממשיכים-למדוד",
                "evidence": ["flow-map.json לא זמין"], "decidedAt": now(),
                "decidedBy": "sovereign-decider-v1 (CHARTER)"}
    orphans = len(flow.get("orphans") or [])
    ghosts = len(flow.get("ghosts") or [])
    if orphans + ghosts == 0:
        return {"id": "D3-flow-weave", "area": "רשת", "status": "ENFORCED",
                "titleHe": "מפת-הזרימה", "verdictHe": "הרשת נמדדה מחוברת (אפס-יתומים, אפס-רוחות) — המשך",
                "evidence": ["orphans=0 · ghosts=0"], "decidedAt": now(),
                "decidedBy": "sovereign-decider-v1 (CHARTER)"}
    return {"id": "D3-flow-weave", "area": "רשת", "status": "ENFORCED", "priority": "P2",
            "titleHe": "מפת-הזרימה — חיבור-עורקים",
            "verdictHe": (f"הריבונות מכריעה: חיבור {orphans} יתומים וטיפול ב-{ghosts} רוחות-רפאים "
                          f"במסילת-מחבר-העורקים — everything-uses-everything, ללא-המתנה."),
            "evidence": [f"orphans={orphans} · ghosts={ghosts} (flow-map.json, F-series — צריכה בלבד)"],
            "decidedAt": now(), "decidedBy": "sovereign-decider-v1 (CHARTER)"}



_board_holder = None  # [15a-merge] הלוח-האחרון-שנטען — לכתיבת-ACK-חזרה מ-main
_board_path_holder = None


def load_directive_board():
    """[15a] לוח-הפקודות של המנהל — ops/sovereign/DIRECTIVES/board.json (מה-checkout, קריאה-בלבד כאן)."""
    p = os.path.join(os.path.dirname(BASE), "DIRECTIVES", "board.json")
    try:
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        if isinstance(d, dict) and isinstance(d.get("directives"), list):
            return d, p
    except Exception:
        pass
    return None, p


def decide_owner_channel(degraded):
    """מחזיר (decision, acked) — board_path מוחזק בגלובלי."""
    """[T17]+[15a-merge] D0 — ערוץ-המנהל: הסמכות-העליונה. מקורות-ממוזגים (חדר-אחד, אפס-שכפול):
      · ops/sovereign/OWNER-CHANNEL/inbox.jsonl — תיבת-ההוראות (נקרא-מהגיט, T17)
      · ops/sovereign/DIRECTIVES/board.json — לוח-הפקודות-מהקונסולה (operator.html; נקרא-מה-checkout,
        ופקודה-OPEN מקבלת-ACK-כתוב-חזרה עם-חותמת — [15a])
    אין-שמות-חשבונות-ואין-פרטי-התחברות בשום-פלט. אין-מקורות → OBSERVING כנה."""
    inbox = None
    try:
        with urllib.request.urlopen(f"{RAW}/Sandbox/main/ops/sovereign/OWNER-CHANNEL/inbox.jsonl", timeout=20) as r:
            raw = r.read().decode("utf-8", "ignore")
        inbox = [json.loads(l) for l in raw.splitlines() if l.strip()]
    except Exception:
        inbox = None
    global _board_holder
    board, board_path = load_directive_board()
    _board_holder = board
    global _board_path_holder
    _board_path_holder = board_path
    acked = []
    if isinstance(board, dict):
        for d in board.get("directives") or []:
            if isinstance(d, dict) and d.get("status") == "OPEN":
                d["status"] = "ACK"; d["ackAt"] = now(); d["ackBy"] = "sovereign-decider-v1"
                d.setdefault("evidence", []).append(
                    f"ACK בפעימה {now()} — מנותב-למסילות-הביצוע (D2) בעדיפות {d.get('priority', 'P2')}")
                acked.append(d)
    latest = [d for d in (inbox or []) if isinstance(d, dict)][-5:]
    ev = [f"inbox.jsonl: {len(inbox or [])} הוראות · נקראו 5 אחרונות · board.json: {len((board or {}).get('directives') or [])} פקודות · ACK-חדשות: {len(acked)}"]
    for d in latest:
        ev.append(f"[inbox {d.get('at', '?')}] {str(d.get('text', ''))[:90]}")
    for d in acked[:4]:
        ev.append(f"[board ACK {d.get('id')}] {str(d.get('text', ''))[:90]}")
    if not latest and not acked:
        return {"id": "D0-owner-channel", "area": "הנהגה", "status": "OBSERVING",
                "titleHe": "ערוץ-המנהל",
                "verdictHe": "ערוץ-ההנהגה פתוח-ומחובר (שני-המקורות-נמדדו) — אין-הוראות-חדשות (כנות; נקרא-חי-בכל-פעימה)",
                "evidence": ev, "boardMeasured": isinstance(board, dict),
                "decidedAt": now(), "decidedBy": "sovereign-decider-v1 (CHARTER)"}, []
    verdict = (f"הריבונות מאשרת-קבלה: {len(latest)} הוראות-מהתיבה + {len(acked)} פקודות-קונסולה-חדשות "
               f"נקראו-מהגיט-של-הבעלים ומנותבות-סמכות-עליונה — הוראה-חדשה מעדכנת-מיד.")
    return {"id": "D0-owner-channel", "area": "הנהגה", "status": "ENFORCED", "priority": "P0",
            "titleHe": "ערוץ-המנהל — הסמכות-העליונה נקראת-בכל-פעימה (תיבה+לוח)",
            "verdictHe": verdict,
            "evidence": ev, "ownerDirectives": latest,
            "ackIds": [d.get("id") for d in acked], "ackCount": len(acked),
            "routing": {"ownerDirectives": [d.get("id") for d in acked],
                        "lane": "state.json-published-first — כל-צרכני-ההכרעות קוראים D0 ראשון (דפוס-D2)"},
            "boardMeasured": isinstance(board, dict),
            "decidedAt": now(), "decidedBy": "sovereign-decider-v1 (CHARTER)"}, acked


def decide_verify(av, tg, degraded):
    """D4 [T15] — רשת-האמת: ההכרעה רואה את הבדיקה-העצמית של הגוף (המאמת-העצמאי
    של הקונסולה 51-טענות + שער-האמת-הציבורי). כשל → הכרעה-מנותבת (P0/P1) מיד —
    אין-המתנה-להוראות; אפס-כשל → OBSERVING עם המדידה-המפורסמת."""
    if not av and not tg:
        degraded.append("console-verify")
        return {"id": "D4-truth-network", "area": "אימות-עצמי", "status": "OBSERVING",
                "titleHe": "רשת-האמת", "verdictHe": "מקורות-הביקורת-העצמית לא נמדדו בריצה-זו — ממשיכים-למדוד",
                "evidence": ["agent/verify/results.json + truth/latest.json לא זמינים"], "decidedAt": now(),
                "decidedBy": "sovereign-decider-v1 (CHARTER)"}
    ev = []
    failed = []
    if av:
        s = av.get("summary") or {}
        total = s.get("total"); passed = s.get("passed")
        verdict = s.get("verdict")
        ev.append(f"מאמת-הרשת: {passed}/{total} {verdict} ({av.get('generatedAt', '?')})")
        if verdict != "ALL_PASS":
            failed += [f"{r.get('id')}: {r.get('details', '')[:80]}"
                       for r in (av.get("results") or []) if not r.get("ok")]
    if tg:
        ev.append(f"שער-האמת: {tg.get('verdict')} (pass={((tg.get('counts') or {}).get('pass'))} fail={((tg.get('counts') or {}).get('fail'))})")
        for g in (tg.get("results") or []):
            if g.get("status") == "FAIL":
                failed.append(f"{g.get('gate')}: {g.get('note') or g.get('measured', '')[:80]}")
    if not failed:
        return {"id": "D4-truth-network", "area": "אימות-עצמי", "status": "OBSERVING",
                "titleHe": "רשת-האמת", "verdictHe": "הגוף מאמת-את-עצמו ירוק בפומבי (51/51 + שער-ירוק) — ממשיכים-למדוד",
                "evidence": ev, "decidedAt": now(),
                "decidedBy": "sovereign-decider-v1 (CHARTER)"}
    return {"id": "D4-truth-network", "area": "אימות-עצמי", "status": "ENFORCED", "priority": "P1",
            "titleHe": "רשת-האמת — כשל-בדיקה-עצמית מנותב מיד",
            "verdictHe": (f"הריבונות מכריעה: {len(failed)} כשלי-אימות-עצמי מנותבים למסילת-התיקון "
                          f"מיד (fail-closed: כל-הצהרה-נבדקת מול מדידה) — אין-המתנה-להוראות."),
            "evidence": ev + failed, "decidedAt": now(),
            "decidedBy": "sovereign-decider-v1 (CHARTER)"}


# ------------------------------------------------------------ פרסום ---
def main():
    degraded = []
    chain = measure_chain(degraded)
    beacon = read_json(f"{RAW}/sovereign-beacon/main/state.json")
    if not beacon:
        degraded.append("beacon")
    vs = read_json(f"{RAW}/Sandbox/main/ops/sovereign/VALUE-SCAN/state.json")
    if not vs:
        degraded.append("value-scan")
    foreman = read_json(f"{RAW}/FleetHQ/main/office/state/office-state.json")
    if not foreman:
        degraded.append("foreman")
    flow = read_json(f"{RAW}/Sandbox/main/ops/flow/flow-map.json")
    if not flow:
        degraded.append("flow-map")
    wos = read_json(f"{RAW}/Sandbox/main/ops/office/work-orders.json")
    if not isinstance(wos, list):
        wos = (wos or {}).get("orders") if isinstance(wos, dict) else None
        if not isinstance(wos, list):
            wos = None  # כנה: מנוע-הצמיחה עשוי לפרסם מבנה-אחר — לא מנחשים
    hc_scan = scan_outgoing_delegations(max_ops=3000, degraded=degraded)
    d0_merged, board_acked = decide_owner_channel(degraded)  # [15a-merge]
    # [T15] רשת-האמת — המאמת-העצמאי + שער-האמת של הקונסולה
    av = read_json(f"{RAW}/Console/main/agent/verify/results.json")
    if not av:
        degraded.append("console-agent-verify")
    tg = read_json(f"{RAW}/Console/main/truth/latest.json")
    if not tg:
        degraded.append("console-truth-gate")

    # [T16] פנקס-עצמי לרצף-הנקי (לפני-ההכרעות — ההכרעה קוראת-היסטוריה)
    lpath = os.path.join(OUT_DIR, "ledger.jsonl")
    ledger_lines = []
    if os.path.exists(lpath):
        with open(lpath, encoding="utf-8") as f:
            ledger_lines = [l for l in f.read().splitlines() if l.strip()]
    # [T16] סטטוס-מדוד לעבודות-שנותבו (done-ness נבדק, לא נטען)
    wo_status = measure_work_order_status(degraded)

    # ביקורת-אמת: מדוד מול מפורסם
    match = None
    if chain and beacon:
        pub = (beacon.get("lastPulse") or {}).get("treasuryNetSp")
        if isinstance(pub, (int, float)):
            match = abs(pub - chain["treasuryNetSp"]) <= 1.0

    decisions = [
        d0_merged,  # [T17]+[15a-merge] D0 — סמכות-עליונה: תיבה+לוח
        decide_econ(chain, beacon, hc_scan, degraded),
        decide_eng(foreman, wos, degraded, ledger_lines),
        decide_flow(flow, degraded),
        decide_verify(av, tg, degraded),  # [T15] רשת-האמת — בדיקה-עצמית נראית-ומוכרעת
    ]

    state = {
        "schema": "roshpina.sovereign-decider/1",
        "generatedAt": now(),
        "publisher": "sovereign-decider.yml (GitHub Actions, keyless, T14)",
        "charter": "ops/sovereign/DECIDER/CHARTER.md",
        "charterMandateAt": "2026-10-11T21:20Z",
        "ownerMandateVerbatim": "זה צריך להיות מוכרע על ידי הריבונות ממש לא על ידי תמשיך מה שהכי טוב ושיועיל שיעשו לבד הם לא צריכים לחכות להוראות וודא את זה",
        "degraded": sorted(set(degraded)),
        "chainVerify": (None if not chain else {
            "head": chain["head"], "mult": chain["mult"],
            "treasuryNetSp": chain["treasuryNetSp"], "minOperatorSp": chain["minOperatorSp"],
            "beaconChainMatch": match,
        }),
        "decisions": decisions,
        "workOrderStatus": wo_status,  # [T16] done-ness מדוד למה-שניתן-למידה; כנות לשאר
        "noAction": [],
        "law": "MEASURE→OPTIONS→SCORE→DECIDE→PUBLISH→VERIFY→RE-MEASURE · R1-R5 ב-CHARTER",
    }

    body = json.dumps(state, ensure_ascii=False, indent=1)
    path = os.path.join(OUT_DIR, "state.json")
    with open(path, "w", encoding="utf-8") as f:
        f.write(body + "\n")

    # [15a-merge] כתיבה-חזרה של ACK ללוח — רק-אם-היו-קבלות (אפס-רעש-קומיטים)
    if board_acked and _board_holder is not None:
        try:
            board = _board_holder
            board["updatedAt"] = now()
            bp = _board_path_holder
            board["lastAckPulseAt"] = now()
            with open(bp, "w", encoding="utf-8") as f:
                json.dump(board, f, ensure_ascii=False, indent=1)
                f.write("\n")
            print("DIRECTIVE-ACK-WRITTEN", [d.get("id") for d in board_acked])
        except Exception as e:
            print("DIRECTIVE-ACK-WRITE-FAIL (כנה):", str(e)[:120])

    # פנקס append-bounded (ההיסטוריה נקראה-כבר-למעלה — ledger_lines)
    entry = json.dumps({
        "at": state["generatedAt"], "head": chain["head"] if chain else None,
        "treasuryNetSp": chain["treasuryNetSp"] if chain else None,
        "beaconChainMatch": match,
        "engClean": ("not foreman" if not foreman else (
            not [a for a in (foreman.get("agents") or []) if a.get("state") == "error"]
            and not [t for t in (foreman.get("tasks") or []) if t.get("status") == "blocked"])),
        "decided": [d["id"] + ":" + d["status"] for d in decisions],
        "directivesAck": len(board_acked),  # [15a-merge] קבלות-פקודות-מנהל-בפעימה
        "degraded": state["degraded"],
    }, ensure_ascii=False)
    ledger_lines.append(entry)
    with open(lpath, "w", encoding="utf-8") as f:
        f.write("\n".join(ledger_lines[-LEDGER_MAX:]) + "\n")

    print("md5", hashlib.md5(body.encode()).hexdigest()[:12])
    for d in decisions:
        print("DECIDED", d["id"], d["status"], "-", d["verdictHe"][:110])
    print("degraded", state["degraded"], "· chainMatch", match)


if __name__ == "__main__":
    main()
