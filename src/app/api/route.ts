import { NextResponse } from "next/server";

// אינדקס-השירות של הקונסולה הריבונית — כל-נקודות-הקצה הציבוריות במקום-אחד.
// עיקרון SO-2: שום-טענה-בלי-מדידה — כל-קישור-כאן הוא-מקור-אמת-חי-שכל-אחד-יכול-לבדוק.
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "SAOS · THE WEAVE — sovereign console",
    what: "הרשת-המאמתת לסוכני AI — כל-טענה נמדדת, נחתמת-ונעוגנת-בשרשרות-ציבוריות",
    endpoints: {
      defi: "/api/defi — המצב-הכספי-החי (שרשרת, אוצר, חיסכון, בריכות, שוק-כספים)",
      treasury: "/api/treasury — נכסי-האוצר-וזרימת-הכסף",
      agents: "/api/agents — ספר-הזהויות-החתום (הסנדבוקס — אמת-זמנית-בלבד)",
      ecosystem: "/api/ecosystem — מפת-הריפואים-והסוכנים",
      plan: "/api/plan — תוכנית-העבודה",
      saosnet: "/api/saosnet — מצב-הרשת-החי",
      live: {
        overview: "/api/live/overview — סקירת-הענן (מקור: המראה-הציבורית)",
        attestations: "/api/live/attestations — ספר-העדויות",
        checkpoints: "/api/live/checkpoints — נקודות-הביקורת-והשורשים",
        dex: "/api/live/dex — השרשרת-הקנונית (world.json)",
      },
      web: {
        state: "/api/web/state — מצב-רשת-האחסון (חבילות · RC חי · סהכ-מצטבר)",
        serve: "/api/web/c/<sha256>/<path> — שער-ההגשה המאומת-חותם (ETag · CORS)",
        listing: "/api/web/c/<sha256>?list=1 — רישום-קבצי-החבילה",
        raw: "/api/web/c/<sha256>?raw=1 — הורדת-החבילה כולה (מאומת sha256 מול החותם)",
        verify: "/api/web/verify/<sha256> — מנוע-ההוכחות (סריקה-עמוקה · קריאות-בלוק)",
        publish: "/api/web/publish — העלאה (פעולת-מפעיל בלבד)",
      },
    },
    publicTruth: {
      console: "https://roshpinacare-sys.github.io/Console/",
      world: "https://roshpinacare-sys.github.io/Console/dex/world.json",
      depositBook: "https://roshpinacare-sys.github.io/Console/dex/watch.json",
      rule: "ה-URL-הציבורי הוא-המוצר; הסנדבוקס הוא-שולחן-עבודה-בלבד",
    },
  });
}
