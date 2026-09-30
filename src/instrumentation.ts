// ─────────────────────────────────────────────────────────────────────
// INSTRUMENTATION · נקודת-הצתה אחת לכל תהליך שרת (Next 16).
// כאן נולדים שתי שכבות-ההפעלה-העצמית (D-016/D-027):
//   · fleet-guard  — השרת מסייר על הדיבונים ומקים את keeper כשהוא מת
//   · self-boot    — הבית מרים את עצמו אחרי מיחזור: סכימה · ספר · כספת
// הפעלה-עצמית כפולה-משולשת: keeper מחייה את השרת · השרת מחייה את keeper ·
// והבית כולו קם מעצמו. מוות-שקט אינו אפשרות.
// ─────────────────────────────────────────────────────────────────────

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // בזמן build אין צי לשמור — ואין DB לרישום
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startFleetGuard } = await import("@/lib/weave/fleet-guard");
  startFleetGuard();
  const { startSelfBoot } = await import("@/lib/weave/self-boot");
  startSelfBoot();
  // r142 · D-OP-01: לולאת-ההחלטות הריבונית — הבית לא רק קם מעצמו,
  // הוא גם מחליט מעצמו (בתוך גבולות-הפרוטוקול) בלי המתנה למפעיל.
  const { startGovernanceLoop } = await import("@/lib/weave/governance-loop");
  startGovernanceLoop();
}
