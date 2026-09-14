// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Seal — מפתחות הענן בתוך מעטפת מוצפנת בריפו (zero-touch)
//
// דוקטרינת הצי (fleet_vault, Task 82): הריפו פרטי; זמינות קריטית;
// מפתחות ברור-טקסט לעולם לא בגיט — אבל מעטפת AES-256-GCM כן, עם
// הסיסמה ב-meta (הבלוב חסר-גישה-לריפו חסר-ערך). ה-seal הזה נותן
// לפעימת הענן זהות יציבה בין איפוסי סנדבוקס:
//   · cloudKeyHex  — זהות weave-cloud-heart (חותם אימותי פעימה)
//   · networkKeyHex — מפתח הרשת לחתימת checkpoints (EIP-712)
//
// שימוש:
//   bun scripts/weave-seal.ts --create          # יוצר/מחליף seal מה-DB
//   bun scripts/weave-seal.ts --status          # קיום + כתובות בלבד
// ─────────────────────────────────────────────────────────────────────

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { db } from "@/lib/db";
import { generateIdentity, identityFromKey } from "@/lib/weave/evm";

const ROOT = path.resolve(__dirname, "..");
const SEAL_DIR = path.join(ROOT, "sovereign");
const ENC_PATH = path.join(SEAL_DIR, "weave-seal.enc");
const META_PATH = path.join(SEAL_DIR, "weave-seal.meta.json");
const MAGIC = "WEAVE-CLOUD-SEAL-1";

export interface SealPayload {
  format: typeof MAGIC;
  sealedAt: string;
  cloudKeyHex: string;
  networkKeyHex: string;
  cloudAddress: string;
  networkAddress: string;
}

export function sealOpen(): SealPayload {
  const raw = fs.readFileSync(ENC_PATH, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines[0] !== MAGIC) throw new Error("פורמט seal לא מזוהה");
  const hex = lines.slice(1).join("");
  const payload = Buffer.from(hex, "hex");
  const salt = payload.subarray(0, 16);
  const iv = payload.subarray(16, 28);
  const tag = payload.subarray(28, 44);
  const ct = payload.subarray(44);
  const meta = JSON.parse(fs.readFileSync(META_PATH, "utf8")) as { passphrase: string };
  const key = crypto.scryptSync(meta.passphrase, salt, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(pt) as SealPayload;
  if (parsed.format !== MAGIC) throw new Error("תוכן seal לא מזוהה");
  // בדיקת שלמות: הכתובות נגזרות מהמפתחות וחייבות להתאים
  if (identityFromKey(parsed.cloudKeyHex).address !== parsed.cloudAddress) {
    throw new Error("seal פגום — כתובת הענן אינה נגזרת מהמפתח");
  }
  if (identityFromKey(parsed.networkKeyHex).address !== parsed.networkAddress) {
    throw new Error("seal פגום — כתובת הרשת אינה נגזרת מהמפתח");
  }
  return parsed;
}

async function sealCreate(): Promise<void> {
  fs.mkdirSync(SEAL_DIR, { recursive: true });

  const network = await db.networkKey.findUnique({ where: { id: "weave-network" } });
  if (!network || !network.devKeyHex) {
    throw new Error("אין מפתח רשת ב-DB — צור checkpoint פעם אחת לפני ה-seal");
  }

  // זהות ענן חדשה אם אינה קיימת; אם קיימת — נעילת המפתח הקיים (יציבות זהות)
  const existing = await db.agent.findUnique({ where: { name: "weave-cloud-heart" } });
  let cloudKeyHex: string;
  if (existing?.devKeyHex) {
    cloudKeyHex = existing.devKeyHex;
  } else {
    cloudKeyHex = generateIdentity().devKeyHex;
  }
  const cloudAddress = identityFromKey(cloudKeyHex).address;

  const payload: SealPayload = {
    format: MAGIC,
    sealedAt: new Date().toISOString(),
    cloudKeyHex,
    networkKeyHex: network.devKeyHex,
    cloudAddress,
    networkAddress: network.address,
  };

  const passphrase = crypto.randomBytes(32).toString("base64url");
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const hex = Buffer.concat([salt, iv, tag, ct]).toString("hex");

  fs.writeFileSync(ENC_PATH, MAGIC + "\n" + (hex.match(/.{1,100}/g) ?? []).join("\n") + "\n", {
    mode: 0o600,
  });
  fs.writeFileSync(
    META_PATH,
    JSON.stringify(
      {
        format: MAGIC,
        at: payload.sealedAt,
        passphrase, // ריפו פרטי בלבד (דוקטרינת הצי Task 82) — בריפו ציבורי: Secrets
        kdf: "scrypt(2^14)",
        enc: "aes-256-gcm",
        cloudAddress,
        networkAddress: network.address,
        note: "הסיסמה כאן — ריפו פרטי בלבד (דוקטרינת הצי). בריפו ציבורי: מחק seal + העבר ל-GitHub Secrets.",
      },
      null,
      2
    ) + "\n"
  );
  console.log("seal נוצר:", ENC_PATH);
  console.log("  cloudAddress:", cloudAddress);
  console.log("  networkAddress:", network.address);
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "--status";
  if (mode === "--create") {
    await sealCreate();
    return;
  }
  // status
  const exists = fs.existsSync(ENC_PATH);
  console.log("seal:", exists ? "קיים" : "חסר");
  if (exists && fs.existsSync(META_PATH)) {
    const meta = JSON.parse(fs.readFileSync(META_PATH, "utf8"));
    console.log("  sealedAt:", meta.at, "| kdf:", meta.kdf, "| enc:", meta.enc);
    console.log("  cloudAddress:", meta.cloudAddress);
    console.log("  networkAddress:", meta.networkAddress);
  }
}

// ריצה כ-CLI בלבד כשהמודול הוא ה-entry (לא בעת import מ-weave-beat)
if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("SEAL-ERROR:", e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
