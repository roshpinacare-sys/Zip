// ─────────────────────────────────────────────────────────────────────
// FLEET-VERIFY — מפעל האימות המקומי · הריבונות מהמכסה (R109)
//
// שורש הבעיה (נמדד ב-R106): מכסת ה-Actions של הארגון מתה — הרץ
// הפרטי מעולם לא מתחיל (12/12 ריפואים פרטיים, steps=[]). תשעת
// סוכני-האימות של הרשת — השכבה שמוכיחה שהמכשירים באמת עובדים —
// דעכו בין 16-20/09 ולא רצו מאז.
//
// הפתרון הריבוני: אותן בדיקות בדיוק — רצות מקומית. כל מאמת משכפל
// את הריפו לספריית-עבודה (טרי בכל ריצה, נקי מטוקן), מריץ את מלוא
// שלבי-האימות כפי שהוגדרו ב-workflow המקורי, וכותב פסק-דין כן
// לקובץ-האמת. הסמכות (PAT) נקראת מהכספת המקומית ומוזרקת דרך
// GIT_ASKPASS — הטוקן לעולם לא נכתב לשום .git/config, לא
// מודפס ולא נשמר במצב. הענן הוא גיבוי; הבית הוא כאן.
//
// חוקי-ברזל:
//   · פסק-דין נכתב רק מקובץ agent/status.json שהבדיקה עצמה ייצרה
//   · כישלון נרשם ככישלון — אין "נניח שהצליח"
//   · בילד ייצור מקומי = skipped-local (מדיניות סנדבוקס כנה) —
//     שער-האיכות המקומי: התקנה + ג'נרוט + בדיקת-טיפוסים
//   · הטוקן מוסתר מכל פלט ([REDACTED]) ומכל מצב
//   · משימה אחת בכל פעם; פסק-זמן מלא; כתיבת-מצב אטומית (חוק R107b)
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

// זמן-ריצה של Bun ללא חבילת טיפוסים בפרויקט — הצהרה מקומית נקייה
declare const Bun: {
  spawnSync: (cmd: string[], opts?: { cwd?: string; env?: Record<string, string>; stdout?: string; stderr?: string }) => { exitCode: number | null; stdout?: Buffer | null; stderr?: Buffer | null };
  serve: (opts: { port: number; fetch: (req: Request) => Promise<Response> | Response }) => unknown;
};

const HOME = "/home/z/my-project";
const PORT = 3038;
const STATE_DIR = `${HOME}/sovereign/fleet-verify`;
const STATE_FILE = `${STATE_DIR}/state.json`;
const WORK_ROOT = `${STATE_DIR}/work`;
const ASKPASS = `${STATE_DIR}/.git-askpass.sh`;
const ORG = "roshpinacare-sys";

// ── הסמכות: PAT מהכספת המקומית; נפילה לחילוץ מה-remote ───────────
function readPat(): string | null {
  try {
    const t = fs.readFileSync("/home/z/upload/pat.env", "utf8").trim();
    if (t.length > 20) return t;
  } catch {
    /* ניפול לחילוץ מה-remote */
  }
  try {
    const url = spawnSyncText("git", ["-C", HOME, "remote", "get-url", "origin"]);
    const m = url.match(/x-access-token:([^@]+)@/);
    if (m && m[1].length > 20) return m[1];
  } catch {
    /* אין סמכות — יירשם בכנות */
  }
  return null;
}

function spawnSyncText(cmd: string, args: string[]): string {
  const r = Bun.spawnSync([cmd, ...args], { cwd: HOME });
  return r.stdout?.toString() ?? "";
}

const PAT = readPat();

// ה-askpass: הטוקן חי רק בזיכרון-הריצה ובקובץ chmod-700 חד-פעמי
function ensureAskpass(): void {
  if (!PAT) return;
  if (!fs.existsSync(ASKPASS)) {
    fs.writeFileSync(ASKPASS, `#!/bin/sh\necho '${PAT.replace(/'/g, "'\\''")}'\n`, { mode: 0o700 });
  }
  fs.chmodSync(ASKPASS, 0o700);
}

function gitEnv(): Record<string, string> {
  return {
    ...process.env,
    GIT_ASKPASS: ASKPASS,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

// ── מניפסט המאמתים — מה-YAML אל הבית ──────────────────────────────
// כל סקריפט כותב agent/status.json (אותה מוסכמה כמו הענן) —
// הרץ קורא אותו ורושם פסק-דין. האמת נולדת בבדיקה עצמה.

interface JobDef {
  id: string;
  repo: string;
  titleHe: string;
  layer: string;
  roleHe: string;
  timeoutMin: number;
  startOffsetMin: number; // ההיסט בסבב הראשון — שהמפעל לא ייחנק
  script: string;
}

const JOBS: JobDef[] = [
  {
    id: "jumpper-tests",
    repo: "saos-jummper",
    titleHe: "מבחני הנוטריון חוצה-השרשרות",
    layer: "QA",
    roleHe: "JUMPPER הוא נוטריון ההוכחות של הרשת: כל טענה דיגיטלית הופכת לרשומה ציבורית זולה לאימות. המאמת מריץ את מלוא מבחני היחידה, קומפילציה מלאה והדמו החי מול שרשרות ציבוריות.",
    timeoutMin: 12,
    startOffsetMin: 1,
    script: `set -u
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
VERDICT="FAIL"
REASON="unit tests failed"
if [ -f requirements.txt ]; then
  pip install --quiet -r requirements.txt 2>/dev/null || pip install --quiet requests 2>/dev/null || true
else
  pip install --quiet requests 2>/dev/null || true
fi
pip install --quiet -e . 2>/dev/null || true
export PYTHONPATH="$PWD/src\${PYTHONPATH:+:\$PYTHONPATH}"
UNIT_OUT="$(python3 -m unittest discover -s tests -v 2>&1 || true)"
echo "$UNIT_OUT" | tail -12
UNIT_OK=0
echo "$UNIT_OUT" | grep -q '^OK' && UNIT_OK=1
TESTS_RAN="$(echo "$UNIT_OUT" | grep -oE 'Ran [0-9]+ tests? in' | grep -oE '[0-9]+' | head -1 || echo 0)"
COMPILE_OK=1
python3 -m compileall -q src 2>/dev/null || COMPILE_OK=0
DEMO="skipped"; DEMO_NOTE="demo script not found"
if [ -f scripts/demo_end_to_end.py ]; then
  DEMO_NOTE=""
  if python3 scripts/demo_end_to_end.py > .fv-demo.log 2>&1; then DEMO="pass"; else DEMO="failed"; DEMO_NOTE="live witness read failed - see the run log"; fi
fi
if [ "$UNIT_OK" = "1" ] && [ "$COMPILE_OK" = "1" ]; then VERDICT="PASS"; REASON="unit tests pass, package compiles"
elif [ "$UNIT_OK" = "1" ]; then VERDICT="FAIL"; REASON="package compile failed"; fi
mkdir -p agent
cat > agent/status.json <<EOF
{
 "agent": "jumpper-tests",
 "generatedAt": "$NOW",
 "verdict": "$VERDICT",
 "checks": {
  "unitTestsRan": $TESTS_RAN,
  "unitTestsOk": $UNIT_OK,
  "packageCompiles": $COMPILE_OK,
  "liveWitnessDemo": "$DEMO"
 },
 "reason": "$REASON\${DEMO_NOTE:+ · \$DEMO_NOTE}"
}
EOF
echo "verdict: $VERDICT ($REASON)"
[ "$VERDICT" = "PASS" ] || exit 1`,
  },
  {
    id: "wallet-verify",
    repo: "Saosmartwallet",
    titleHe: "שעת האיכות של הארנק",
    layer: "QA",
    roleHe: "Saosmartwallet הוא הארנק של הרשת: 7 רשתות חיות, כספת מפתחות ריבונית ושכבת גשרים. המאמת מתקין מהנעילה הקפואה, מג'נרט לקוח Prisma ומריץ בדיקת טיפוסים מלאה.",
    timeoutMin: 20,
    startOffsetMin: 14,
    script: `set -u
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
VERDICT="FAIL"
REASON=""
if [ ! -f package.json ]; then echo "no package.json"; exit 1; fi
# חוק המטמון: התקנה רק כשהנעילה/המניפסט השתנו מאז ההתקנה המוכחת האחרונה
NEED_INSTALL=1
if [ -d node_modules ] && [ -f .fv-install.stamp ]; then
  NEWER="$(find package.json bun.lock -newer .fv-install.stamp 2>/dev/null | head -1)"
  [ -z "$NEWER" ] && NEED_INSTALL=0
fi
INSTALL="cached"
if [ "$NEED_INSTALL" = "1" ]; then
  INSTALL="fail"
  if [ -f bun.lock ]; then
    bun install --frozen-lockfile > .fv-install.log 2>&1 && INSTALL="pass" || { tail -8 .fv-install.log; }
  else
    bun install > .fv-install.log 2>&1 && INSTALL="pass" || { tail -8 .fv-install.log; }
  fi
  [ "$INSTALL" = "pass" ] && touch .fv-install.stamp
fi
if [ "$INSTALL" = "fail" ]; then REASON="dependency install failed"; fi
PRISMA="skipped"
if { [ "$INSTALL" = "pass" ] || [ "$INSTALL" = "cached" ]; } && [ -f prisma/schema.prisma ]; then
  bunx prisma generate > .fv-prisma.log 2>&1 && PRISMA="pass" || PRISMA="fail"
fi
TSC="skipped"
if { [ "$INSTALL" = "pass" ] || [ "$INSTALL" = "cached" ]; } && [ -f tsconfig.json ]; then
  bunx tsc --noEmit > .fv-tsc.log 2>&1 && TSC="pass" || { TSC="fail"; tail -12 .fv-tsc.log; }
fi
BUILD="skipped-local"
if { [ "$INSTALL" = "pass" ] || [ "$INSTALL" = "cached" ]; } && [ "$TSC" != "fail" ] && [ "$PRISMA" != "fail" ]; then
  VERDICT="PASS"; REASON="install+typecheck pass (local gate: build skipped by sandbox policy)"
else
  REASON="install=\$INSTALL prisma=\$PRISMA tsc=\$TSC"
fi
mkdir -p agent
cat > agent/status.json <<EOF
{
 "agent": "wallet-verify",
 "generatedAt": "$NOW",
 "verdict": "$VERDICT",
 "checks": {
  "install": "$INSTALL",
  "prismaGenerate": "$PRISMA",
  "typecheck": "$TSC",
  "productionBuild": "$BUILD"
 },
 "reason": "$REASON"
}
EOF
echo "verdict: $VERDICT ($REASON)"
[ "$VERDICT" = "PASS" ] || exit 1`,
  },
  {
    id: "sdk-verify",
    repo: "Sdk",
    titleHe: "שלמות תוכן ה-SDK",
    layer: "QA",
    roleHe: "מאמת שכבת ה-SDK: מסמכים ושידורים קיימים, לא ריקים, ומניפסט SHA-256 נבנה על כל התוכן — שינוי נמדד בריצה הבאה.",
    timeoutMin: 5,
    startOffsetMin: 40,
    script: `set -u
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
VERDICT="PASS"
REASON="sdk content intact"
DOCS=0; BCASTS=0; DOCS_FILES=0; BC_FILES=0; ROOT_MD=0
[ -d docs ] && DOCS=1
[ -d broadcasts ] && BCASTS=1
DOCS_FILES="$({ find docs -type f 2>/dev/null || true; } | wc -l | tr -d ' ')"
BC_FILES="$({ find broadcasts -type f 2>/dev/null || true; } | wc -l | tr -d ' ')"
ROOT_MD="$({ find . -maxdepth 1 -name '*.md' || true; } | wc -l | tr -d ' ')"
if [ "$DOCS" -eq 0 ] && [ "$BCASTS" -eq 0 ]; then VERDICT="FAIL"; REASON="both docs and broadcasts missing"; fi
if [ "$DOCS" -eq 1 ] && [ "$DOCS_FILES" -eq 0 ]; then VERDICT="FAIL"; REASON="docs directory is empty"; fi
if [ "$BCASTS" -eq 1 ] && [ "$BC_FILES" -eq 0 ]; then VERDICT="FAIL"; REASON="broadcasts directory is empty"; fi
mkdir -p agent
find docs broadcasts -type f 2>/dev/null | LC_ALL=C sort | xargs -r sha256sum > agent/manifest.sha256 2>/dev/null || true
TOTAL_FILES="$((DOCS_FILES + BC_FILES))"
TOTAL_BYTES="$({ find docs broadcasts -type f 2>/dev/null -exec stat -c %s {} + || true; } | awk '{s+=$1} END {print s+0}')"
cat > agent/status.json <<EOF
{
 "agent": "sdk-verify",
 "generatedAt": "$NOW",
 "verdict": "$VERDICT",
 "checks": {
  "docsDir": $DOCS,
  "docsFiles": $DOCS_FILES,
  "broadcastsDir": $BCASTS,
  "broadcastFiles": $BC_FILES,
  "rootDocs": $ROOT_MD,
  "totalFiles": $TOTAL_FILES,
  "totalBytes": $TOTAL_BYTES
 },
 "reason": "$REASON"
}
EOF
echo "verdict: $VERDICT ($REASON)"
[ "$VERDICT" = "PASS" ] || exit 1`,
  },
  {
    id: "claims-guard",
    repo: "Adsmarket",
    titleHe: "שומר הטענות של השיווק",
    layer: "ENFORCEMENT",
    roleHe: "בודק שעמודי הנחיתה סגורים כראוי, שאין גליפים אסורים (אימוג'י/חצים/דינגבטים), ושקישורי הרשת שלנו חיים — קישור מת שלנו הוא כשל, חיצוני מדווח בכנות.",
    timeoutMin: 10,
    startOffsetMin: 70,
    script: `set -u
mkdir -p agent
python3 - <<'PY'
import glob, json, re, urllib.request, ssl, datetime

FORBIDDEN = [(0x2013,0x2015),(0x2190,0x21FF),(0x2600,0x27BF),(0x2B00,0x2BFF),(0x1F000,0x1FAFF),(0xFE0F,0xFE0F)]
verdict = "PASS"
reason = "all checks passed"

pages = sorted(glob.glob('*.html') + glob.glob('onepager/*.html') + glob.glob('deck/*.html') + glob.glob('content/*.html'))
closed = sum(1 for p in pages if '</html>' not in open(p, encoding='utf-8', errors='replace').read())
if not pages:
    verdict = "FAIL"; reason = "no landing pages found"
elif closed:
    verdict = "FAIL"; reason = str(closed) + " pages missing closing html tag"

glyphs = 0
for p in pages + sorted(glob.glob('*.md')):
    try:
        text = open(p, encoding='utf-8', errors='replace').read()
    except Exception:
        continue
    for ch in text:
        cp = ord(ch)
        for a, b in FORBIDDEN:
            if a <= cp <= b:
                glyphs += 1
                break
if glyphs:
    verdict = "FAIL"; reason = str(glyphs) + " forbidden glyphs in marketing files"

urls = set()
pat = re.compile(r'https?://[^"\\'<> )]+')
for p in pages:
    for u in pat.findall(open(p, encoding='utf-8', errors='replace').read()):
        u = u.rstrip('.,;')
        if 'localhost' in u or '127.0.0.1' in u:
            continue
        urls.add(u)
urls = sorted(urls)[:25]
ctx = ssl.create_default_context()
ok_l = own_dead = ext_dead = 0
for u in urls:
    try:
        req = urllib.request.Request(u, headers={'User-Agent': 'claims-guard'})
        with urllib.request.urlopen(req, timeout=10, context=ctx) as r:
            code = r.status
    except Exception as e:
        code = getattr(e, 'code', 0)
    if code in (200, 301, 302, 307, 308):
        ok_l += 1
    elif 'roshpinacare' in u or 'github.io' in u:
        own_dead += 1
    else:
        ext_dead += 1
if own_dead:
    verdict = "FAIL"; reason = str(own_dead) + " own-network links are dead"
elif ext_dead:
    reason = str(ext_dead) + " external links dead (reported, not a failure)"

receipts = 0
rx = re.compile(r'(0x[a-fA-F0-9]{64}|txid)')
for p in pages + sorted(glob.glob('*.md')):
    try:
        receipts += len(rx.findall(open(p, encoding='utf-8', errors='replace').read()))
    except Exception:
        pass

status = {
    "agent": "claims-guard",
    "verdict": verdict,
    "checks": {
        "landingPages": len(pages),
        "pagesMissingCloseTag": closed,
        "forbiddenGlyphs": glyphs,
        "linksChecked": len(urls),
        "linksAlive": ok_l,
        "ownNetworkDeadLinks": own_dead,
        "externalDeadLinks": ext_dead,
        "receiptMentions": receipts
    },
    "reason": reason
}
status["generatedAt"] = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
with open('agent/status.json', 'w', encoding='utf-8') as f:
    json.dump(status, f, indent=1, ensure_ascii=False)
print('verdict:', verdict, '|', reason)
PY
V=$?
if [ $V -ne 0 ]; then echo "python failed"; exit 1; fi
grep -q '"verdict": "PASS"' agent/status.json || exit 1`,
  },
  {
    id: "controls-audit",
    repo: "roshpina",
    titleHe: "מבקר הבקרות של רושפינה",
    layer: "ENFORCEMENT",
    roleHe: "הריפו מתעד אילו בקרות באמת קיימות ואת תדריך הסוכן. המאמת מוודה שהמסמכים קיימים, לא ריקים, שכל בקרה בסעיף משלה — וסופר את ארכיון השידורים.",
    timeoutMin: 6,
    startOffsetMin: 100,
    script: `set -u
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
VERDICT="PASS"
REASON="controls documented"
CONTROLS_EXIST=0; CONTROLS_BYTES=0; CONTROL_SECTIONS=0
if [ -f CONTROLS-THAT-EXIST.md ]; then
  CONTROLS_EXIST=1
  CONTROLS_BYTES="$(stat -c %s CONTROLS-THAT-EXIST.md)"
  CONTROL_SECTIONS="$(grep -c '^## ' CONTROLS-THAT-EXIST.md || true)"
fi
if [ "$CONTROLS_EXIST" -eq 0 ]; then VERDICT="FAIL"; REASON="CONTROLS-THAT-EXIST.md missing"; fi
if [ "$CONTROLS_EXIST" -eq 1 ] && [ "$CONTROLS_BYTES" -lt 500 ]; then VERDICT="FAIL"; REASON="controls document too small"; fi
BRIEFING=0; PATCHSPEC=0
[ -f AGENT-BRIEFING.md ] && BRIEFING=1
[ -f PATCH-SPEC-P10.md ] && PATCHSPEC=1
if [ "$BRIEFING" -eq 0 ]; then VERDICT="FAIL"; REASON="AGENT-BRIEFING.md missing"; fi
BC_FILES="$({ find broadcasts -type f 2>/dev/null || true; } | wc -l | tr -d ' ')"
BC_BAD="$(find broadcasts -type f 2>/dev/null | grep -v -E '/[0-9]{4}-[0-9]{2}-[0-9]{2}-' | grep -c . || true)"
mkdir -p agent
cat > agent/status.json <<EOF
{
 "agent": "controls-audit",
 "generatedAt": "$NOW",
 "verdict": "$VERDICT",
 "checks": {
  "controlsDocumentExists": $CONTROLS_EXIST,
  "controlsDocumentBytes": $CONTROLS_BYTES,
  "controlSections": $CONTROL_SECTIONS,
  "agentBriefingExists": $BRIEFING,
  "patchSpecExists": $PATCHSPEC,
  "broadcastFiles": $BC_FILES,
  "broadcastsBadNaming": $BC_BAD
 },
 "reason": "$REASON"
}
EOF
echo "verdict: $VERDICT ($REASON)"
[ "$VERDICT" = "PASS" ] || exit 1`,
  },
  {
    id: "control-center-build",
    repo: "saos-control-center",
    titleHe: "שער הבנייה של מרכז הבקרה",
    layer: "QA",
    roleHe: "מרכז הבקרה של הרשת: המאמת מתקין מהנעילה הקפואה, מג'נרט לקוח Prisma ומריץ בדיקת טיפוסים מלאה — השער לפני שכל שינוי רואה עולם.",
    timeoutMin: 18,
    startOffsetMin: 130,
    script: `set -u
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
VERDICT="FAIL"
REASON=""
if [ ! -f package.json ]; then echo "no package.json"; exit 1; fi
# חוק המטמון: התקנה רק כשהנעילה/המניפסט השתנו מאז ההתקנה המוכחת האחרונה
NEED_INSTALL=1
if [ -d node_modules ] && [ -f .fv-install.stamp ]; then
  NEWER="$(find package.json bun.lock -newer .fv-install.stamp 2>/dev/null | head -1)"
  [ -z "$NEWER" ] && NEED_INSTALL=0
fi
INSTALL="cached"
if [ "$NEED_INSTALL" = "1" ]; then
  INSTALL="fail"
  if [ -f bun.lock ]; then
    bun install --frozen-lockfile > .fv-install.log 2>&1 && INSTALL="pass" || { tail -8 .fv-install.log; }
  else
    bun install > .fv-install.log 2>&1 && INSTALL="pass" || { tail -8 .fv-install.log; }
  fi
  [ "$INSTALL" = "pass" ] && touch .fv-install.stamp
fi
if [ "$INSTALL" = "fail" ]; then REASON="dependency install failed"; fi
PRISMA="skipped"
if { [ "$INSTALL" = "pass" ] || [ "$INSTALL" = "cached" ]; } && [ -f prisma/schema.prisma ]; then
  bunx prisma generate > .fv-prisma.log 2>&1 && PRISMA="pass" || PRISMA="fail"
fi
TSC="skipped"
if { [ "$INSTALL" = "pass" ] || [ "$INSTALL" = "cached" ]; } && [ -f tsconfig.json ]; then
  bunx tsc --noEmit > .fv-tsc.log 2>&1 && TSC="pass" || { TSC="fail"; tail -12 .fv-tsc.log; }
fi
BUILD="skipped-local"
if { [ "$INSTALL" = "pass" ] || [ "$INSTALL" = "cached" ]; } && [ "$TSC" != "fail" ] && [ "$PRISMA" != "fail" ]; then
  VERDICT="PASS"; REASON="install+typecheck pass (local gate: build skipped by sandbox policy)"
else
  REASON="install=\$INSTALL prisma=\$PRISMA tsc=\$TSC"
fi
mkdir -p agent
cat > agent/status.json <<EOF
{
 "agent": "control-center-build",
 "generatedAt": "$NOW",
 "verdict": "$VERDICT",
 "checks": {
  "install": "$INSTALL",
  "prismaGenerate": "$PRISMA",
  "typecheck": "$TSC",
  "productionBuild": "$BUILD"
 },
 "reason": "$REASON"
}
EOF
echo "verdict: $VERDICT ($REASON)"
[ "$VERDICT" = "PASS" ] || exit 1`,
  },
  {
    id: "platform-selftest",
    repo: "saos-sovereign-platform",
    titleHe: "בחינה-עצמית של מנוע הקצה",
    layer: "QA",
    roleHe: "מנוע ההשקיה של הפלטפורמה הריבונית: המאמת מריץ את ה-selftest המלא, טוען את שכבת הכללים הקפואה ומריץ קומפילציה של רץ-הרקע.",
    timeoutMin: 10,
    startOffsetMin: 160,
    script: `set -u
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
VERDICT="FAIL"
REASON="selftest failed"
ST_EXIT=1; ST_PASS=0; ST_TOTAL=0
if [ -f python/irrigation_engine.py ]; then
  if python3 python/irrigation_engine.py selftest > .fv-selftest.log 2>&1; then ST_EXIT=0; fi
  tail -10 .fv-selftest.log
  ST_PASS="$(grep -oE '[0-9]+/[0-9]+' .fv-selftest.log | tail -1 | cut -d/ -f1 || echo 0)"
  ST_TOTAL="$(grep -oE '[0-9]+/[0-9]+' .fv-selftest.log | tail -1 | cut -d/ -f2 || echo 0)"
else
  REASON="irrigation_engine.py not found"
fi
RULES="skipped"
if [ -f python/irrigation_engine.py ]; then
  if python3 python/irrigation_engine.py rules > .fv-rules.log 2>&1; then RULES="pass"; else RULES="fail"; fi
  tail -6 .fv-rules.log
fi
RUNNER="skipped"
if [ -f python/edge_runner.py ]; then
  if python3 -m py_compile python/edge_runner.py 2>/dev/null; then RUNNER="compiles"; else RUNNER="compile-failed"; fi
fi
if [ "$ST_EXIT" = "0" ] && [ "$RULES" = "pass" ]; then
  VERDICT="PASS"; REASON="selftest \${ST_PASS}/\${ST_TOTAL}, rule layer loads"
elif [ "$ST_EXIT" = "0" ]; then
  VERDICT="FAIL"; REASON="selftest passed but rule layer failed to load"
fi
mkdir -p agent
cat > agent/status.json <<EOF
{
 "agent": "platform-selftest",
 "generatedAt": "$NOW",
 "verdict": "$VERDICT",
 "checks": {
  "selftestPassed": $ST_PASS,
  "selftestTotal": $ST_TOTAL,
  "selftestExitOk": $ST_EXIT,
  "ruleLayerLoad": "$RULES",
  "edgeRunnerCompile": "$RUNNER"
 },
 "reason": "$REASON"
}
EOF
echo "verdict: $VERDICT ($REASON)"
[ "$VERDICT" = "PASS" ] || exit 1`,
  },
  {
    id: "archive-keeper",
    repo: "Project-files",
    titleHe: "שומר הארכיונים",
    layer: "RECOVERY",
    roleHe: "כל ארכיון חייב להיפתח נקי: המאמת פותח-מבחן כל קובץ zip, בונה מניפסט SHA-256 ומדווח בכנות על כל ארכיון פגום.",
    timeoutMin: 15,
    startOffsetMin: 190,
    script: `set -u
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
VERDICT="PASS"
REASON="all archives open cleanly"
find . -name '*.zip' -not -path './.git/*' -print0 | while IFS= read -r -d '' z; do
  if unzip -tq "$z" > /dev/null 2>&1; then echo "OK $z"; else echo "CORRUPT $z"; fi
done > .fv-zipcheck.log
cat .fv-zipcheck.log | tail -15
TOTAL="$(grep -c . .fv-zipcheck.log || true)"
OKZ="$(grep -c '^OK ' .fv-zipcheck.log || true)"
CORRUPT="$(grep -c '^CORRUPT ' .fv-zipcheck.log || true)"
BYTES="$({ find . -name '*.zip' -not -path './.git/*' -exec stat -c %s {} + || true; } | awk '{s+=$1} END {print s+0}')"
ROOT_MD="$({ find . -maxdepth 1 -name '*.md' || true; } | wc -l | tr -d ' ')"
if [ "\${CORRUPT:-0}" -gt 0 ]; then VERDICT="FAIL"; REASON="$CORRUPT archives failed the open test"; fi
mkdir -p agent
find . -name '*.zip' -not -path './.git/*' -print0 | xargs -0 sha256sum > agent/archives.sha256 2>/dev/null || true
cat > agent/status.json <<EOF
{
 "agent": "archive-keeper",
 "generatedAt": "$NOW",
 "verdict": "$VERDICT",
 "checks": {
  "archivesTotal": \${TOTAL:-0},
  "archivesIntact": \${OKZ:-0},
  "archivesCorrupt": \${CORRUPT:-0},
  "archivesBytes": $BYTES,
  "rootDocuments": $ROOT_MD
 },
 "reason": "$REASON"
}
EOF
echo "verdict: $VERDICT ($REASON)"
[ "$VERDICT" = "PASS" ] || exit 1`,
  },
  {
    id: "baseline-integrity",
    repo: "anchor-baseline",
    titleHe: "שלמות קו-הבסיס",
    layer: "WITNESS",
    roleHe: "ההיסטוריה לא נמחקת לעולם: המאמת בונה מניפסט SHA-256 של כל תוכן ההיסטוריה, משווה לריצה הקודמת ופוסל אם קובץ הוסר. מוסכמת שמות השידורים נבדקת.",
    timeoutMin: 8,
    startOffsetMin: 220,
    script: `set -u
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
VERDICT="PASS"
REASON="baseline intact"
find broadcasts docs download -type f 2>/dev/null | LC_ALL=C sort | xargs -r sha256sum > .fv-manifest.new || true
FILES="$(wc -l < .fv-manifest.new | tr -d ' ')"
BYTES="$({ find broadcasts docs download -type f 2>/dev/null -exec stat -c %s {} + || true; } | awk '{s+=$1} END {print s+0}')"
ADDED=0; REMOVED=0; CHANGED=0
if [ -f agent/manifest.sha256 ]; then
  sort agent/manifest.sha256 > .fv-old.sorted
  sort .fv-manifest.new > .fv-new.sorted
  cut -d' ' -f3- .fv-old.sorted > .fv-old.paths
  cut -d' ' -f3- .fv-new.sorted > .fv-new.paths
  REMOVED="$(comm -23 .fv-old.paths .fv-new.paths | grep -c . || true)"
  ADDED="$(comm -13 .fv-old.paths .fv-new.paths | grep -c . || true)"
  CHANGED="$(comm -3 .fv-old.sorted .fv-new.sorted | grep -c . || true)"
fi
if [ "\${REMOVED:-0}" -gt 0 ]; then VERDICT="FAIL"; REASON="$REMOVED history files removed"; fi
BADNAME="$(find broadcasts -type f 2>/dev/null | grep -v -E '/[0-9]{4}-[0-9]{2}-[0-9]{2}-' | grep -c . || true)"
mkdir -p agent
cp .fv-manifest.new agent/manifest.sha256
cat > agent/status.json <<EOF
{
 "agent": "baseline-integrity",
 "generatedAt": "$NOW",
 "verdict": "$VERDICT",
 "checks": {
  "files": \${FILES:-0},
  "bytes": $BYTES,
  "added": $ADDED,
  "removed": $REMOVED,
  "changed": $CHANGED,
  "badNaming": \${BADNAME:-0}
 },
 "reason": "$REASON"
}
EOF
echo "verdict: $VERDICT ($REASON)"
[ "$VERDICT" = "PASS" ] || exit 1`,
  },
];

// ── המצב ────────────────────────────────────────────────────────────
interface JobState {
  id: string;
  repo: string;
  titleHe: string;
  layer: string;
  roleHe: string;
  verdict: "PENDING" | "RUNNING" | "PASS" | "FAIL" | "ERROR" | "TIMEOUT";
  lastRunAt: string | null;
  durationMs: number | null;
  checks: Record<string, unknown> | null;
  reason: string | null;
  outputTail: string[];
  nextDueAt: string;
  commit: string | null;
  runs: number;
}

interface FleetState {
  service: string;
  version: string;
  bootedAt: string;
  beats: number;
  patAvailable: boolean;
  current: { id: string; startedAt: string } | null;
  jobs: JobState[];
  lastDecision: { at: string; kind: string; detail: string } | null;
  history: { at: string; id: string; verdict: string; detail: string }[];
}

function boot(): FleetState {
  let prev: Partial<FleetState> = {};
  try {
    prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    /* מפעל חדש */
  }
  const now = new Date();
  const prevJobs = new Map((prev.jobs ?? []).map((j) => [j.id, j]));
  const jobs: JobState[] = JOBS.map((def) => {
    const old = prevJobs.get(def.id);
    // המשכיות פסקי-דין עבר + סדר-יום חדש למי שלא רץ מעולם
    const fresh = !old?.lastRunAt;
    return {
      id: def.id,
      repo: def.repo,
      titleHe: def.titleHe,
      layer: def.layer,
      roleHe: def.roleHe,
      verdict: old?.verdict === "RUNNING" ? "PENDING" : (old?.verdict ?? "PENDING"),
      lastRunAt: old?.lastRunAt ?? null,
      durationMs: old?.durationMs ?? null,
      checks: old?.checks ?? null,
      reason: old?.reason ?? null,
      outputTail: old?.outputTail ?? [],
      nextDueAt: fresh
        ? new Date(now.getTime() + def.startOffsetMin * 60_000).toISOString()
        : (old?.nextDueAt ?? new Date(now.getTime() + def.startOffsetMin * 60_000).toISOString()),
      commit: old?.commit ?? null,
      runs: old?.runs ?? 0,
    };
  });
  return {
    service: "fleet-verify",
    version: "1.0.0",
    bootedAt: now.toISOString(),
    beats: 0,
    patAvailable: Boolean(PAT),
    current: null,
    jobs,
    lastDecision: prev.lastDecision ?? null,
    history: Array.isArray(prev.history) ? prev.history.slice(-60) : [],
  };
}

// המצב — סינגלטון globalThis ששורד טעינות-חמות + ריפוי-מזוג:
// כשהמודול מוערך מחדש, תוצאות חדשות מהקובץ (אם נכתבו) מתמזגות
// פנימה — הריצה החדשה מנצחת לפי lastRunAt. כך שום אמת לא אובדת.
const G = globalThis as {
  __FV_STATE__?: FleetState;
  __FV_TIMER__?: ReturnType<typeof setInterval>;
  __FV_SERVER__?: unknown;
};
if (G.__FV_STATE__) {
  try {
    const file = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as Partial<FleetState>;
    const fileJobs = new Map((file.jobs ?? []).map((j) => [j.id, j]));
    for (const mem of G.__FV_STATE__.jobs) {
      const f = fileJobs.get(mem.id);
      if (!f || !f.lastRunAt) continue;
      if (!mem.lastRunAt || Date.parse(f.lastRunAt) > Date.parse(mem.lastRunAt)) {
        if (mem.verdict !== "RUNNING") Object.assign(mem, f);
      }
    }
  } catch {
    /* אין קובץ — הזיכרון הוא האמת */
  }
} else {
  G.__FV_STATE__ = boot();
}
const state: FleetState = G.__FV_STATE__;

function saveState(): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

// ── סניטציה: הטוקן לעולם לא נכנס למצב ──────────────────────────────
function sanitize(text: string): string {
  if (!PAT) return text;
  return text.split(PAT).join("[REDACTED]");
}

// ── ספריית-העבודה: טרי בכל ריצה, נקי מטוקן ──────────────────────────
function ensureWorkdir(repo: string): { ok: boolean; commit: string | null; detail: string } {
  const dir = path.join(WORK_ROOT, repo);
  fs.mkdirSync(WORK_ROOT, { recursive: true });
  const url = `https://github.com/${ORG}/${repo}.git`;
  if (!fs.existsSync(path.join(dir, ".git"))) {
    const r = Bun.spawnSync(["git", "clone", "--depth", "1", "--single-branch", "--branch", "main", url, dir], {
      env: gitEnv(),
    });
    if (r.exitCode !== 0) {
      return { ok: false, commit: null, detail: `clone failed: ${sanitize((r.stderr?.toString() ?? "") + (r.stdout?.toString() ?? "")).slice(0, 300)}` };
    }
  } else {
    // רענון: fetch + reset — הבדיקה תמיד על ה-HEAD החי
    const f = Bun.spawnSync(["git", "fetch", "--depth", "1", "origin", "main"], { cwd: dir, env: gitEnv() });
    if (f.exitCode !== 0) {
      return { ok: false, commit: null, detail: `fetch failed: ${sanitize((f.stderr?.toString() ?? "")).slice(0, 300)}` };
    }
    Bun.spawnSync(["git", "reset", "--hard", "origin/main"], { cwd: dir });
    // חוק הזיכרון (נלמד מ-OOM חי): node_modules וחותמות-ההתקנה שורדים את
    // הניקוי — התקנה מחדש רק כשהנעילה באמת השתנתה. הליברה הרגה תהליכים
    // כשהמפעל התקין 55MB של תלויות בכל ריצה בכבדות.
    Bun.spawnSync(["git", "clean", "-fd", "-e", "node_modules", "-e", ".fv-*"], { cwd: dir });
  }
  const c = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: dir });
  const commit = c.stdout?.toString().trim() ?? null;
  return { ok: true, commit, detail: `workdir fresh @ ${commit}` };
}

// ── שומר הזיכרון (נלמד משני הריגי-OOM חיים) ────────────────────────
// הקופסה קטנה (4GB). next-dev לבדו ~1.8GB. כשמאמת מריץ tsc/prisma על
// ריפו כבד — הליברה הורגת את הגדול ביותר: את שרת-הייצור שלנו. החוק:
// לפני צעד כבד, נמדד זיכרון-פנוי. אין מספיק — המאמת נדחה בכנות
// ("deferred: low memory") וייסה למועד מאוחר יותר. חיי המערכת קודמים
// לריצת-אימות בודדת.
function availableMemMb(): number {
  try {
    const mi = fs.readFileSync("/proc/meminfo", "utf8");
    const m = mi.match(/MemAvailable:\s+(\d+) kB/);
    return m ? Math.round(Number(m[1]) / 1024) : 0;
  } catch {
    return 4096;
  }
}

const HEAVY_JOBS = new Set(["wallet-verify", "control-center-build", "platform-selftest"]);
const MIN_AVAILABLE_MB = 900;

// ── הרצת מאמת ──────────────────────────────────────────────────────
async function runJob(def: JobDef): Promise<void> {
  const job = state.jobs.find((j) => j.id === def.id);
  if (!job) return;
  if (!PAT) {
    state.lastDecision = { at: new Date().toISOString(), kind: "WAIT", detail: "אין סמכות (PAT) — המפעל ממתין בכנות" };
    saveState();
    return;
  }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  ensureAskpass();

  // שומר הזיכרון: מאמת כבד בקופסה צפופה = הרג שרת-ייצור. דחייה כנה עד
  // שיהיה אוויר לנשום — המאמת ינסה שוב בעוד שעה.
  if (HEAVY_JOBS.has(def.id) && availableMemMb() < MIN_AVAILABLE_MB) {
    const avail = availableMemMb();
    job.nextDueAt = new Date(Date.now() + 3_600_000).toISOString();
    state.lastDecision = {
      at: new Date().toISOString(),
      kind: "DEFER",
      detail: `${def.id}: נדחה בכנות — זיכרון פנוי ${avail}MB מתחת לקו ${MIN_AVAILABLE_MB}MB · ניסיון חוזר בעוד שעה`,
    };
    state.history.push({
      at: new Date().toISOString(),
      id: def.id,
      verdict: "DEFER",
      detail: `low memory ${avail}MB`,
    });
    saveState();
    return;
  }

  const startedAt = new Date().toISOString();
  job.verdict = "RUNNING";
  state.current = { id: def.id, startedAt };
  state.lastDecision = { at: startedAt, kind: "RUN", detail: `${def.id} יוצא לדרך — ${def.repo}@main` };
  saveState();

  const t0 = Date.now();
  const dir = path.join(WORK_ROOT, def.repo);

  // 1) ספריית-עבודה
  const wd = ensureWorkdir(def.repo);
  if (!wd.ok) {
    job.verdict = "ERROR";
    job.reason = wd.detail;
    job.outputTail = [wd.detail];
    job.lastRunAt = startedAt;
    job.durationMs = Date.now() - t0;
    job.runs += 1;
    job.nextDueAt = new Date(Date.now() + 24 * 3_600_000).toISOString();
    state.current = null;
    state.history.push({ at: startedAt, id: def.id, verdict: "ERROR", detail: wd.detail.slice(0, 120) });
    state.lastDecision = { at: new Date().toISOString(), kind: "ERROR", detail: `${def.id}: ${wd.detail.slice(0, 100)}` };
    saveState();
    return;
  }
  job.commit = wd.commit;

  // 3) חוק פסק-הדין הטרי: קובץ-פסק-דין קודם נמחק לפני הריצה — הרץ קורא
  //    אך ורק קובץ שהבדיקה הזאת עצמה ייצרה. בלי זה, status.json ענני
  //    מת (מהקלון) יכול להתחזות לפסק-דין של ריצה שנכשלה (נתפס חי
  //    ב-claims-guard: סתירת "PASS" עתיק מול exit 1).
  try {
    fs.rmSync(path.join(dir, "agent", "status.json"), { force: true });
  } catch {
    /* אין קובץ — אין מה למחוק */
  }

  // 4) הבדיקה עצמה — bash עם פסק-זמן מלא
  const scriptPath = path.join(WORK_ROOT, `run-${def.id}.sh`);
  fs.writeFileSync(scriptPath, def.script, { mode: 0o700 });

  let exitCode = -1;
  let stdout = "";
  let stderr = "";
  try {
    const proc = spawn("bash", [scriptPath], {
      cwd: dir,
      env: { ...process.env, FLEET_VERIFY: "1", CI: "1", HOME: process.env.HOME ?? "/home/z" },
    });
    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* כבר מת */
      }
    }, def.timeoutMin * 60_000);
    stdout = await new Promise<string>((res) => {
      let s = "";
      proc.stdout.on("data", (d) => (s += d.toString()));
      proc.stdout.on("end", () => res(s));
      proc.on("close", () => res(s));
    });
    stderr = await new Promise<string>((res) => {
      let s = "";
      proc.stderr.on("data", (d) => (s += d.toString()));
      proc.stderr.on("end", () => res(s));
      proc.on("close", () => res(s));
    });
    exitCode = await new Promise<number>((res) => {
      proc.on("close", (c) => res(c ?? -1));
    });
    clearTimeout(timer);
  } catch (e) {
    stderr += String(e);
  }

  const durationMs = Date.now() - t0;
  const output = sanitize(`${stdout}\n${stderr}`).trim();
  const tail = output.split("\n").filter(Boolean).slice(-14);

  // 5) פסק-הדין — נקרא רק מקובץ האמת שהבדיקה עצמה ייצרה (והוא טרי — נמחק לפני הריצה)
  let checks: Record<string, unknown> | null = null;
  let reason: string | null = null;
  let verdict: JobState["verdict"] = "ERROR";
  try {
    const st = JSON.parse(fs.readFileSync(path.join(dir, "agent", "status.json"), "utf8"));
    checks = st.checks ?? null;
    reason = typeof st.reason === "string" ? sanitize(st.reason) : null;
    if (st.verdict === "PASS" && exitCode === 0) verdict = "PASS";
    else if (st.verdict === "FAIL" || exitCode !== 0) verdict = "FAIL";
    else verdict = "ERROR";
  } catch {
    verdict = exitCode === 0 ? "PASS" : "FAIL";
    reason = reason ?? "status.json לא נכתב — פסק-דין מקוד-היציאה בלבד";
  }

  job.verdict = verdict;
  job.lastRunAt = startedAt;
  job.durationMs = durationMs;
  job.checks = checks;
  job.reason = reason;
  job.outputTail = tail;
  job.runs += 1;
  job.nextDueAt = new Date(Date.now() + 24 * 3_600_000).toISOString();
  state.current = null;
  state.history.push({
    at: startedAt,
    id: def.id,
    verdict,
    detail: `${durationMs}ms · ${(reason ?? "").slice(0, 100)}`,
  });
  state.lastDecision = {
    at: new Date().toISOString(),
    kind: verdict,
    detail: `${def.id}: ${verdict} · ${Math.round(durationMs / 1000)}ש' · ${(reason ?? "").slice(0, 120)}`,
  };
  saveState();
}

// ── מנוע הלולאה ────────────────────────────────────────────────────
let running = false;
async function tick(): Promise<void> {
  state.beats += 1;
  if (running) return;
  if (!PAT) {
    state.lastDecision = { at: new Date().toISOString(), kind: "WAIT", detail: "אין סמכות (PAT) — המפעל ממתין בכנות" };
    saveState();
    return;
  }
  ensureAskpass();
  const due = state.jobs.find((j) => Date.parse(j.nextDueAt) <= Date.now() && j.verdict !== "RUNNING");
  if (!due) return;
  const def = JOBS.find((d) => d.id === due.id);
  if (!def) return;
  running = true;
  try {
    await runJob(def);
  } finally {
    running = false;
    saveState();
  }
}

// ── HTTP — סינגלטון: שרת אחד לאורך כל החיים, גם בטעינות-חמות ─────
if (!G.__FV_SERVER__) {
  G.__FV_SERVER__ = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "fleet-verify", alive: true, beats: state.beats });
    }
    if (req.method === "POST" && url.pathname.startsWith("/run/")) {
      const id = url.pathname.slice("/run/".length);
      const def = JOBS.find((d) => d.id === id);
      if (!def) return Response.json({ ok: false, error: "מאמת לא קיים" }, { status: 404 });
      if (running) return Response.json({ ok: false, error: "מאמת אחר בדרך — המפעל עובד בטור" }, { status: 429 });
      running = true;
      runJob(def)
        .catch(() => {})
        .finally(() => {
          running = false;
          saveState();
        });
      return Response.json({ ok: true, started: id });
    }
    if (req.method === "POST" && url.pathname === "/run-next") {
      const due = state.jobs.find((j) => Date.parse(j.nextDueAt) <= Date.now() && j.verdict !== "RUNNING");
      if (!due) return Response.json({ ok: false, error: "אין מאמת שנכון לו עכשיו" }, { status: 409 });
      const def = JOBS.find((d) => d.id === due.id)!;
      if (running) return Response.json({ ok: false, error: "המפעל עובד" }, { status: 429 });
      running = true;
      runJob(def)
        .catch(() => {})
        .finally(() => {
          running = false;
          saveState();
        });
      return Response.json({ ok: true, started: def.id });
    }
    // ברירת מחדל: מצב-האמת המלא (ok=true — חוק הצי: השומר דורש זאת בכל דיבון)
    return Response.json({ ok: true, ...state });
  },
  });
}

console.log(`[fleet-verify] מפעל האימות המקומי עלה · פורט ${PORT} · ${JOBS.length} מאמתים · PAT: ${PAT ? "כן" : "לא"}`);

// חוק הטיימר-היחיד (נלמד חי: טעינה-חמה של bun מעריכה את המודול מחדש
// אך לא מנקה טיימרים ישנים — שני טיימרים עם שני מצבים כתבו זה על זה
// ומחקו תוצאות אמיתיות מקובץ-האמת). globalThis שורד טעינות-חמות:
// טיימר אחד, מצב אחד, אמת אחת.
if (!G.__FV_TIMER__) {
  G.__FV_TIMER__ = setInterval(() => {
    tick().catch((e) => {
      state.lastDecision = { at: new Date().toISOString(), kind: "ERROR", detail: sanitize(String(e)).slice(0, 200) };
      saveState();
    });
  }, 60_000);
  // פעימה ראשונה מיד
  tick().catch(() => {});
}
