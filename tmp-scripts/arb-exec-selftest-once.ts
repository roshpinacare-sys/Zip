// ─────────────────────────────────────────────────────────────────────
// arb-exec-selftest-once.ts — בדיקה-חיה-חד-פעמית של מודול-הביצוע (משימה 7-a)
//
// מה-היא-מוכיחה (בלי-לשלוח אף-קריאת-מוטציה — dryRun-מאולץ, יומן-ב-/tmp):
//   1. חסימת-CEX-קשיחה: הזדמנות עם cexReference:true → blockedCex++, אף-רגל.
//   2. כיוון book-first (buy-book/sell-pool): רגל-הספר לא-חוברת → שרשרת-שבורה,
//      אף-קריאה לא נשלחת (blocked-rail) — אפס-חשיפה-עיוורת.
//   3. כיוון pool-first (buy-pool/sell-book): תכנון-רגליים-מלא (peg→swap→book)
//      מול רזרבות-חיות + minOut fail-closed + יומן-arbitrage-exec.jsonl.
//
// הרצה: cd /home/z/my-project/zip && bun tmp-scripts/arb-exec-selftest-once.ts
// ─────────────────────────────────────────────────────────────────────

process.env.ARB_EXEC_LOG = "/tmp/arb-exec-selftest.jsonl"; // יומן-בדיקה — לא-היומן-הקנון
process.env.ARB_EXCHANGE_API = "http://127.0.0.1:3000/api/exchange"; // הרייל-החי האמיתי

const { arbExecTick, execPublic } = await import("../mini-services/arbitrage/exec");
const { existsSync, readFileSync } = await import("node:fs");
const at = new Date().toISOString();

// ── 1) הזדמנות-CEX — חייבת-להיחסם-קשיח ──
const oppCex = {
  id: "pool-vs-cex", klass: "exchange-vs-cex", direction: "buy-pool/sell-cex",
  sizeUsd: 2, netBps: 120.5, netUsd: 0.0241, maxFeasibleUsd: 50,
  legs: [
    { venue: "exchange:peg", side: "USDS→WSBD", price: 1, feeBps: 0, peg: true, amountIn: 2, expectedOut: 2 },
    { venue: "exchange:WSTEEM/WSBD", side: "buy-B2A", price: 25, feeBps: 30, amountIn: 2, expectedOut: 0.0796 },
    { venue: "cex", side: "sell", price: 0.0583, feeBps: 10, cexReference: true },
  ],
  cexReference: true, at, notes: "selftest — CEX רגל",
} as Parameters<typeof arbExecTick>[0][number];
await arbExecTick([oppCex]);

// ── 2) book-first — רגל-הספר-לא-חוברת → שרשרת-שבורה, אף-קריאה ──
const oppBookFirst = {
  id: "steem-book-vs-pool", klass: "book-vs-exchange", direction: "buy-book/sell-pool",
  sizeUsd: 5, netBps: 80, netUsd: 0.04, maxFeasibleUsd: 50,
  legs: [
    { venue: "steem-internal", side: "buy-asks", price: 25, feeBps: 75, amountIn: 5, expectedOut: 0.1985 },
    { venue: "exchange:WSTEEM/WSBD", side: "sell-A2B", price: 25, feeBps: 30, amountIn: 0.1985, expectedOut: 0.0049 },
    { venue: "exchange:peg", side: "WSBD→USDS", price: 1, feeBps: 0, peg: true, amountIn: 0.0049, expectedOut: 0.0049 },
  ],
  cexReference: false, at, notes: "selftest — book-first",
} as Parameters<typeof arbExecTick>[0][number];
await arbExecTick([oppBookFirst]);

// ── 3) pool-first — תכנון-מלא ב-dryRun מול רזרבות-חיות ──
const oppPoolFirst = {
  id: "pool-vs-steem-book", klass: "book-vs-exchange", direction: "buy-pool/sell-book",
  sizeUsd: 5, netBps: 65, netUsd: 0.0325, maxFeasibleUsd: 50,
  legs: [
    { venue: "exchange:peg", side: "USDS→WSBD", price: 1, feeBps: 0, peg: true, amountIn: 5, expectedOut: 5 },
    { venue: "exchange:WSTEEM/WSBD", side: "buy-B2A", price: 25, feeBps: 30, amountIn: 5, expectedOut: 0.1985 },
    { venue: "steem-internal", side: "sell-bids", price: 25, feeBps: 75, amountIn: 0.1985, expectedOut: 0.1985 },
  ],
  cexReference: false, at, notes: "selftest — pool-first",
} as Parameters<typeof arbExecTick>[0][number];
await arbExecTick([oppPoolFirst]);

const ex = execPublic();
console.log(JSON.stringify({
  dryRun: ex.dryRun,
  totals: ex.totals,
  lastRecord: ex.lastRecord,
  cexPolicy: ex.cexPolicy,
}, null, 2));

// טענות-אימות — ההרצה נכשלת-בקול אם-החוק-נשבר
const t = ex.totals;
const assert = (cond: boolean, msg: string): void => {
  if (!cond) { console.error(`SELFTEST-FAILED: ${msg}`); process.exit(1); }
  console.log(`ok — ${msg}`);
};
assert(t.blockedCex >= 1, "CEX-הזדמנות נחסמה-קשיח (blockedCex++) — אף-קריאה");
assert(!!ex.lastRecord && ex.lastRecord.oppId === "pool-vs-steem-book", "המועמד-האחרון: pool-vs-steem-book (book-first נעקף בתור-המועמדות)");
assert(!!ex.lastRecord?.legs.every((l) => l.sent === false), "אף-קריאת-מוטציה לא נשלחה (dryRun)");
const planned = ex.lastRecord?.legs ?? [];
assert(planned[0]?.body?.action === "usds-burn", "רגל-1: peg USDS→WSBD → action usds-burn מתוכנן");
assert(planned[1]?.body?.action === "swap" && Number(planned[1]?.body?.minOut) > 0, "רגל-2: swap B2A עם minOut fail-closed מתוכנן");
assert(planned[2]?.rail === "unwired", "רגל-3: ספר-Steem מסומן unwired בכנות");
assert(ex.lastRecord?.dryRun === true, "הרשומה-האחרונה מסומנת dryRun:true — כנות");
assert(existsSync(ex.logFile) && readFileSync(ex.logFile, "utf8").trim().length > 0, `יומן-הביצוע נכתב (${ex.logFile})`);
console.log(`SELFTEST-PASSED · journal=${ex.logFile}`);
