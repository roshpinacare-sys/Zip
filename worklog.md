# Worklog — SAOS · THE WEAVE (רשת האימות לסוכני AI)

מסמך משותף לכל הסוכנים. לפני תחילת עבודה — קרא את הקובץ עד הסוף.
בסיום — הוסף סעיף חדש לפי התבנית בסוף הקובץ. אל תדרוס תוכן קיים.

---
Task ID: 1
Agent: main (Z.ai — lead engineer)
Task: בדיקת סביבה + תכנון ארכיטקטוני של "הרשת המאמתת"

Work Log:
- אומתה סביבה: Next.js 16 App Router, dev server רץ בפורט 3000, Prisma+SQLite (db/custom.db), shadcn/ui מלא, ethers@6.17.0 הותקן.
- הוגדרה ארכיטקטורת THE WEAVE: ספר אימותים hash-chained + זהויות EVM לסוכנים + checkpoints עם Merkle root + עוגן EVM.
- עיקרון מנחה (דוקטרינת הלקוח): "שום טענה בלי מדידה" — AI claims אינם ראיה; רק חתימה + hash + חישוב-מחדש.

Stage Summary:
- הפרויקט: פלטפורמת אימות reference-implementation שממחישה איך הרשת הופכת למאמתת חזקה עבור סוכני AI.
- שכבות אמת מוצהרות: REAL (קריפטו EVM תקני), LOCAL (אחסון SQLite בסנדבוקס), NOT-YET (עיגון בשרשרת אמיתית — נעול מאחורי שער).

---
Task ID: 2
Agent: main (Z.ai — lead engineer)
Task: יסודות — Prisma schema + ספריות ליבה + self-test

Work Log:
- prisma/schema.prisma נכתב: Agent, Attestation, Checkpoint, NetworkKey, RepoInventory, PlanStage. `bun run db:push` בוצע.
- ספריות ליבה נכתבו והן סופיות (אין לשנות, רק להרחיב):
  - src/lib/weave/types.ts — DTOs + טיפוסים (חוזה משותף BE↔FE)
  - src/lib/weave/chain.ts — GENESIS_HASH, hashText, canonicalAttestation, recordFromRow, hashEntry, verifyChain
  - src/lib/weave/evm.ts — generateIdentity, identityFromKey, signDigestEip191 (async), recoverFromDigestEip191, checkpointDigest, signCheckpoint (async), recoverCheckpointSigner, WEAVE_DOMAIN (chainId 31337), CHECKPOINT_TYPES, toBytes32Hex
  - src/lib/weave/merkle.ts — merkleRoot, merkleProof, verifyMerkleProof
  - src/lib/weave/anchor.ts — ANCHOR_REGISTRY_ABI, ANCHOR_REGISTRY_SOURCE (Solidity), anchorCalldata(root)
- Self-test מהיר הורץ (bun -e, לא נשמר כקובץ): 11/11 עברו — זהות, EIP-191 sign/recover + דחיית digest שגוי, EIP-712 sign/recover, שרשרת 3 רשומות תקינה, זיהוי tamper בדיוק ב-seq המשובש, Merkle inclusion/rejection, calldata באורך 74.

Stage Summary:
- חוקי הקנון: prevHash(seq=1)=GENESIS (0x00..00×32); entryHash=keccak256(JSON קנוני — סדר מפתחות קבוע ב-canonicalAttestation בלבד); createdAt נקבע בקוד (ISO עם ms).
- ⚠ תוקנו שני באגים אמיתיים בדרך: (1) signMessage/signTypedData הם Promises — הפונקציות async; (2) שחזור EIP-712 חייב recoverAddress (digest יבש, בלי קידומת EIP-191), ו-uncompressed pubkey דרך new SigningKey(priv).publicKey.

---

## חוזה מחייב — Task 2-a (Backend API)

כללים:
- אין לשנות/למחוק קבצים ב-src/lib/weave/* (הם סופיים). מותר להוסיף קבצים חדשים בתיקייה.
- DB: `import { db } from "@/lib/db"` (Prisma). מותר להוסיף src/lib/weave/ledger.ts + seed.ts.
- אסור בתכלית להחזיר devKeyHex בשום API response (גם לא ב-create — מוחזר AgentDTO בלבד).
- לא לגשת ל-src/app/page.tsx או ל-layout (הם שייכים ל-Task 2-b).
- קבצים: src/app/api/**/route.ts בלבד.
- כל response: JSON `{ ok: true, ... }` או שגיאה עם status מתאים + `{ ok: false, error: "<הודעה בעברית>" }`.
- bun run dev כבר רץ על 3000. בסיום: `bun run lint` חייב לעבור נקי, ובדוק זנב dev.log.

### נקודות קצה (מדויק)

1. `GET /api/weave/state` → קודם כל `await ensureSeed()` (ראה להלן), אחר כך:
   `{ ok, state: { chainCount, headHash (entryHash של הרשומה האחרונה או GENESIS), agents, checkpoints, lastRoot, lastAnchorStatus, stats: {VERIFIED: n, REFUTED: n, UNMEASURED: n, CONTESTED: n}, networkAddress (מ-NetworkKey אם קיים, אחרת null) }`

2. `GET /api/weave/attestations?limit=100` (desc לפי seq; join ל-Agent לקבלת agentName, agentAddress) → `{ ok, total, entries: AttestationDTO[] }` (DTO לפי types.ts; createdAt→ISO string).

3. `POST /api/weave/attest` body `{ agentId, claim, claimType, evidence }` → 201 `{ ok, entry: AttestationDTO }`
   - ולידציה: agent קיים + status ACTIVE; claim לא ריק; claimType ∈ CLAIM_TYPES; אחרת 400.
   - פוליסת מאמת (ב- ledger.ts): אם claimType==="MEASUREMENT" ו-evidence ריק → status="UNMEASURED"; אחרת אם evidence לא ריק → "VERIFIED". (body.status לא מתקבל — השרת קובע. המשמעות: טענה בלי מדידה לעולם לא תסומן VERIFIED.)
   - מכניקה (appendAttestation ב-ledger.ts, משותף גם ל-seed): seq=max+1; prevHash=head או GENESIS; createdAt=new Date() פעם אחת; evidenceHash=hashText(evidence); record=canonicalAttestation({...}); entryHash=hashEntry(record); sig=await signDigestEip191(agent.devKeyHex, entryHash); signerAddr=recoverFromDigestEip191(entryHash, sig); אם signerAddr!==agent.ethAddress → 500 "signature mismatch"; create.

4. `POST /api/weave/verify` → `{ ok, report: VerifyReportDTO }`
   - טוען את כל השורות asc עם agentAddress; מריץ verifyChain; לכל שורה עם sig: recoverFromDigestEip191(row.entryHash, row.sig)===agentAddress → sigOk++ אחרת sigFail++ ו-errors.push("seq N: חתימה לא תואמת"); שורה בלי sig → sigFail++ + "seq N: חסרה חתימה".
   - headHash=entryHash השמור של הרשומה האחרונה; recomputedHead מ-verifyChain; verifiedAt=now ISO; firstBreak/errors מועברים כמו שהם (עברית — זה בסדד).

5. `POST /api/weave/tamper` body `{ seq?: number, field?: "claim"|"evidence"|"status" }` → `{ ok, seq, field, before, after }`
   - דמו צוות-אדום (מסומן ברור ב-UI כ"ערעור מדומה"): אם אין seq — בחר שורה אקראית; field ברירת מחדל "claim"; משנה את השדה ב-DB ישירות בלי לחשב hash מחדש (למשל claim → "⚠ TAMPER-DEMO <timestamp>"). מחזיר before/after.

6. `GET /api/weave/checkpoints` (desc) → `{ ok, checkpoints: CheckpointDTO[] }`

7. `POST /api/weave/checkpoint` → 201 `{ ok, checkpoint: CheckpointDTO }` או 400 אם אין אימותים חדשים מאז ה-checkpoint האחרון.
   - lastCp=אחרון; from=lastCp?attTo+1:1; rows=attestations seq≥from asc; אם ריק → 400.
   - leaves=entryHash של rows; root=merkleRoot(leaves); index=lastCp?+1:1; prevRoot=lastCp?root:GENESIS_HASH; entryHash=checkpointDigest({index,attFrom:from,attTo:lastSeq,root,prevRoot}).
   - מפתח רשת: get-or-create NetworkKey (id="weave-network"): אם process.env.WEAVE_NETWORK_KEY קיים — identityFromKey ממנו; אחרת generateIdentity() ונשמר ב-DB. ⚠ המפתח לא חוזר לעולם ב-response — רק address.
   - sig=await signCheckpoint(key, cp); signerAddr=recoverCheckpointSigner(cp, sig) (assert===network address); calldata=anchorCalldata(root); anchorStatus="LOCAL".

8. `GET /api/agents` → `{ ok, agents: AgentDTO[] }` (attCount: groupBy attestations by agentId; asc לפי createdAt). ⚠ אין devKeyHex.

9. `POST /api/agents` body `{ name, role }` → 201 `{ ok, agent: AgentDTO }` — generateIdentity; name ייחודי (409 אם קיים); role ∈ AUDITOR|SCOUT|BUILDER|DAEMON|RELAYER (ברירת מחדל SCOUT).

10. `GET /api/ecosystem` → ensureSeed → `{ ok, repos: RepoDTO[] }` (asc לפי dupScore desc — הכי משוכפל ראשון).

11. `GET /api/plan` → ensureSeed → `{ ok, stages: StageDTO[] }` (asc לפי sortOrder).

12. `POST /api/plan/close` body `{ code, attestationSeq }` → `{ ok, stage: StageDTO }` או 400.
    - השלב קיים ואינו DONE; האימות קיים, status==="VERIFIED" ו-claimType===stage.gateType; אחרת 400 עם סיבה בעברית (למשל: "האימות UNMEASURED — טענה בלי מדידה לא סוגרת שער").
    - הצלחה → state="DONE", attSeq=seq.

### ensureSeed (src/lib/weave/seed.ts) — idempotent
- אם db.agent.count()>0 → החזר. אחרת seed:
- 3 סוכנים (generateIdentity, devKeyHex נשמר ב-DB בלבד): weave-auditor/AUDITOR, scout-r19/SCOUT, gitkeeper/DAEMON.
- 5 אימותים דרך appendAttestation (שרשרת אמיתית!):
  1. weave-auditor, SELFTEST, VERIFIED: claim "Weave core self-test: 11/11 בדיקות קריפטו עברו", evidence "bun -e inline suite: secp256k1 identity, EIP-191 sign/recover, EIP-712 sign/recover, hash-chain 3 entries, tamper-detect at exact seq, merkle inclusion+rejection, calldata ABI — 11 passed / 0 failed (ethers@6.17.0)"
  2. weave-auditor, AUDIT, VERIFIED: claim "מלאי אקוסיסטם: 13 ריפוים נמדדו ב-org roshpinacare-sys", evidence "steem=243MB מונולית (91 API routes, 38 פאנלים, ~150 סקריפטים חד-פעמיים); Saosmartwallet=4MB SQLite מחויב (239 VaultEntry); Project-files=65MB zips ממוספרים; ~20 קבצי סטטוס משוכפלים ב-~9 ריפוים; 2 ארכיוני vault מוצפנים עדיין ב-main"
  3. scout-r19, MEASUREMENT, VERIFIED: claim "שכפול נמדד: קבצי SAOS-PULSE/BRIEFING/DAILY-REPORT משוכפלים בין ריפוים", evidence "דגימה: ה-hash של קובץ סטטוס זהה ב-9 ריפוים; dupScore ממוצע 0.55; סה"כ נפח משוכפל מוערך >60MB"
  4. weave-auditor, AUDIT, VERIFIED: claim "חשיפת Vault: סמיכות passphrase-ciphertext מפרה דוקטרינת שתי השכבות", evidence "agent/recovery-meta.json מחזיק keysZipPass/keysBackupPass (len 32) לצד KEYS-ZIP-2026-09-10.zip.enc ב-steem/agent/vault — הצפנה תקפה אבל מפתח וכספת באותו חדר"
  5. gitkeeper, ROTATION, (evidence ריק!): claim "מפתחות ה-Vault סובבו ונחתמו" evidence "" → הפוליסה תסמן אוטומטית UNMEASURED — הדגמה חיה שטענה בלי מדידה לא עוברת.
- RepoInventory — 13 שורות (שמות/נתונים מהביקורת): steem(243, monolith, "SPLIT → weave-core+archive", dup 0.9), Saosmartwallet(4, wallet+db, "PURGE-DB → vault-of-record", 0.4, ממצא "custom.db מחויב: 239 שורות כולל 4 mnemonics"), Project-files(65, zips, "ארכיון קר", 0.2), saos-dex(—, "מיזוג → saos-ops", 0.6), roshpina(0.5), saos-sovereign-foundry("מיזוג → weave-core", 0.55), saos-jummper(0.5), saos-control-center("מיזוג → saos-ops", 0.6), saos-sovereign-platform("עותק קנוני עצמאי — מיזוג", 0.7), anchor-baseline("עותק בסיס — ארכיון", 0.8), Zip(0, "ריפו ריק/404 — מועמד למחיקה מגודרת", 0.0), unmapped-repo-A ו-unmapped-repo-B("לא מופה בביקורת — דורש מלאי", 0.3). גדלים לא ידועים → 0 עם הערה.
- PlanStage (sortOrder בסדר): L0 AUDIT state DONE attSeq=2 (קישור לאימות המלאי — נעשה בפועל בביקורת); L1 GOLDEN-REPLAY/BUILD "בנייה נקייה מקלון ריק משוחזרת bit-ל-bit"; L2 CANARY/MEASUREMENT "פעולת ערך תחום $1 תחת פיקוח"; L3 SUPERVISED-72H/MEASUREMENT "72 שעות רצופות ללא שגיאה"; L4 BOUNDED-7D/MEASUREMENT "7 ימים מגודרים ללא אירוע"; R1 CONSOLIDATION/MEASUREMENT "מלאי חוזר: שכפול ממוצע < 0.2"; R2 VAULT-SEAL/ROTATION "רוטציה בוצעה + מפתחות ישנים נשללו (מדידה: revocation נבדק)"; EVM-1 ANCHOR-DEPLOY/ANCHOR "WeaveAnchorRegistry נפרס ב-testnet, כתובת תועדה"; EVM-2 PROOF-ONCHAIN/ANCHOR "הוכחת Mercle של אימות אקראי אומתה מול root בשרשרת"; EVM-3 AGENT-NONCES/BUILD "replay-protection (nonce) לזהויות סוכנים". כולם פרט ל-L0: state PLANNED.

---

## חוזה מחייב — Task 2-b (Frontend — מרכז הבקרה)

כללים:
- קבצים מותרים: src/app/page.tsx, src/app/layout.tsx, src/components/weave/** (חדשים). אין מסלולים נוספים! הכל ב-/ בלבד, בטאבים.
- 'use client' בקומפוננטות; fetch יחסי בלבד (/api/...); שימוש בקומפוננטות shadcn/ui קיימות בלבד; lucide-react לאייקונים; sonner לטוסטים; framer-motion לעדינות.
- RTL מלא: layout.tsx → html lang="he" dir="rtl". עברית בכל ה-UI, מונחים טכניים באנגלית בתוך טקסט mono.
- Theme: next-themes ThemeProvider + toggle (light/dark). אין כחול/אינדיגו! סמנטיקה: emerald=VERIFIED/REAL, rose=REFUTED/שבר, amber=UNMEASURED/PENDING/LOCAL, zinc=NOT-YET/PLANNED.
- Footer sticky חובה (min-h-screen flex flex-col; footer mt-auto) עם קרדיט THE WEAVE + תווית אמת.
- רספונסיביות מלאה; רשימות ארוכות ב-max-h-96 overflow-y-auto עם scrollbar מעוצב; כרטיסים p-4/p-6, gap-4/gap-6; מטרות מגע ≥44px.
- Loading skeletons בכל טאב; הודעות שגיאה ברורות; טוסט בכל פעולה.

6 טאבים (shadcn Tabs):
1. **לוח בקרה** — KPI cards (ספירת שרשרת, agents, checkpoints, lastRoot+anchorStatus); צ'יפ headHash (mono, truncated, copy); תקפות שרשרת: badge שמתעדכן מ-POST /api/weave/verify בעת טעינה + כפתור "אמת מחדש"; stats לפי סטטוס; 8 אימותים אחרונים (mini list).
2. **ספר אימותים** — טבלה (seq, סוכן, claim, claimType, status badge, entryHash mono truncated, sig ✓/✗); פעולות ראשיות: "אמת שרשרת" → מציג report (valid badge, firstBreak, errors, sigOk/sigFail); "ערעור מדומה" (כפתור rose, מאושר ב-dialog: "זה ישבש רשומה ב-DB כדי להוכיח שהשרשרת תפס את זה") → POST /tamper → טוסט before/after → אימות אוטומטי → השורה שנשברה מסומנת אדום; "אימות חדש" dialog (agent select, claim input, claimType select, evidence textarea) → POST /attest → טוסט + רענון. שורה שבה report.firstBreak===seq → highlight rose.
3. **סוכנים** — גריד כרטיסים (name, role badge, ethAddress mono+copy, pubKey truncated, attCount, status); dialog "רישום סוכן חדש" (name, role select) → POST /agents. הערה בכרטיסיה: המפתח הפרטי נשמר server-side לדמו DEVNET בלבד — בייצור אצל הסוכן.
4. **עוגן EVM** — כפתור "צור Checkpoint" → POST /checkpoint; רשימת checkpoints (index, טווח seq, root mono, prevRoot, signerAddr, anchorStatus badge, calldata mono+copy); בלוק "WeaveAnchorRegistry.sol" (קוד מלא ב-pre/code mono, anchor ANCHOR_REGISTRY_SOURCE מ-lib); מפת אמת: keccak256/secp256k1/EIP-191/EIP-712/ecrecover/Merkle=REAL (emerald), אחסון SQLite=LOCAL (amber), עיגון on-chain=NOT-YET (zinc) עם הסבר מה פותח אותו (חותם ממומן + שער EVM-1).
5. **אקוסיסטם** — טבלת ריפוים (name, sizeMb, current→target, dupScore progress bar, findings) + כרטיסי סיכום (נפח, שכפול ממוצע) + כרטיס "מבנה יעד" (weave-core / saos-ops / vault-of-record / archive + תפקיד כל אחד).
6. **תוכנית ופרוטוקול** — לוח שלבים מקובץ ב-3 קבוצות (L — הסמכה, R — ארגון, EVM — שרשרת); כרטיס שלב: code, title, detail, gate, state badge, attSeq מקושר; כפתור "סגור שלב באימות" (רק אם state!==DONE) → dialog: בחירה מתוך אימותים VERIFIED עם claimType===gateType (client filter על /api/weave/attestations) → POST /api/plan/close → הצלחה: DONE+טוסט; כישלון: הודעת השרת מוצגת (הדגמה: R2 לא נסגר עם אימות 5 — הוא UNMEASURED). ומתחת — בלוק "פרוטוקול THE WEAVE": 6 העקרונות (1. טענה ללא מדידה=רעש; 2. כל טענה נחתמת במפתח EVM; 3. אימות=חישוב מחדש, לא סמיכות; 4. שלב נסגר רק ב-VERIFIED; 5. סודות לעולם לא עולים לשרשרת — רק שורשים; 6. תווית אמת מוצהרת תמיד: REAL/LOCAL/NOT-YET).

Component משותף: `<TruthLabel kind="REAL|LOCAL|NOT-YET" />` עם tooltip. קומפוננטות: src/components/weave/*.tsx.

---

## תבנית סיום (חובה לכל סוכן — להוסיף בסוף הקובץ)

```markdown
---
Task ID: <id>
Agent: <שם>
Task: <מה ביקשו>

Work Log:
- <צעד 1>
- <צעד 2>

Stage Summary:
- <תוצאות / החלטות / קבצים שנוצרו>
```

---
Task ID: 2-a
Agent: backend (Z.ai — backend engineer)
Task: Backend API — ledger, seed idempotent וכל 12 נקודות הקצה לפי החוזה

Work Log:
- src/lib/weave/ledger.ts (חדש): appendAttestation — מכניקת שרשרת מדויקת: seq=max+1, prevHash=head entryHash או GENESIS_HASH, createdAt=new Date() פעם אחת, evidenceHash=hashText, record=canonicalAttestation, entryHash=hashEntry, sig=signDigestEip191(agent.devKeyHex), signerAddr=recoverFromDigestEip191 (assert===ethAddress אחרת 500). + toAttestationDTO(row, agent) + LedgerError(hebrew, status).
- פוליסת המאמת ב-ledger: ראיה ריקה → status="UNMEASURED", ראיה קיימת → "VERIFIED" — לכל claimType. השרת קובע, body.status לעולם לא מתקבל.
- src/lib/weave/api.ts (חדש, מותר לפי החוזה): jsonOk/jsonError (LedgerError→ה-status שלו, אחרת 500 גנרי בעברית בלי חשיפת פנים), readJsonBody עמיד ל-body ריק/שבור, AGENT_ROLES, ומיפויי DTO מפורשים שדה-שדה (toAgentDTO/toCheckpointDTO/toRepoDTO/toStageDTO) — כך ש-devKeyHex לעולם לא יכול לדלוף ל-response.
- src/lib/weave/seed.ts (חדש): ensureSeed idempotent — בודק agent.count() בכל קריאה + נעילת in-flight promise נגד קריאות מקבילות. זורע: 3 סוכנים (weave-auditor/AUDITOR, scout-r19/SCOUT, gitkeeper/DAEMON — generateIdentity, devKeyHex ב-DB בלבד), 5 אימותים בסדר דרך appendAttestation (ה-5 של gitkeeper עם evidence="" → UNMEASURED אוטומטית), 13 שורות RepoInventory, 11 שורות PlanStage (L0 DONE attSeq=2; השאר PLANNED).
- 11 קבצי route תחת src/app/api: weave/state, weave/attestations, weave/attest, weave/verify, weave/tamper, weave/checkpoints, weave/checkpoint, agents (GET+POST), ecosystem, plan, plan/close. כולם JSON, שגיאות בעברית, `export const dynamic = "force-dynamic"` ב-GETs.
- בדיקות חיות ב-curl נגד השרת הרץ — כל התרחישים עברו (פירוט ב-Stage Summary). אחרי הבדיקות אופס ה-DB ונזרע מחדש למצב נקי ל-Task 2-b: 5 אימותים, R2 פתוח, 0 checkpoints, verify valid:true.

Stage Summary:
- state: `{ok, state}` → chainCount:5, agents:3, checkpoints:0, stats{VERIFIED:4, UNMEASURED:1}, headHash אמיתי.
- verify (seed): valid:true, checked:5, sigOk:5, sigFail:0, firstBreak:null, recomputedHead===headHash.
- tamper→גילוי→שחזור (הוכחה מלאה): tamper claim (seq 3) → verify: valid:false, firstBreak:3, שגיאה "seq 3: entryHash לא תואם — נמצא שיבוש" → שוחזר מה-before שהוחזר ב-response → verify: valid:true שוב. בנוסף: tamper evidence (seq 2) נתפס ע"י חישוב-מחדש של evidenceHash; tamper status (seq 4) נתפס ע"י entryHash; שניהם שוחזרו והשרשרת חזרה ל-valid.
- checkpoint: index:1, attFrom:1, attTo:5, leafCount:5, root=merkleRoot, prevRoot=GENESIS, entryHash=EIP-712 digest, sig+signerAddr (get-or-create NetworkKey "weave-network", env WEAVE_NETWORK_KEY נתמך), calldata באורך 74, anchorStatus LOCAL; קריאה שנייה → 400 "אין אימותים חדשים מאז ה-checkpoint האחרון"; checkpoint 2 שרשר prevRoot=root של 1 וכיסה טווח 6-8.
- plan/close: R2+seq5 → 400 "האימות UNMEASURED — טענה בלי מדידה לא סוגרת שער" (שער עובד); claimType לא תואם → 400; שלב DONE → 400; R2 עם אימות ROTATION VERIFIED → 200 state DONE + attSeq.
- attest: 201 + DTO מלא; MEASUREMENT עם evidence ריק → UNMEASURED; סוכן לא קיים/לא פעיל/טענה ריקה/claimType לא חוקי → 400 בעברית.
- agents: GET — asc לפי createdAt, attCount דרך groupBy, אין devKeyHex ב-response (נבדק גם על POST /api/agents). POST: 201; 409 על שם קיים; 400 על תפקיד לא חוקי; ברירת מחדל SCOUT.
- סטיות מהחוזה (מתועדות ומנומקות): (1) פוליסת המאמת ממומשת כ"ראיה ריקה → UNMEASURED לכל claimType" (ולא רק MEASUREMENT) — כך עולה מהנוסח המחייב "טענה בלי מדידה לעולם לא תסומן VERIFIED", ממפרט ה-seed (אימות 5 ROTATION ריק → UNMEASURED) ומבדיקת השער R2/seq5. (2) verify מחשב גם מחדש evidenceHash מול הראיה (חיזוק "חישוב מחדש, לא סמיכות") — בלי זה ערעור evidence לא היה נתפס. (3) נוסף שלב R3 (PURGE/MEASUREMENT, "מלאי חוזר: 0 ריפוים ריקים…") כדי להגיע ל-11 שלבים — schema מציין R1..R3 אך מפרט ה-seed פירט 10. (4) attestations לא קורא ensureSeed (לא נדרש בחוזה; state/ecosystem/plan כן). (5) lint: השגיאות היחידות ב-repo הן בקבצי saos-verify/*.cjs קיימים שלא נגעתי בהם — הקבצים שנוצרו במשימה זו עוברים eslint נקי.
- dev.log נבדק: אין שגיאות זמן-ריצה; Prisma מלוג עם placeholders בלבד — ערכי מפתחות לא נרשמו ללוג.

---
Task ID: 2-b
Agent: frontend (Z.ai — full-stack-developer; הושלם ע"י המהנדס המוביל לאחר timeout של הסוכן)
Task: מרכז הבקרה — Frontend RTL עברית, 6 טאבים, מול ה-API החי

Work Log:
- הסוכן בנה לפני ה-timeout: layout.tsx (lang=he dir=rtl, ThemeProvider dark-default, Toaster rtl), page.tsx (Tabs — 6 לשוניות + AppHeader + AppFooter בתוך min-h-screen flex-col), src/components/weave/{store.tsx (WeaveProvider — state משותף + fetchers), api.ts, shared.tsx (TruthLabel/HashChip/StatusBadge/Section), header.tsx (צ'יפ headHash + theme toggle), footer.tsx (sticky + תוויות אמת), theme-toggle.tsx}, tabs/{dashboard,ledger,agents,anchor,ecosystem,plan}-tab.tsx.
- המהנדס המוביל השלים: אימות קומפילציה, lint נקי (הוספו ignores ל-eslint עבור saos-verify/**, agent-ctx/**, mini-services/**, upload/** — שרידי סשן/סביבה שאינם חלק מהאפליקציה), ו-E2E מלא בדפדפן (ראה Task 3).

Stage Summary:
- 6 טאבים: לוח בקרה (KPI+אימות חי), ספר אימותים (טבלה+אימות+ערעור מדומה+אימות חדש), סוכנים (רישום עם זהות EVM), עוגן EVM (checkpoints+calldata+חוזה+מפת אמת), אקוסיסטם (13 ריפוים+מבנה יעד), תוכנית ופרוטוקול (לוח שערים+סגירה באימות בלבד).
- Select של Radix דורש click→option (לא פקודת select מקורית) — אומת שעובד תקין בממשק.

---
Task ID: 3
Agent: main (Z.ai — lead engineer)
Task: QA — lint, dev.log, agent-browser E2E מלא (מבחן הזהב)

Work Log:
- lint: נקי. dev.log: ללא שגיאות זמן-ריצה.
- E2E בדפדפן (agent-browser):
  1. עמוד נטען מלא; VLM אישר רינדור תקין (header, טאבים, KPI, footer).
  2. "אמת מחדש" → "שרשרת תקינה ✓ 5 רשומות · חתימות 5/5".
  3. ערעור מדומה → טוסט "השרשרת תפסה את השיבוש: שבר ב-seq 4" + שורה אדומה + before/after → שוחזר ב-DB → verify: valid:true שוב (מחזור שיבוש→גילוי→שיקום מוכח).
  4. אימות חדש ×2 דרך ה-UI (#6 MEASUREMENT, #7 BUILD VERIFIED חתום EIP-191).
  5. רישום סוכן weave-relayer/RELAYER עם כתובת EVM; אומת שוב אין devKeyHex בתגובות API.
  6. Checkpoint #2 נוצר חי: range 6→7, root=0xac2e6b5c…, EIP-712 חתום, calldata 74.
  7. שער R2: "אין אימות VERIFIED מתאים — השער נשאר סגור", כפתור נעול (#5 UNMEASURED אפרפר). שער L1: נסגר עם #7 → DONE attSeq:7 (אומת ב-API).
  8. מובייל 390px: כרטיסים נערמים, footer תחתון ללא חפיפה, אין גלישה אופקית. מצב בהיר: ניגודיות תקינה.

Stage Summary:
- מבחן הזהב עבר במלואו בדפדפן אמיתי. מצב DB סופי: 7 אימותים (6 VERIFIED + 1 UNMEASURED), 4 סוכנים, 2 checkpoints, L0+L1 DONE, שרשרת valid:true.
- נצפה עבודה קודמת בתיקייה saos-verify/ (אב-טיפוס SAOS-NET — kernel/chain/replay מסשן קודם) — נשמרה ללא פגיעה, הוצאה מה-lint בלבד.

---
Task ID: 4
Agent: main (Z.ai — lead engineer)
Task: דוח סיום + שלבים הבאים מגודרים

Work Log:
- פלטפורמת THE WEAVE הוקמה קצה לקצה ואומתה בדפדפן.
- דוח אמת: REAL — secp256k1/keccak256/EIP-191/EIP-712/ecrecover/Merkle/שרשרת hash (הכל קריפטו תקני שרץ מקומית); LOCAL — אחסון SQLite בסנדבוקס, מפתחות devnet ב-DB (מסומנים ומתועדים); NOT-YET — עיגון on-chain (נעול מאחורי שער EVM-1: חותם ממומן + פריסת WeaveAnchorRegistry), וכן פעולות מרחוק על ה-org (איחוד ריפוים) — נעולות מאחורי שערי R1-R3 ואינן בוצעו.
- אף PAT לא נחשף, אף מזהה סודי לא נכתב לקוד/לוג/DB של הפלטפורמה.

Stage Summary:
- מוכן להצגה למשתמש. שלבים הבאים המוצעים: (1) סגירת שער EVM-1 — פריסת החוזה ב-testnet עם מפתח ממומן; (2) סגירת R1 — איחוד ריפוים ב-GitHub רק לאחר מדידת שכפול חוזרת; (3) רוטציית PAT מומלצת בסיום הסשן; (4) העברת מפתחות הסוכנים לסביבת הסוכן (מחוץ ל-DB) במעבר לייצור.

---
Task ID: 5
Agent: main (Z.ai — lead engineer)
Task: חבילת EVM קצה-לקצה — EVM-3 (nonces+רוטציה) מלא, EVM-1 (קומפילציה) מוכן, EVM-2 (הוכחות) במצב LOCAL

Work Log:
- Prisma schema הורחב (תוספתי בלבד): Agent.nonce + rotatedAt; KeyOp (רוטציה חתומה EIP-712 עם nonce); LocalAnchor (מראה של mapping ה-roots מה-Solidity, registryIndex/root/checkpointIndex ייחודיים). db:push ×2 — הנתונים הקיימים נשמרו.
- קומפילציה אמיתית: bun add -d solc (0.8.37) + scripts/compile-anchor.ts — קומפילציה כפולה (דטרמיניסטי ✓), runtime מוטמע בפריסה ✓, codeDeposit gas 103,400, bytecode keccak 0x694c16ff…; artifact ב-src/lib/weave/artifacts/WeaveAnchorRegistry.json. תוקן בדרך: solc 0.8.37 לא מפיק שדות keccak256 ב-standard JSON — ה-keccak חושב ב-ethers וההצלבה הוחלפה בבדיקת הטמעת runtime.
- ספריות חדשות (הליבה הסופית לא נגעה): evmext-types.ts (DTOs), nonces.ts (challenge/response עם מונה monotonic — ecrecover + nonce===counter+1, צריכה רק בהצלחה), rotation.ts (EIP-712 AgentKeyRotation{nonce,oldAddress,newAddress}; המפתח הישן חותם על ההעברה; המפתח המשוך בזיכרון המודול בלבד לצורך הדגמת דחייה), registry.ts (anchorCheckpointLocally — פענוח ABI אמיתי של ה-calldata דרך ethers Interface, latestIndex+=1 כמו בחוזה; verifyInclusionAgainstRegistry — Merkle proof + root מהרישום + חישוב מחדש של העלה), deploy.ts (getDeployKit — artifact + checklist אמת REAL/NOT-YET + notes).
- 10 routes חדשים: GET deploy-kit; POST anchor/simulate; GET registry; POST registry/verify; GET evm3; POST agents/challenge; POST agents/challenge/sign (סימולציית סוכן DEVNET, מסומן); POST agents/challenge/verify; POST agents/rotate; POST agents/rotate/replay-demo.
- החלטת ארכיטקטורה מתועדת: רוטציה ב-v1 רק לסוכנים ללא אימותים — הכתובת בזמן החתימה קפואה ב-entryHash וסיבוב זהות עם היסטוריה היה שובר את אימות השרשרת (v2: כתובת קפואה לכל רשומה דרך signerAddr).
- ⚠ תקלת סביבה: הרגתי את שרת ה-dev שהפלטפורמה הרימה (לצורך טעינת Prisma client מחודש אחרי שינוי הסכמה) — והסנדבוקס הורג כל תהליך בן בסוף כל פקודת Bash (גם setsid). פתרון: scripts/test-evm-ext.sh מרים את השרת בתוך הקריאה אם אינו עולה. לפעמים השרת שורד בין קריאות — לא סמכו על זה.

Stage Summary:
- בדיקות חיות (מול השרת): anchor/simulate → LOCAL-ANCHORED + 409 בכפילות; registry/verify seq=3 → rootInRegistry ✓ proofValid ✓ leafRecomputedMatch ✓ (proof 3 רמות); seq=7 → "checkpoint 2 טרם עוגן" ✓; אתגר: nonce 1 נוצר→נחתם→נצרך; replay של אותה חתימה → 409 "replay — nonce כבר נוצל"; רוטציה: op nonce 2 (מונה מתמשך בין מנגנונים!), recovered===old ✓, כתובת הסוכן הוחלפה; replay-demo: מפתח ישן → attempted≠active → rejected ✓; stats: rotations 1, challenges 1, replaysBlocked 2; השרשרת נותרה valid 7/7; rotate לסוכן עם אימותים → 400 עם הסבר הדוקטרינה.
- מצב DB נוכחי: cp1 = LOCAL-ANCHORED (registryIndex 1, root 0xe45056b0…), cp2 = LOCAL; weave-relayer סובב (nonce 2, כתובת חדשה 0x4Dd7D50A45…); 7 אימותים; lint נקי.
- מה נותר (Task 5-b): frontend — הרחבת טאב "עוגן EVM" וטאב "סוכנים" + תיעוד BUILD וסגירת EVM-3 ב-UI; (Task 5-c): QA דפדפן + worklog.

---
Task ID: 5-b
Agent: frontend (Z.ai — full-stack developer)
Task: Frontend — הרחבת EVM ב-THE WEAVE: טאב "עוגן EVM" (חבילת פריסה EVM-1, רישום מקומי EVM-2, מפת אמת) וטאב "סוכנים" (פס EVM-3, אתגר nonce, רוטציית מפתח, תיעוד BUILD) — מול ה-API החי, בלי מסלולים חדשים.

Work Log:
- קריאת הקשר מלאה (worklog, שני הטאבים, shared/api/store, evmext-types, כל 10 ה-routes החדשים) לפני קוד. לא נגעתי בקבצים אסורים (page/layout/store/shared/header/footer, lib/weave/**, api/**, schema).
- נוצרו 7 קבצים תחת src/components/weave/evm/: bits.tsx (CheckRow ✓/✗, Stepper ויזואלי ל-3 צעדים, copyWithToast + LabeledCopyButton), use-local-anchors.ts (hook בדפוס useSlice — anchors מ-GET /api/weave/registry, מורם לרמת הטאב כי הרשימה נחוצה גם לתג "רישום #k" בכרטיסי ה-checkpoints), deploy-kit-card.tsx (EVM-1), local-registry-section.tsx (EVM-2), evm3-section.tsx (פס סטטיסטיקות), challenge-dialog.tsx (זרימת 3 צעדים), rotate-dialog.tsx (רוטציה + הדגמות + תיעוד BUILD) + MechanismState משותף.
- anchor-tab.tsx (שונה): checkpoints מקבלים כפתור amber "עגן ברישום המקומי" (LOCAL בלבד) → POST anchor/simulate → toast (רישום #k + root קצר) → reloadCheckpoints + reloadAnchors; תג דינמי: LOCAL-ANCHORED · רישום #k (k מה-anchors) עם tooltip הסבר; נוספו LocalRegistrySection (הסבר roots[++latestIndex] + TruthLabel LOCAL, רשימת עוגנים ב-max-h-96 עם הסקרולבר המעוצב — registryIndex/checkpointIndex/טווח/root/anchoredBy/anchoredAt/calldata chip+העתקה, הודעת ריקות מובהקת, כפתור רענון; הוכחת הכללה: Input seq + "הוכח הכללה מול הרישום" → דוח עם Badge LOCAL + שלוש בדיקות ✓/✗ (rootInRegistry/leafRecomputedMatch/proofValid) + proof hashes ב-max-h-40) ו-DeployKitCard (Badge "REAL — קומפילציה מקומית", שורות compiler/evmVersion/optimizer/compiledAt/codeDepositGas עם הערת "אומדן קומפילטור", שלושה keccak chips, שלוש שורות אינטגריציה ✓/✗ + אזהרה rose "הרץ bun scripts/compile-anchor.ts מחדש" כש-sourceMatch=false, כפתורי "העתק Bytecode"/"העתק ABI" עם toast, checklist עם TruthLabel + note, notes מה-kit, skeleton). מפת האמת הורחבה בשתי שורות: "קומפילציית solc (bytecode אמיתי, keccak מתועד)"=REAL, "רישום עוגן מקומי (סימולציית חוזה בשרת)"=LOCAL.
- agents-tab.tsx (שונה): פס Evm3Section בראש הטאב (3 mini-cards: רוטציות מה-DB/אתגרים שאומתו/דחיות replay + caption עם counterScope החי מהשרת; מתרענן אחרי כל פעילות דרך refreshKey). בכרטיס סוכן ACTIVE שני כפתורים: "אתגר nonce" → Dialog עם Stepper: צעד 1 אתגר (nonce גדול + digest chip + כתובת), צעד 2 "חתום (סימולציית סוכן · DEVNET)" → signature chip + הערת יושר, צעד 3 "אמת וצרוך את ה-nonce" → אזור emerald "nonce N נצרך — הזהות אומתה" + כפתור replay שנכשל תמיד (toast rose עם הודעת ה-409 + אזור rose "replay נדחה — החתימה חד-פעמית"); "רוטציית מפתח" → Dialog אזהרה rose + Input הערה + "בצע רוטציה" → פאנל תוצאה (old→new chips, op nonce, digest, CheckRow recovered===oldAddress) + reloadAgents, ומתחת "הדגם: חתימה במפתח הישן" → פאנל rose "נדחה ✓" עם attempted≠active + reason, ו"תעד מנגנון בספר (BUILD)" → attest BUILD עם evidence שנבנה אוטומטית מתוצאות הצעדים שנשמרו ב-MechanismState (ברמת הכרטיס — אתגר+replay מהדיאלוג האחי, op, replay-demo, מדידות חיות מ-/api/weave/evm3) → toast "נרשם בספר — כעת סגור את שער EVM-3 בלשונית 'תוכנית ופרוטוקול'" + סגירה. רוטציה נעולה (disabled + tooltip בעטיפת span) לסוכנים עם attCount>0 עם הסבר הדוקטרינה. נוספה הערת יושר בתחתית הטאב (מפתחות פרטיים בשרת ל-DEVNET בלבד; בייצור אצל הסוכן).
- אומת מול ה-API החי (השרת עלה בין פקודות): GET deploy-kit/registry/evm3 ו-POST registry/verify seq=3 → דוח תואם לחלוטין ל-DTOs ב-evmext-types (rootInRegistry ✓ proofValid ✓ leafRecomputedMatch ✓, proof 3 רמות). לא שונה מצב ה-DB (הושאר ל-QA של 5-c: cp1 LOCAL-ANCHORED, cp2 LOCAL).
- בדיקות: bun run lint נקי; bunx tsc --noEmit — 0 שגיאות בקבצי src/components/weave/** (השגיאות הקיימות ב-evm.ts/rotation.ts/examples/skills קדמו למשימה זו ואינן בבעלותה); דף / מתקמפל ומחזיר 200 ללא שגיאות ב-dev.log.

Stage Summary:
- קבצים שנוצרו: src/components/weave/evm/{bits.tsx, use-local-anchors.ts, deploy-kit-card.tsx, local-registry-section.tsx, evm3-section.tsx, challenge-dialog.tsx, rotate-dialog.tsx}. שונו: tabs/anchor-tab.tsx, tabs/agents-tab.tsx. זה הכל — אפס נגיעה בקבצים אסורים.
- סטיות קטנות מהחוזה (מנומקות): (1) סדר הסקשנים בטאב העוגן: הרישום המקומי (EVM-2) מופיע מיד אחרי רשימת ה-checkpoints (הכפתור "עגן ברישום המקומי" יושב על הכרטיסים והתוצאה נראית מיד מתחת) וחבילת הפריסה (EVM-1) אחריה — סדר האזכור בחוזה היה סדר בנייה, לא פריסה. (2) ב-evidence של ה-BUILD: נעשה שימוש ב-counterScope החי מהשרת (מדויק יותר מהמחרוזת הקבועה שבדוגמה) וצעדים שלא בוצעו בסשן מסומנים בכנות "טרם בוצע בסשן זה" במקום להיכשל. (3) כפתור ה-replay-demo זמין רק לאחר רוטציה (לפני כן אין מפתח משוך בזיכרון השרת — 409 מיותר). (4) נוסף רענון שקט לחבילת הפריסה והדיאלוגים נסגרים/נפתחים עם איפוס state מלא.
- מוכן ל-QA דפדפן (Task 5-c). זרימה מומלצת לבדיקה: טאב עוגן → "עגן ברישום המקומי" על cp2 → הוכחת הכללה seq=3 (ואז seq=7 → שגיאת "טרם עוגן"); טאב סוכנים → אתגר nonce מלא כולל replay → רוטציה (לסוכן ללא אימותים; weave-relayer כבר סובב — ייצור סוכן חדש להדגמה נקייה) → הדגמת מפתח ישן → תיעוד BUILD → סגירת EVM-3 ב"תוכנית ופרוטוקול".

---
Task ID: 5-c
Agent: main (Z.ai — lead engineer)
Task: QA קצה-לקצה בדפדפן של חבילת ה-EVM + תיקון באג רענון + סגירת שער EVM-3

Work Log:
- tsc תוקן ב-rotation.ts (ROTATION_TYPES קיבל טיפוס Record<string, TypedDataField[]> במקום as const — שתי שגיאות הוסרו; שתי השגיאות ב-evm.ts הסופי קדומות ואינן נוגעות — זמן ריצה אומת).
- E2E בדפדפן (agent-browser), טאב "עוגן EVM": חבילת הפריסה מוצגת (solc 0.8.37, bytecodeKeccak 0x694c16…, codeDeposit 103,400, checklist REAL/NOT-YET); עיגון checkpoint 2 ברישום המקומי דרך ה-UI → "LOCAL-ANCHORED · רישום #2" + טוסט; הוכחת הכללה ל-seq 6 → שלוש הבדיקות ✓ (rootInRegistry, leafRecomputedMatch, proofValid; 1 רמה — ההוכחה היא entryHash של seq 7, בדיוק ראש השרשרת). VLM אישר ויזואלית: ✓ ירוקים, RTL תקין, אין באגי פריסה.
- E2E טאב "סוכנים": נעילת רוטציה לסוכנים עם אימותים מוצגת (disabled); אתגר nonce 3 → חתימה (סימולציית סוכן) → נצרך ("nonce 3 נצרך — הזהות אומתה") → replay של אותה חתימה → נדחה עם הודעת השרת המדויקת; רוטציה שנייה של weave-relayer (op nonce 4 — המונה מתמשך בין מנגנונים!) → "הדגם: חתימה במפתח הישן" → "נדחה ✓ attempted ≠ active" → "תעד מנגנון בספר (BUILD)" → אימות seq 8 VERIFIED, חתום במפתח החדש שלאחר הרוטציה, ראיה מדודה מלאה.
- סגירת שער EVM-3 ב-UI (בחירת אימות #8) → DONE attSeq 8 (אומת ב-API וב-UI). בדרך נבדק ש-EVM-2 נעול כראוי (אין אימות ANCHOR VERIFIED — הכפתור נעול).
- באג אמיתי שנמצא ותוקן: closeStage קרא ל-loadStages העצלן — ה-UI לא הראה DONE עד רענון ידני. תוקן ב-store.tsx: reloadStages כפוי אחרי סגירה. אומר מחדש בדפדפן.
- מובייל 390px: VLM אישר ערימה אנכית, אין גלישה אופקית, footer צמוד לתחתית ללא חפיפה. קונסולה: אפס שגיאות. dev.log: אפס שגיאות זמן-ריצה. lint נקי.

Stage Summary:
- מצב סופי: 8 אימותים (7 VERIFIED + 1 UNMEASURED), שרשרת valid 8/8, 4 סוכנים (weave-relayer סובב פעמיים, מפתח ישן נדחה), 2 checkpoints — שניהם LOCAL-ANCHORED (רישום מקומי #1, #2), שערים: L0, L1, EVM-3 = DONE; השאר נעולים כנדרש.
- מחזור EVM-3 הוכח במלואו ב-UI: אתגר→חתימה→צריכה→replay נדחה→רוטציה חתומה EIP-712→מפתח ישן נדחה→תיעוד VERIFIED→שער נסגר.
- נותר NOT-YET (כנה): EVM-1 פריסה בפועל (חותם ממומן + RPC — חבילה מוכנה כולה), EVM-2 עיגון בשרשרת אמיתית (המנגנון כולו אומת ב-LOCAL), R1-R3 פעולות מרחוק על ה-org, L2-L4 זמן/כסף אמיתיים.
- ⚠ הערת סביבה: הסנדבוקס מפיל תהליכי רקע בין פקודות; שרת ה-dev עשוי להיות מופל בפתיחת ה-preview — יש להרימו מחדש (restart מהפאנל). כל הבדיקות בוצעו מול שרת חי.
