// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · weave-gate — שער הסודות הקנוני (מקור אחד לכל הדוחפים)
//
// לקח מכשלון 2026-09-15 06:13: הרשימה הלבנה חיה בשלושה עותקים —
// הלב עודכן ב-payloadHash (Task 22) אבל שני קווי העיגון לא — וכל
// סליקת שוק חסמה את הדחיפה שלהם במשך שעות. מעתה: הגדרה אחת,
// מיובאת ע"י weave-beat · weave-anchor · weave-anchor-zero.
//
// דוקטרינה בלתי-מתפשרת: לא דוחפים לעולם מפתח-פרטי/WIF/PAT.
// חריגה מבוקרת: שדות hash ציבוריים (0x+64hex תחת שם שדה קנוני)
// מוסרים מה-diff לפני השער — הם אינם סוד וכל צד שלישי מאמת אותם
// מחדש מהשרשרות הציבוריות. כל שורה אחרת שמכילה 64hex — כולל
// devKeyHex אמיתי או ערך חשוד בטקסט — נשארת ונתפסת ע"י השער.
// ─────────────────────────────────────────────────────────────────────

export const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "steem/hive WIF", re: /\b5[1-9A-HJ-NP-Za-km-z]{50}\b/ },
  { name: "blurt WIF", re: /\bB[1-9A-HJ-NP-Za-km-z]{50}\b/ },
  { name: "EVM private key (64hex)", re: /\b0x[0-9a-fA-F]{64}\b/ },
  { name: "github token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: "github_pat token", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: "PEM private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "x-access-token url", re: new RegExp("x-access-token:[A-Za-z0-9_\\-]+@") },
];

// שדות hash ציבוריים קנוניים — שרשרת/Merkle/שוק/קווי-עוגן. איחוד של
// כל הרשימות שחיו עד כה + payloadHash שחסר לקווי העיגון (שורש הכשל).
const KNOWN_HASH_FIELDS =
  /"(entryHash|root|prevRoot|prevHash|headHash|digest|recomputedHead|evidenceHash|leaf|sha256|id|payloadHash|txid|anchorTx|stateRoot|genesisHash|lastBlockHash|dataHex|payload|zeroTxid|recoveredTxid|sig|calldata|explorer|inputHex)"\s*:/i;
const KNOWN_HASH_KV =
  /(headHash|recomputedHead|root|entryHash|digest|prevHash|payloadHash|txid|anchorTx|stateRoot|genesisHash|lastBlockHash|dataHex|zeroTxid|recoveredTxid|explorer)=/i;
// קישור סייר ציבורי — ה-txid בתוכו היא בדיוק הראיה הפומבית
const KNOWN_EXPLORER_URL = /zscan\.live\/tx\/0x[0-9a-fA-F]{64}/i;

export function filterKnownHashes(diff: string): string {
  return diff
    .split("\n")
    .filter((line) => {
      if (!/0x[0-9a-fA-F]{64}/.test(line)) return true; // אין 64hex — נשארת
      if (KNOWN_EXPLORER_URL.test(line)) return false;
      if (KNOWN_HASH_FIELDS.test(line) || KNOWN_HASH_KV.test(line)) return false;
      return true; // 64hex לא מוכר — נשארת ותיבדק בשער
    })
    .join("\n");
}

export function secretGate(stagedDiff: string): string | null {
  for (const p of SECRET_PATTERNS) {
    if (p.re.test(stagedDiff)) return p.name;
  }
  return null;
}
