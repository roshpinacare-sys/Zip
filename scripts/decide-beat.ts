#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────────────
// decide-beat (Task 17) — פעימת-המוח על הקצב השעתי.
//
// הקצב מריץ כבר: תחרות · הצבעות-חיילים · קיפול-מצב. מעתה גם: **החלטות**.
// אחרי-שהשולחנות רצו, decide() בודק מה נותר לא-מוחלט ומכריע: מבצע פעולות
// בטוחות (רישום-הכנסה · מלגות), תור הסלמות-מפעיל, מאמת שערי-החזקה,
// ורושם hash-chained. fail-soft — כשל נרשם והקצב ממשיך.
// ─────────────────────────────────────────────────────────────────────────────

import { runDecide } from "@/lib/weave/decide";

const at = new Date().toISOString();
try {
  const run = await runDecide({ execute: true });
  const lines = run.verdicts.map((v) => `  · [${v.verdict}] ${v.id}: ${v.detailHe}`);
  console.log(`[decide-beat ${at}] seq=${run.seq} gate=${run.gate} — ${run.noteHe}`);
  for (const ln of lines) console.log(ln);
  process.exit(0);
} catch (e) {
  console.error(`[decide-beat ${at}] FAIL: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
  process.exit(0); // fail-soft: הקצב אף-פעם לא נופל בגלל המוח
}
