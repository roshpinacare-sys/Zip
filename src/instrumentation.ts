// ─────────────────────────────────────────────────────────────────────
// INSTRUMENTATION · נקודת-הצתה אחת לכל תהליך שרת (Next 16).
// כאן נולד שומר-הצי בתוך השרת (D-016): השרת מסייר על הדיבונים ומקים
// את keeper כשהוא מת — בזמן ש-keeper מסייר על השרת. הפעלה-עצמית
// כפולה, שתי שכבות שמגנות זו על זו.
// ─────────────────────────────────────────────────────────────────────

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // בזמן build אין צי לשמור — ואין DB לרישום
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startFleetGuard } = await import("@/lib/weave/fleet-guard");
  startFleetGuard();
}
