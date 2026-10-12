/* ═══════════════════════════════════════════════════════════════════════
 * קוקפיט ריבוני — app.js
 * אפס-בקנד: קריפטו, חתימה ופענוח — הכל בדפדפן. המפתחות לעולם לא נשלחים.
 *
 * שרשרת-אמון:
 *   gate-crypto.js (התאום, אפס-תלות, מאומת) — קריפטו-primitives + חתימה
 *   steemtx.mjs (המנוע, מוכח-שרשרת R209/R216/R245) — סריאליזציית בייטים, פורט נאמן
 *   vault.enc.json — PBKDF2 600k + AES-256-GCM, מפתח-מנהל
 * ═══════════════════════════════════════════════════════════════════════ */
if (window.top !== window.self) { try { window.top.location = window.self.location; } catch { document.documentElement.hidden = true; } } // T-42 framebust (M3)
(function () {
  "use strict";
  const GC = window.GateCrypto;
  if (!GC) return;

  const VERSION = "v1.0 · T-37 · 2026-10-09";
  const $ = (id) => document.getElementById(id);
  const enc = new TextEncoder();

  /* ─────────────────────────────────────────────────────────────────────
   * TXKit — פורט נאמן מ-steemtx.mjs של המנוע (מוכח-שרשרת, שידורים-חיים):
   *  R209: claim_reward_balance=39 (19 שידורים-חיים הוכיחו)
   *  R216: custom_json=18 (0x12, probe)
   *  R245: אין בייט-הרחבות פנטום ב-vote/comment/claim/custom_json
   *  R210: דיוק-קנון לנכסים — STEEM/SBD=3, VESTS=6
   * ───────────────────────────────────────────────────────────────────── */
  class Writer {
    constructor() { this.buf = []; }
    u8(v) { this.buf.push(v & 0xff); return this; }
    u16(v) { this.buf.push(v & 0xff, (v >> 8) & 0xff); return this; }
    u32(v) { this.buf.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff); return this; }
    i32(v) { return this.u32(v >>> 0); }
    u64(v) { let n = BigInt(v); const b = []; for (let i = 0; i < 8; i++) { b.push(Number(n & 0xffn)); n >>= 8n; } this.buf.push(...b); return this; }
    i16(v) { return this.u16(v & 0xffff); }
    varint(v) { let n = BigInt(v); for (;;) { const b = Number(n & 0x7fn); n >>= 7n; this.u8(n === 0n ? b : b | 0x80); if (n === 0n) break; } return this; }
    bytes(b) { this.buf.push(...b); return this; }
    str(s) { const b = enc.encode(String(s ?? "")); this.varint(b.length); return this.bytes(b); }
    asset(amountStr) {
      // "12.345 STEEM" → הספרות-עצמן הן ה-uint64 המוקטן; ביית-דיוק = מספר-הספרות
      const m = /^\s*(\d+(?:\.\d+)?)\s+([A-Z]+)\s*$/.exec(String(amountStr));
      if (!m) throw new Error("asset-format: " + amountStr);
      const whole = m[1], sym = m[2];
      const dot = whole.indexOf(".");
      let prec = dot < 0 ? 0 : whole.length - dot - 1;
      const CANON = { STEEM: 3, SBD: 3, VESTS: 6, TSTD: 6 };
      let scaledStr;
      if (sym in CANON && prec !== CANON[sym]) {
        const [i, f = ""] = whole.split(".");
        const f2 = (f + "0".repeat(CANON[sym])).slice(0, CANON[sym]);
        scaledStr = `${i}${f2}`;
        prec = CANON[sym];
      } else {
        scaledStr = whole.replace(".", "");
      }
      this.u64(BigInt(scaledStr));
      this.u8(prec);
      const s = enc.encode(sym);
      const pad = new Array(7 - s.length).fill(0);
      return this.bytes(Array.from(s).concat(pad));
    }
    out() { return new Uint8Array(this.buf); }
  }

  // רק פעולות-רשות-פרסומית — סירוב מבני להזזת כסף (דוקטרינת אפס-סיכון-הון)
  const OP_IDS = { vote: 0, comment: 1, claim_reward_balance: 39, custom_json: 18 };

  function serOp(name, v, w) {
    switch (name) {
      case "vote":
        w.str(v.voter).str(v.author).str(v.permlink).i16(v.weight);
        break;
      case "comment":
        w.str(v.parent_author ?? "").str(v.parent_permlink).str(v.author)
         .str(v.permlink).str(v.title ?? "").str(v.body ?? "").str(v.json_metadata ?? "{}");
        break;
      case "claim_reward_balance":
        w.str(v.account).asset(v.reward_steem).asset(v.reward_sbd).asset(v.reward_vests);
        break;
      case "custom_json":
        w.varint((v.required_auths ?? []).length);
        for (const a of v.required_auths ?? []) w.str(a);
        w.varint((v.required_posting_auths ?? []).length);
        for (const a of v.required_posting_auths ?? []) w.str(a);
        w.str(v.id).str(v.json ?? "{}");
        break;
      default:
        throw new Error("op-not-serializable: " + name + " (רק רשות-פרסומית)");
    }
  }

  function serializeTx({ ref_block_num, ref_block_prefix, expiration, operations }) {
    const w = new Writer();
    w.u16(ref_block_num).u32(ref_block_prefix).i32(expiration);
    w.varint(operations.length);
    for (const [name, v] of operations) {
      if (!Object.prototype.hasOwnProperty.call(OP_IDS, name)) throw new Error("op-not-serializable: " + name);
      w.varint(OP_IDS[name]);
      serOp(name, v, w);
    }
    w.varint(0); // extensions — ריק
    return w.out();
  }

  const CHAIN_ID = new Uint8Array(32); // steem mainnet = 32 אפסים

  /** בניית עסקה חתומה — אותו דפוס buildTx של המנוע (head_block_number & 0xffff,
   * prefix = head_block_id bytes[4..8] LE, ttl, digest = sha256(chainId||bin)) */
  async function buildTx({ ops, dgpo, priv, ttlSec = 60 }) {
    const headNum = Number(dgpo.head_block_number);
    const idBytes = GC.unhex(String(dgpo.head_block_id));
    const ref_block_num = headNum & 0xffff;
    const ref_block_prefix = idBytes[4] | (idBytes[5] << 8) | (idBytes[6] << 16) | (idBytes[7] << 24);
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = nowSec + ttlSec;
    const bin = serializeTx({
      ref_block_num, ref_block_prefix, expiration: expSec, operations: ops,
    });
    const digest = await GC.sha256(concatBytes(CHAIN_ID, bin));
    const sig = await GC.signCompact(digest, priv); // 65B: 31+recid, r, s
    return {
      txid: GC.hex(digest),
      json: {
        ref_block_num,
        ref_block_prefix,
        expiration: new Date(expSec * 1000).toISOString().slice(0, 19),
        operations: ops,
        extensions: [],
        signatures: [GC.hex(sig)],
      },
    };
  }

  function concatBytes(...arrs) {
    const len = arrs.reduce((n, a) => n + a.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  }

  /* ── WIF adapter: גם 37-בייט (ישן) וגם 38-בייט (דגל-דחיסה) — T-86 של התאום ── */
  async function wifToPrivAny(wif) {
    const { version, payload } = await GC.b58cDecode(wif);
    if (version !== 0x80) throw new Error("wif-version");
    if (payload.length === 33 && payload[32] === 0x01) return payload.slice(0, 32);
    if (payload.length === 32) return payload;
    throw new Error("wif-length:" + payload.length);
  }
  const wifToSTM = async (wif) => await GC.pubToSTM(GC.privToPubBytes(await wifToPrivAny(wif)));

  /* ═══════════════ מצב-סשן (רק בזיכרון — לעולם לא localStorage) ═══════════════ */
  const S = {
    version: VERSION,
    vaultMeta: null,
    payload: null,        // נפתח: {accounts, endpoints, audit, github, ...}
    sessionKey: null,     // T-60: מפתח-סשן-לא-ניתן-לחילוץ — לחתימת-אישורים-בלבד
    pulse: null,          // T-60: פולס-המועמדים (מנוכה-סודות)
    envelopes: [],        // T-60: אישורים-חתומים (זיכרון-סשן)
    log: [],
    idleAt: Date.now(),
    lockTimer: null,
    keyRevealTimer: null,
  };
  const LOCK_MS = 15 * 60 * 1000;

  function log(action, detail, cls) {
    const line = { t: new Date().toISOString().slice(11, 19), action, detail: detail ?? "", cls: cls ?? "" };
    S.log.unshift(line);
    if (S.log.length > 300) S.log.pop();
    renderLog();
  }

  /* ═══════════════ שער: פענוח הכספת (רישום-מעטפות — חוק vault-home) ═══════════════ */
  async function tryUnlock(password) {
    const cands = [password, password.replace(/[\r\n]+/g, ""), password.trim()]
      .filter((v, i, a) => v && a.indexOf(v) === i);
    for (const c of cands) {
      for (const w of S.vaultMeta.wraps ?? []) {
        try {
          const base = await crypto.subtle.importKey("raw", enc.encode(c), "PBKDF2", false, ["deriveKey"]);
          const k = await crypto.subtle.deriveKey(
            { name: "PBKDF2", salt: b64dec(w.salt), iterations: w.iter, hash: "SHA-256" },
            base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
          );
          const master = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64dec(w.iv) }, k, b64dec(w.ct));
          const mk = await crypto.subtle.importKey("raw", master, { name: "AES-GCM" }, false, ["decrypt"]);
          const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64dec(S.vaultMeta.body.iv) }, mk, b64dec(S.vaultMeta.body.ct));
          // T-60: מפתח-סשן-לא-ניתן-לחילוץ — רק-חותם, אף-פעם-לא-נקרא
          S.sessionKey = await crypto.subtle.importKey("raw", master, { name: "AES-GCM" }, false, ["encrypt"]);
          return JSON.parse(new TextDecoder().decode(pt));
        } catch {}
      }
    }
    throw new Error("rejected");
  }
  const b64dec = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function boot() {
    $("foot-ver").textContent = VERSION;
    try {
      const r = await fetch("vault.enc.json", { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      S.vaultMeta = await r.json();
      const kb = ((S.vaultMeta.body?.ct ?? "").length * 0.75) / 1024;
      const iters = (S.vaultMeta.wraps?.[0]?.iter ?? 0).toLocaleString();
      $("seal-badge").textContent = "כספת חתומה";
      $("seal-badge").className = "badge badge-ok";
      $("seal-meta").textContent =
        `AES-256-GCM · PBKDF2 ${iters} · ${S.vaultMeta.wraps?.length ?? "?"} wraps · ${kb.toFixed(1)}KB · ${S.vaultMeta.gate?.hint ?? ""}`;
      $("pass").disabled = false;
      $("unlock-btn").disabled = false;
    } catch (e) {
      $("seal-badge").textContent = "כספת חסרה";
      $("seal-badge").className = "badge badge-bad";
      $("seal-meta").textContent = "vault.enc.json לא נמצא — " + e.message;
    }
  }

  /* T-58 · חוק-ההדבקה-הרב-שורה (נמדד-חי): שדה-<input>-חד-שורתי חותך-הדבקה-של-קובץ-סיסמה-מלא
     (קובץ-המפתח-האישי-של-המפעיל — קנון-פנימי-אישי) כבר-בסניטציה-של-הדפדפן, כך-שהקנון-המשותף
     עם-console/ לא-היה-ניתן-להקלדה-בכלל. לוכדים-את-אירוע-ההדבקה לפני-הסניטציה, טוחנים-שורות-לקנון,
     ומזרימים-לשדה — ההדבקה-המלאה-פותחת-wrap[canon-62] במדויק-כפי-שהחוקה-מבטיחה. */
  $("pass").addEventListener("paste", (ev) => {
    const t = ev.clipboardData?.getData("text");
    if (!t || !/[\r\n]/.test(t)) return; // הדבקה-חד-שורתית — התנהגות-רגילה
    ev.preventDefault();
    $("pass").value = t.replace(/[\r\n]+/g, "").trim();
  });

  $("gate-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = $("unlock-btn");
    const typed = $("pass").value;
    if (!typed || !S.vaultMeta) return;
    btn.disabled = true; btn.textContent = "גוזר מפתח (600k איטרציות)…";
    $("gate-error").hidden = true;
    let payload = null, ms = 0;
    try {
      const t0 = performance.now();
      payload = await tryUnlock(typed);
      ms = Math.round(performance.now() - t0);
      S.payload = payload;
      $("pass").value = "";
      enterConsole(ms);
      fetchPulse();   // T-60: פולס-המנוע זורם-מיד-עם-הפתיחה
    } catch {
      $("gate-error").textContent = "סיסמה שגויה — ה-GCM מאמת ודוחה. הכספת נשארת חתומה.";
      $("gate-error").hidden = false;
      btn.disabled = false; btn.textContent = "פתח את הכספת";
    }
  });

  function enterConsole(ms) {
    $("gate").hidden = true;
    $("console").hidden = false;
    $("unlock-badge").textContent = "כספת פתוחה";
    log("unlock", `vault unlocked in ${ms}ms · ${S.payload.accounts.length} accounts · ${S.payload.audit?.pass ?? "?"} verified keys`);
    // populate selectors
    const accs = S.payload.accounts;
    const verAccs = verifiedAccounts();
    for (const selId of ["op-account", "key-account"]) {
      const sel = $(selId);
      sel.innerHTML = "";
      for (const a of accs) {
        const o = document.createElement("option");
        o.value = a.username;
        o.textContent = a.username + (a.tier ? " · " + a.tier : "");
        sel.appendChild(o);
      }
    }
    renderCustody();
    renderAudit();
    renderOpsFields();
    refreshLive();
    bumpIdle();
  }

  function verifiedAccounts() {
    return S.payload.accounts.filter((a) =>
      a.keys && (a.keys.posting?.wif || a.keys.posting) && (a.custody ?? "").includes("verified"));
  }

  /* ═══════════════ RPC (ציבורי, עם fallback) ═══════════════ */
  const EP = { steem: 0, hive: 0 };
  async function rpc(chain, method, params) {
    const endpoints = S.payload?.endpoints?.[chain] ?? (chain === "steem" ? ["https://api.steemit.com"] : ["https://api.hive.blog"]);
    let lastErr;
    for (let i = 0; i < endpoints.length + 1; i++) {
      const url = endpoints[(EP[chain] + i) % endpoints.length];
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
          signal: AbortSignal.timeout(15000),
        });
        const j = await r.json();
        if (j.error) throw new Error(j.error.message ?? JSON.stringify(j.error).slice(0, 120));
        EP[chain] = (EP[chain] + i) % endpoints.length;
        return j.result;
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  const toNum = (s) => parseFloat(String(s).replace(/[A-Za-z ]+/g, "")) || 0;
  const vestsToSp = (v) => toNum(v) / 1e6;
  const vpApprox = (a) => {
    const net = toNum(a.vesting_shares) - toNum(a.delegated_vesting_shares) + toNum(a.received_vesting_shares);
    const max = net * 1e6;
    const elapsed = (Date.now() - Date.parse(a.last_vote_time + "Z")) / 1000;
    const regen = max / 432000;
    const mana = Math.min(max, elapsed * regen);
    return max > 0 ? Math.max(0, Math.min(100, (mana / max) * 100)) : 0;
  };

  async function loadChainState(chain, usernames) {
    const accs = await rpc(chain, "condenser_api.get_accounts", [usernames]);
    const map = Object.fromEntries((accs ?? []).map((a) => [a.name, a]));
    let dgpo = null;
    try { dgpo = await rpc(chain, "condenser_api.get_dynamic_global_properties", []); } catch {}
    return { map, dgpo };
  }

  /* ═══════════════ לוח-מחוונים ═══════════════ */
  async function refreshLive() {
    $("chain-state").innerHTML = '<span class="muted">טוען…</span>';
    const usernames = S.payload.accounts.map((a) => a.username).filter(Boolean);
    const live = { steem: {}, hive: {} };
    try {
      const st = await loadChainState("steem", usernames);
      live.steem = st.map; S.dgpo = st.dgpo;
      const hi = await loadChainState("hive", usernames);
      live.hive = hi.map;
      S.live = live;
      renderOverview();
      renderAccounts();
    } catch (e) {
      $("chain-state").innerHTML = `<li><span class="bad">שגיאת RPC: ${escapeHtml(String(e.message).slice(0, 120))}</span></li>`;
    }
  }

  function renderOverview() {
    const accs = S.payload.accounts.filter((a) => a.username);
    let sp = 0, liquid = 0, sbd = 0, pendingV = 0, pendingN = 0;
    for (const [chain, map] of Object.entries(S.live ?? {})) {
      for (const u of accs.map((a) => a.username)) {
        const a = map[u];
        if (!a) continue;
        sp += vestsToSp(a.vesting_shares) - vestsToSp(a.delegated_vesting_shares) + vestsToSp(a.received_vesting_shares);
        if (chain === "steem") { liquid += toNum(a.balance); sbd += toNum(a.sbd_balance); }
        const pv = toNum(a.reward_vesting_balance);
        if (pv > 0) pendingN++;
        pendingV += vestsToSp(a.reward_vesting_balance);
      }
    }
    const verified = S.payload.audit?.pass ?? 0;
    const stale = S.payload.audit?.fail ?? 0;
    $("stat-cards").innerHTML = `
      <div class="stat"><div class="k">חשבונות בצי</div><div class="v">${accs.length}</div><div class="s">15 ברוטו · שתי שרשרות</div></div>
      <div class="stat"><div class="k">SP אפקטיבי Σ (שתי שרשרות)</div><div class="v">${sp.toFixed(2)}</div><div class="s">vests נטו</div></div>
      <div class="stat"><div class="k">STEEM נזיל Σ</div><div class="v">${liquid.toFixed(3)}</div><div class="s">steem בלבד</div></div>
      <div class="stat"><div class="k">SBD Σ</div><div class="v">${sbd.toFixed(3)}</div><div class="s">steem בלבד</div></div>
      <div class="stat"><div class="k">פידיונות-פתוחים</div><div class="v">${pendingN}</div><div class="s">≈${pendingV.toFixed(3)} SP ממתין</div></div>
      <div class="stat"><div class="k">נאמנות</div><div class="v ${stale ? "warn" : "ok"}">${verified}✓ / ${stale}✗</div><div class="s">מפתחות מול-שרשרת</div></div>`;

    const dgpo = S.dgpo;
    $("chain-state").innerHTML = dgpo ? `
      <li><span>ראש-השרשרת</span><span class="val">${escapeHtml(String(dgpo.head_block_number))} (#${escapeHtml(String(dgpo.head_block_id).slice(0, 10))}…)</span></li>
      <li><span>זמן-שרשרת</span><span class="val">${escapeHtml(String(dgpo.time)).replace("T", " ")}</span></li>
      <li><span>אספקה נוכחית</span><span class="val">${escapeHtml(String(dgpo.current_supply))}</span></li>
      <li><span>קרן-הווסטים</span><span class="val">${toNum(dgpo.total_vesting_fund_steem).toFixed(0)} STEEM</span></li>
      <li><span>vestsPerSP</span><span class="val">${(toNum(dgpo.total_vesting_shares) / toNum(dgpo.total_vesting_fund_steem) / 1e6).toFixed(3)}</span></li>
      <li><span>אחרונה-בלתי-הפיכה</span><span class="val">${escapeHtml(String(dgpo.last_irreversible_block_num))}</span></li>` : '<li><span class="muted">אין נתוני dgpo</span></li>';
  }

  function renderCustody() {
    const rows = S.payload.accounts.filter((a) => a.username).map((a) => {
      const c = a.custody ?? "";
      const cls = c.includes("verified") ? "ok" : c.includes("stale") ? "warn" : c.includes("not-on-chain") ? "bad" : "muted";
      return `<li><span>${a.username}</span><span class="val ${cls}">${c || "—"}</span></li>`;
    });
    $("custody-state").innerHTML = rows.join("");
  }

  function renderAudit() {
    const A = S.payload.audit ?? {};
    $("audit-view").innerHTML = `
      <li><span>נבדקו</span><span class="val">${A.pass ?? "?"} PASS / ${A.fail ?? "?"} FAIL</span></li>
      <li><span>מסקנה</span><span class="val ${A.verdict === "full-custody" ? "ok" : "warn"}">${A.verdict ?? "—"}</span></li>
      <li><span>בתאריך</span><span class="val">${(A.auditedAt ?? "").slice(0, 19).replace("T", " ")}</span></li>
      <li><span>פירוט</span><span class="val" style="white-space:normal">${A.detail ?? ""}</span></li>`;
  }

  function renderAccounts() {
    const chain = $("chain-filter").value;
    const map = (S.live ?? {})[chain] ?? {};
    const rows = [];
    for (const a of S.payload.accounts) {
      const acc = map[a.username];
      if (!acc) continue;
      const c = a.custody ?? "";
      const cls = c.includes("verified") ? "ok" : c.includes("stale") ? "warn" : c.includes("not-on-chain") ? "bad" : "muted";
      const sp = vestsToSp(acc.vesting_shares) - vestsToSp(acc.delegated_vesting_shares) + vestsToSp(acc.received_vesting_shares);
      const vp = vpApprox(acc);
      const pendV = vestsToSp(acc.reward_vesting_balance);
      const pendS = toNum(acc.reward_steem_balance) + toNum(acc.reward_sbd_balance);
      const pendTxt = (pendV > 0.000001 || pendS > 0.000001)
        ? `<button class="btn btn-mini" data-claim="${a.username}">פדה (${pendV.toFixed(3)} SP${pendS ? " +" + pendS.toFixed(3) : ""})</button>`
        : '<span class="mini">—</span>';
      rows.push(`<tr>
        <td><span class="nm">${a.username}</span><div class="mini">${a.tier ?? ""}</div></td>
        <td>${sp.toFixed(3)}</td>
        <td>${chain === "steem" ? toNum(acc.balance).toFixed(3) : toNum(acc.balance).toFixed(3)}</td>
        <td>${chain === "steem" ? toNum(acc.sbd_balance).toFixed(3) : "—"}</td>
        <td><span class="vpbar"><i style="width:${vp.toFixed(0)}%;background:${vp > 20 ? "var(--ok)" : "var(--warn)"}"></i></span> ≈${vp.toFixed(0)}%</td>
        <td>${pendTxt}</td>
        <td><span class="${cls}">${c || "—"}</span></td>
      </tr>`);
    }
    $("accounts-table").innerHTML = rows.length ? `<table>
      <thead><tr><th>חשבון</th><th>SP אפקטיבי</th><th>${chain === "steem" ? "STEEM" : "HIVE"} נזיל</th><th>SBD</th><th>כוח-הצבעה</th><th>פידיון</th><th>נאמנות</th></tr></thead>
      <tbody>${rows.join("")}</tbody></table>` : '<div class="muted pad">אין נתונים</div>';
    $("accounts-count").textContent = `(${rows.length} חי ב-${chain})`;
    for (const b of $("accounts-table").querySelectorAll("[data-claim]")) {
      b.addEventListener("click", () => claimOne(b.getAttribute("data-claim"), b));
    }
  }

  /* ═══════════════ פעולות ═══════════════ */
  function renderOpsFields() {
    const type = $("op-type").value;
    const F = [];
    const field = (name, label, val = "", ph = "", ta = false) =>
      ta
        ? `<label class="full">${label}<textarea id="f-${name}" rows="4" placeholder="${ph}">${val}</textarea></label>`
        : `<label>${label}<input id="f-${name}" value="${val}" placeholder="${ph}"></label>`;
    if (type === "vote") {
      F.push(field("author", "מחבר", "", "author-name"));
      F.push(field("permlink", "permlink", "", "the-post-permlink"));
      F.push(`<label>משקל %<input id="f-weight" type="number" min="-100" max="100" value="100"></label>`);
    } else if (type === "claim") {
      const acc = currentAccount();
      F.push(`<label class="full">פידיון-ממתין (מוזן אוטומטית מהמצב-החי)</label>`);
      F.push(field("reward_steem", "STEEM", "0.000"));
      F.push(field("reward_sbd", "SBD", "0.000"));
      F.push(field("reward_vests", "VESTS", "0.000000"));
      setTimeout(() => prefillClaim(), 0);
    } else if (type === "comment") {
      F.push(field("parent_author", "parent_author (ריק = פרסום-חדש)", ""));
      F.push(field("parent_permlink", "parent_permlink (לפרסום-חדש: תגית-ראשית)", "hive-1990"));
      F.push(field("permlink", "permlink", "", "unique-permlink-slug"));
      F.push(field("title", "כותרת"));
      F.push(field("body", "תוכן", "", "", true));
      F.push(field("json_metadata", "json_metadata", "{}"));
    } else if (type === "follow") {
      F.push(field("following", "לעקוב אחרי", "", "account-name"));
      F.push(`<label>מצב<select id="f-what"><option value="blog">blog (עקוב)</option><option value="ignore">ignore</option><option value="">בטל</option></select></label>`);
    } else if (type === "reblog") {
      F.push(field("author", "מחבר-הפוסט", "", "author-name"));
      F.push(field("permlink", "permlink", "", "the-post-permlink"));
    }
    $("op-fields").innerHTML = F.join("");
  }

  function currentAccount() {
    return S.payload.accounts.find((a) => a.username === $("op-account").value);
  }

  async function prefillClaim() {
    const u = $("op-account").value;
    const acc = (S.live?.steem ?? {})[u];
    if (!acc) return;
    $("f-reward_steem").value = acc.reward_steem_balance ?? "0.000 STEEM";
    $("f-reward_sbd").value = acc.reward_sbd_balance ?? "0.000 SBD";
    $("f-reward_vests").value = acc.reward_vesting_balance ?? "0.000000 VESTS";
  }

  /** בונה ops לפי הטופס */
  function buildOps() {
    const type = $("op-type").value;
    const account = $("op-account").value;
    const g = (id) => $(id)?.value ?? "";
    if (type === "vote") {
      const weight = Math.round(Number(g("f-weight")) * 100);
      return [["vote", { voter: account, author: g("f-author").trim(), permlink: g("f-permlink").trim(), weight }]];
    }
    if (type === "claim") {
      return [["claim_reward_balance", {
        account,
        reward_steem: normAsset(g("f-reward_steem"), "STEEM"),
        reward_sbd: normAsset(g("f-reward_sbd"), "SBD"),
        reward_vests: normAsset(g("f-reward_vests"), "VESTS"),
      }]];
    }
    if (type === "comment") {
      return [["comment", {
        parent_author: g("f-parent_author").trim(),
        parent_permlink: g("f-parent_permlink").trim(),
        author: account,
        permlink: g("f-permlink").trim(),
        title: g("f-title"),
        body: g("f-body"),
        json_metadata: g("f-json_metadata") || "{}",
      }]];
    }
    if (type === "follow") {
      const what = g("f-what") ? [g("f-what")] : [];
      return [["custom_json", {
        required_auths: [], required_posting_auths: [account],
        id: "follow",
        json: JSON.stringify(["follow", { follower: account, following: g("f-following").trim(), what }]),
      }]];
    }
    if (type === "reblog") {
      return [["custom_json", {
        required_auths: [], required_posting_auths: [account],
        id: "reblog",
        json: JSON.stringify(["reblog", { account, author: g("f-author").trim(), permlink: g("f-permlink").trim() }]),
      }]];
    }
    throw new Error("op-type לא נתמך");
  }
  const normAsset = (v, sym) => {
    const n = parseFloat(String(v).replace(/[A-Za-z ]+/g, "")) || 0;
    return `${n.toFixed(sym === "VESTS" ? 6 : 3)} ${sym}`;
  };

  async function getPostingPriv(account) {
    const acc = S.payload.accounts.find((a) => a.username === account);
    if (!acc) throw new Error("חשבון לא בכספת: " + account);
    const c = acc.custody ?? "";
    if (c.includes("stale") || c.includes("not-on-chain") || c.includes("no-live-keys")) {
      throw new Error(`"${account}" נחסם: נאמנות-פרסומית לא חיה (${c}). השרשרת תדחה את החתימה — אפס-אמון פעיל.`);
    }
    const kp = acc.keys?.posting;
    const wif = typeof kp === "string" ? kp : kp?.wif;
    if (!wif) throw new Error("אין posting WIF ל" + account);
    return wifToPrivAny(wif);
  }

  async function signTx(account, ops) {
    const priv = await getPostingPriv(account);
    const dgpo = S.dgpo ?? await rpc("steem", "condenser_api.get_dynamic_global_properties", []);
    S.dgpo = dgpo;
    return buildTx({ ops, dgpo, priv });
  }

  async function broadcast(txJson) {
    return rpc("steem", "condenser_api.broadcast_transaction", [txJson]);
  }

  $("op-type").addEventListener("change", renderOpsFields);
  $("op-account").addEventListener("change", () => { if ($("op-type").value === "claim") prefillClaim(); renderCuration(); });

  $("op-dry").addEventListener("click", async () => {
    try {
      const ops = buildOps();
      const signed = await signTx($("op-account").value, ops);
      const out = $("op-result");
      out.hidden = false;
      out.textContent = `DRY-RUN — לא שודר
txid: ${signed.txid}
ops: ${JSON.stringify(ops[0]).slice(0, 400)}
signatures: ${signed.json.signatures[0].slice(0, 32)}…
expiration: ${signed.json.expiration}`;
      log("dry-run", `${$("op-type").value} by ${$("op-account").value} → txid ${signed.txid.slice(0, 16)}…`);
    } catch (e) {
      const out = $("op-result");
      out.hidden = false;
      out.textContent = "שגיאת חתימה: " + e.message;
      log("dry-run-fail", e.message, "bad");
    }
  });

  $("op-send").addEventListener("click", async () => {
    if (!confirm("לחתום ולשדר לשרשרת החיה? הפעולה בלתי-הפיכה.")) return;
    const btn = $("op-send");
    btn.disabled = true;
    try {
      const ops = buildOps();
      const account = $("op-account").value;
      const signed = await signTx(account, ops);
      await broadcast(signed.json);
      const out = $("op-result");
      out.hidden = false;
      out.textContent = `SHIPPED ✅
txid: ${signed.txid}
קישור: https://steemscan.com/transaction/${signed.txid}`;
      log("broadcast", `${ops[0][0]} by ${account} → txid ${signed.txid}`, "ok");
      setTimeout(refreshLive, 3500);
    } catch (e) {
      const out = $("op-result");
      out.hidden = false;
      out.textContent = "שידור נכשל: " + e.message;
      log("broadcast-fail", e.message, "bad");
    } finally { btn.disabled = false; }
  });

  async function claimOne(username, btn) {
    const acc = (S.live?.steem ?? {})[username];
    if (!acc) return;
    const ops = [["claim_reward_balance", {
      account: username,
      reward_steem: acc.reward_steem_balance ?? "0.000 STEEM",
      reward_sbd: acc.reward_sbd_balance ?? "0.000 SBD",
      reward_vests: acc.reward_vesting_balance ?? "0.000000 VESTS",
    }]];
    if (btn) { btn.disabled = true; btn.textContent = "חותם…"; }
    try {
      const signed = await signTx(username, ops);
      await broadcast(signed.json);
      log("claim", `${username} → ${signed.txid.slice(0, 16)}…`, "ok");
      if (btn) btn.textContent = "נשלח ✅";
    } catch (e) {
      log("claim-fail", `${username}: ${e.message}`, "bad");
      if (btn) { btn.textContent = "נכשל"; btn.disabled = false; }
    }
  }

  $("claim-all-btn").addEventListener("click", async () => {
    const btn = $("claim-all-btn");
    const out = $("claim-all-result");
    btn.disabled = true;
    out.hidden = false;
    const accs = S.payload.accounts.filter((a) => (a.custody ?? "").includes("verified") && a.keys?.posting);
    const lines = [];
    let okN = 0, skip = 0;
    for (const a of accs) {
      const acc = (S.live?.steem ?? {})[a.username];
      if (!acc) { lines.push(`${a.username}: לא חי — דלג`); skip++; continue; }
      const hasPending = toNum(acc.reward_vesting_balance) > 0 || toNum(acc.reward_steem_balance) > 0 || toNum(acc.reward_sbd_balance) > 0;
      if (!hasPending) { lines.push(`${a.username}: אין פידיון-פתוח`); skip++; continue; }
      try {
        const signed = await signTx(a.username, [["claim_reward_balance", {
          account: a.username,
          reward_steem: acc.reward_steem_balance,
          reward_sbd: acc.reward_sbd_balance,
          reward_vests: acc.reward_vesting_balance,
        }]]);
        await broadcast(signed.json);
        lines.push(`${a.username}: נשלח ✅ ${signed.txid.slice(0, 16)}…`);
        okN++;
      } catch (e) { lines.push(`${a.username}: FAIL ${String(e.message).slice(0, 80)}`); }
    }
    out.textContent = lines.join("\n");
    log("claim-all", `${okN} claimed, ${skip} skipped`);
    btn.disabled = false;
    setTimeout(refreshLive, 3500);
  });

  /* ═══════════════ עורק-התשואה → תור-ה-curation (T-55 · trace 1a1249d10fa60055) ═══════════════
   * חוק-המישורים במלואו: המנוע-מתכנן (קבלה-חתומה-בשרשרת בריפו-הציבורי) ·
   * המפעיל-מאשר (בחירה-חיה) · הדפדפן-חותם-ומשדר. אפס-מפתחות-ברשת.
   * אפס-אמון-גם-כאן: הקבלה-מאומתת (schema/verdict/selftest) · חלון-הגיל-מחושב-עכשיו
   * (לא-כפי-שהמנוע-מדד) · יום-מקס · אפס-הצבעה-כפולה (זיכרון-חתימות-מקומי).
   * הזיכרון-השמור = נתונים-פומביים-בלבד (permlink+txid+תאריך) — אף-סוד-לעולם-לא.
   * ─────────────────────────────────────────────────────────────────────── */
  const CUR_SOURCES = [
    "../receipts/fleet-yield/last.json", // אותו-מקור (T-55b): Pages-מגישה-את-הקבלה-בעצמה — אפס-חוצי-מקור, חי-בכל-מקום
    "/api/curation", // ממסר-מקומי-כן (T-55): נמדד-חי ש-fetch-דפדפני-לחוץ-חוץ-חסום
    "https://raw.githubusercontent.com/roshpinacare-sys/Sandbox/main/receipts/fleet-yield/last.json",
    "https://cdn.jsdelivr.net/gh/roshpinacare-sys/Sandbox@main/receipts/fleet-yield/last.json",
  ];
  const CUR = {
    receipt: null,
    fetchedAt: null,
    source: "",
    queue: new Set(),                    // author/permlink — אישור-המפעיל (סשן-בלבד)
    signed: (() => { try { return JSON.parse(localStorage.getItem("sovereign-signed-votes") || "{}"); } catch { return {}; } })(),
    /* T-56: אמת-השרשרת — מפת-ההצבעות-האחרונות-של-המצביע (מהקבלה · נתונים-פומביים).
     * null = הקבלה-עצמה-מודה-שהדה-דופ-לא-זמין (שני-המקורות-מתו במנוע) — מוצג-בכנות. */
    onChain: null,
  };
  const saveSigned = () => { try { localStorage.setItem("sovereign-signed-votes", JSON.stringify(CUR.signed)); } catch {} };
  /* escapeHtml-חי-בקובץ-זה-מלמטה (חוק-T-42) — כל-נתון-חוץ-מהקבלה-עובר-הימלטות */
  const curKey = (c) => `${c.author}/${c.permlink}`;
  /* T-56: מפת-האמת-מהשרשרת — מועמד-שהוצב-כבר-מכל-מכשיר מזוהה-כאן */
  const buildOnChain = (r) => {
    const list = r?.voter?.recentVotes;
    CUR.onChain = Array.isArray(list)
      ? new Map(list.filter((v) => v?.k).map((v) => [String(v.k), { w: Number(v.w) || 0, at: String(v.at || "") }]))
      : null;
  };
  const chainVoted = (key) => (CUR.onChain ? CUR.onChain.get(key) ?? null : null);
  const REC_TIME = () => Date.parse(CUR.receipt?.at ?? "") || Date.parse((CUR.receipt?.at ?? "") + "Z") || 0;
  const REC_AGE_MS = () => (REC_TIME() ? Date.now() - REC_TIME() : Number.POSITIVE_INFINITY); // קבלה-בלי-זמן-תקין = זקנה-מיידית (fail-closed)
  const rowAgeMin = (c) => Math.round((Number(c.ageMinutes) || 0) + REC_AGE_MS() / 60000);
  const capToday = () => {
    const today = new Date().toISOString().slice(0, 10);
    /* T-56: חציית-מכשירים — מה-שחתום-במקומי + מה-שהשרשרת-מעידה-על-היום (איחוד-מפתחות).
     * הקבלה-יכולה-להיות-בת-שעות — הספירה-המשותפת-היא-רצפה-כנה, לא-תקרה-מדויקת. */
    const local = Object.entries(CUR.signed).filter(([, v]) => String(v?.at || "").slice(0, 10) === today).map(([k]) => k);
    const chain = CUR.onChain
      ? [...CUR.onChain.entries()].filter(([, v]) => String(v.at || "").slice(0, 10) === today).map(([k]) => k)
      : [];
    return new Set([...local, ...chain]).size;
  };

  async function fetchCuration() {
    const table = $("cur-table");
    $("cur-verdict").hidden = true;
    $("cur-provenance").textContent = "מאזין…";
    for (const src of CUR_SOURCES) {
      try {
        const res = await fetch(src, { signal: AbortSignal.timeout(12000), cache: "no-store" });
        if (!res.ok) continue;
        let r = await res.json();
        const u = new URL(src, location.href); // פריסה-בטוחה-לנתיב-יחסי (new URL(src).host-זורק-ביחסיים-נמדד-חי)
        if (r?.receipt?.schema) r = r.receipt; // ממסר-אורז ← פתיחה
        CUR.source = u.origin === location.origin ? "same-origin (Pages artifact)" : u.host;
        if (r?.schema !== "fleet-yield/1") throw new Error("schema-לא-מוכר");
        if (r?.verdict !== "INTEL-OK" && r?.verdict !== "INTEL-PARTIAL") throw new Error("verdict=" + r?.verdict);
        if (r?.selftest?.status !== "PASS") throw new Error("selftest=" + r?.selftest?.status);
        CUR.receipt = r;
        CUR.fetchedAt = Date.now();
        buildOnChain(r); // T-56: אמת-השרשרת-נטענת-מהקבלה (או-null-כנה)
        renderCuration();
        log("curation-fetch", `INTEL ${r.verdict} · ${r.candidates.selected.length} candidates · engine ${String(r.engineHead).slice(0, 8)}… · ${CUR.source}` + (CUR.onChain ? ` · dedup ${CUR.onChain.size}` : " · dedup לא-זמין"), "ok");
        return;
      } catch { /* המקור-הבא — כנות: אם-כולם-נפלו נכתוב-זאת-למטה */ }
    }
    table.innerHTML = `<div class="muted pad bad">לא ניתן להשיג מקבלת-אינטל-מאומתת מאף-מקור (נמדדו: ${CUR_SOURCES.length}). אפס-ירוק-שקרי — התור-נשאר-ריק.</div>`;
    log("curation-fetch", "כל-המקורות-נפלו", "bad");
  }

  function renderCuration() {
    const r = CUR.receipt;
    if (!r) return;
    const table = $("cur-table");
    const ageH = REC_AGE_MS() / 3600000;
    const [ageMinRaw, ageMaxRaw] = r.laws?.ageWindow ?? [10, 240];
    const ageMin = Number(ageMinRaw) || 10, ageMax = Number(ageMaxRaw) || 240;
    const maxPerDay = Number(r.laws?.maxPerDay) || 4;

    const badge = $("cur-verdict");
    badge.hidden = false;
    badge.textContent = `${r.verdict} · selftest ${r.selftest.status} · גיל-המקבלה ${ageH < 1 ? Math.round(ageH * 60) + " דק'" : ageH.toFixed(1) + " שע'"}`;
    badge.className = "badge " + (ageH > 3 ? "badge-bad" : "badge-ok");
    $("cur-provenance").textContent = `engine ${String(r.engineHead).slice(0, 8)}… · מרקל ${String(r.chain?.cur || "").slice(0, 8)}… · ${CUR.source}`;

    const staleBlock = ageH > 12;
    $("cur-meta").innerHTML = [
      `חוקי-החלון: ${ageMin}–${ageMax} דק' (מחושב-מחדש-כאן, עכשיו)`,
      `יום-מקס: ${maxPerDay} · חתומו-היום: ${capToday()}`,
      `נסרקו: ${Number(r.candidates.scanned) || 0} · נבחרו: ${(r.candidates.selected || []).length} · צפופים: ${Number(r.candidates.crowded) || 0}`,
      `דה-דופ-שרשרת: ${CUR.onChain ? `${CUR.onChain.size} הצבעות-מוכרות (as-of-המקבלה)` : "לא-זמין-כנה (הקבלה-מדווחת)"}`,
      r.candidates.dayCapReached ? `<span class="warn">מכסת-היום-הושגה-במנוע</span>` : "",
    ].filter(Boolean).map((s) => `<span>· ${s}</span>`).join(" ");

    const rows = (r.candidates.selected || []).map((c) => {
      const key = curKey(c);
      const w = Math.round(Number(c.weight) || 0);
      const age = rowAgeMin(c);
      const expired = age < ageMin || age > ageMax;
      const signedInfo = CUR.signed[key];
      const onChainInfo = chainVoted(key); // T-56: אמת-השרשרת-חוצה-מכשירים
      if (onChainInfo && CUR.queue.has(key)) { CUR.queue.delete(key); } // אפס-הצבעה-כפולה — יציאה-שקטה-מהתור
      const queued = CUR.queue.has(key);
      const wPct = (w / 100).toFixed(2);
      const eAuthor = escapeHtml(c.author), eKey = escapeHtml(key);
      const ePermlink = escapeHtml(String(c.permlink).slice(0, 42)) + (String(c.permlink).length > 42 ? "…" : "");
      const eTag = escapeHtml(c.tag ?? "");
      const state = signedInfo
        ? `<span class="badge badge-ok">חתום ✓</span>`
        : onChainInfo
        ? `<span class="badge badge-ok">בשרשרת ✓ (מכל-מכשיר)</span>`
        : staleBlock
        ? `<span class="badge badge-bad">מקבלה-זקנה (${ageH.toFixed(1)} שע') — חסום</span>`
        : expired
        ? `<span class="badge badge-bad">פג-חלון-גיל (${age} דק')</span>`
        : queued
        ? `<span class="badge badge-ok">בתור</span> <button class="btn btn-ghost btn-mini" data-cur-remove="${eKey}">הסר</button>`
        : `<button class="btn btn-mini btn-primary" data-cur-add="${eKey}">אשר לתור</button>`;
      return `<tr>
        <td><strong>${eAuthor}</strong></td>
        <td class="s"><a href="https://steemit.com/@${encodeURIComponent(c.author)}/${encodeURIComponent(c.permlink)}" target="_blank" rel="noopener noreferrer">${ePermlink}</a></td>
        <td>${wPct}%</td>
        <td>${age} דק'${expired && !signedInfo && !onChainInfo ? " ⚠" : ""}</td>
        <td class="muted s">${eTag}</td>
        <td>${state}${signedInfo ? `<div class="muted s"><a href="https://steemscan.com/transaction/${encodeURIComponent(signedInfo.txid)}" target="_blank" rel="noopener noreferrer">${escapeHtml(String(signedInfo.txid).slice(0, 14))}…</a></div>` : ""}${onChainInfo && !signedInfo ? `<div class="muted s">שרשרת: ${escapeHtml(String(onChainInfo.at).replace("T", " ").slice(0, 16))} · ${((Number(onChainInfo.w) || 0) / 100).toFixed(2)}%</div>` : ""}</td>
      </tr>`;
    }).join("");
    table.innerHTML = rows
      ? `<table style="width:100%;border-collapse:collapse;text-align:right">
          <thead><tr class="muted s"><th>מחבר</th><th>פוסט</th><th>משקל</th><th>גיל-עכשיו</th><th>תגית</th><th>מצב</th></tr></thead>
          <tbody>${rows}</tbody></table>`
      : `<div class="muted pad">המקבלה-אינה-מכילה-מועמדים (כנה).</div>`;

    const remaining = Math.max(0, maxPerDay - capToday());
    $("cur-cap").textContent = `תור: ${CUR.queue.size} · נותר-במכסה-היום: ${remaining}/${maxPerDay}`;
    const voter = r.voter?.account ?? "";
    const acc = $("op-account").value;
    const voterNote = acc && voter && acc !== voter ? ` · ⚠ חותמים-מ-${acc} (המנוע-תכנן-עבור ${voter})` : "";
    $("cur-sign").disabled = staleBlock || CUR.queue.size === 0;
    $("cur-sign").textContent = `חתום ושדר את-התור (${CUR.queue.size})${voterNote}`;
    $("cur-clear").hidden = CUR.queue.size === 0;
    $("cur-sign").dataset.remaining = String(remaining);
    $("cur-sign").dataset.maxperday = String(maxPerDay);
    $("cur-sign").dataset.stale = staleBlock ? "1" : "0";
  }

  $("cur-table").addEventListener("click", (e) => {
    const add = e.target.closest?.("[data-cur-add]");
    const rem = e.target.closest?.("[data-cur-remove]");
    if (add) {
      const c = CUR.receipt.candidates.selected.find((x) => curKey(x) === add.dataset.curAdd);
      if (c) { CUR.queue.add(curKey(c)); renderCuration(); log("curation-queue", `+ ${curKey(c)} @ ${Math.round(c.weight / 100)}%`); }
    } else if (rem) {
      CUR.queue.delete(rem.dataset.curRemove);
      renderCuration();
    }
  });
  $("cur-refresh").addEventListener("click", fetchCuration);
  $("cur-clear").addEventListener("click", () => { CUR.queue.clear(); renderCuration(); });

  $("cur-sign").addEventListener("click", async () => {
    const btn = $("cur-sign");
    const out = $("cur-result");
    const n = CUR.queue.size;
    if (n === 0) return;
    if (btn.dataset.stale === "1") { out.hidden = false; out.textContent = "נחסם: המקבלה-זקנה-מדי — רענן-מקבלה (אפס-אמון)."; return; }
    const remaining = Number(btn.dataset.remaining || 0);
    const maxPerDay = Number(btn.dataset.maxperday || 4);
    if (n > remaining) { out.hidden = false; out.textContent = `נחסם: התור (${n}) חורג-ממכסת-היום-הנותרת (${remaining}/${maxPerDay}) — חוק-יום-המקס-נאכף-גם-כאן.`; return; }
    const account = $("op-account").value;
    if (!account) { out.hidden = false; out.textContent = "בחר חשבון-חתימה למעלה (חתימה-מטעם)."; return; }
    if (!S.payload) { out.hidden = false; out.textContent = "הכספת-נעולה — פתח-את-הכספת-קודם (החתימה-דורשת-מפתח-פרסומי-חי)."; return; }
    if (!confirm(`לחתום ולשדר ${n} הצבעות מ-${account}? כל-הצבעה-עסקה-נפרדת-ובלתי-הפיכה.`)) return;
    btn.disabled = true;
    out.hidden = false;
    const lines = [];
    let okN = 0;
    const items = CUR.receipt.candidates.selected.filter((c) => CUR.queue.has(curKey(c)));
    for (const c of items) {
      const w = Math.round(Number(c.weight) || 0);
      if (!(w > 0 && w <= 10000)) { lines.push(`${c.author}: נחסם — משקל-שרשרת-לא-חוקי (${w})`); CUR.queue.delete(curKey(c)); continue; }
      /* T-56: בדיקת-אמת-שנייה-ברגע-החתימה (אפס-אמון — הקבלה-היא-רק-תוכנית):
       * אם-השרשרת-מעידה-שכבר-הוצב — חסימה-כנה, אפילו-אם-ה-UI-פספס. */
      const nowVoted = chainVoted(curKey(c));
      if (nowVoted) { lines.push(`${c.author}: נחסם — כבר-בשרשרת (${String(nowVoted.at).replace("T", " ").slice(0, 16)}) · אפס-הצבעה-כפולה`); CUR.queue.delete(curKey(c)); continue; }
      try {
        const ops = [["vote", { voter: account, author: c.author, permlink: c.permlink, weight: w }]];
        const signed = await signTx(account, ops);
        await broadcast(signed.json);
        CUR.signed[curKey(c)] = { txid: signed.txid, at: new Date().toISOString(), voter: account, weight: w };
        saveSigned();
        CUR.queue.delete(curKey(c));
        lines.push(`${c.author}: ✅ ${w / 100}% → txid ${signed.txid.slice(0, 16)}…`);
        log("curation-vote", `${account} → ${c.author} @ ${w / 100}% → ${signed.txid.slice(0, 14)}…`, "ok");
        okN++;
      } catch (e) {
        lines.push(`${c.author}: FAIL ${String(e.message).slice(0, 90)}`);
        log("curation-vote-fail", `${c.author}: ${e.message}`, "bad");
      }
    }
    out.textContent = lines.join("\n") || "התור-התרוקן.";
    btn.disabled = false;
    renderCuration();
    setTimeout(refreshLive, 3500);
  });

  /* טעינה-ראשונה — נתונים-ציבוריים (אין-צורך-בכספת-פתוחה) */
  fetchCuration();


  /* ═══════════════ מפתחות ═══════════════ */
  function currentKey() {
    const acc = S.payload.accounts.find((a) => a.username === $("key-account").value);
    if (!acc) return null;
    const chain = $("key-chain").value;
    const role = $("key-role").value;
    const holder = chain === "steem" ? acc.keys : (acc.keys?.[chain] ?? acc.keys);
    const kp = holder?.[role];
    const wif = typeof kp === "string" ? kp : kp?.wif;
    return wif ? { wif, chain, role, username: acc.username } : null;
  }

  $("key-reveal").addEventListener("click", () => {
    const k = currentKey();
    const out = $("key-out");
    if (!k) { out.hidden = false; out.textContent = "אין מפתח כזה בכספת"; return; }
    out.hidden = false;
    out.textContent = k.wif;
    clearTimeout(S.keyRevealTimer);
    S.keyRevealTimer = setTimeout(() => { out.textContent = "(נסגר אוטומטית)"; }, 30000);
    log("reveal", `${k.username}.${k.chain}.${k.role} — חשוף ל-30 שניות`, "warn");
  });
  $("key-out").addEventListener("dblclick", () => {
    $("key-out").textContent = "(נסגר)";
  });

  $("key-copy").addEventListener("click", async () => {
    const k = currentKey();
    if (!k) return;
    try { await navigator.clipboard.writeText(k.wif); log("copy", `${k.username}.${k.role} copied to clipboard`, "warn"); }
    catch { log("copy-fail", "clipboard blocked", "bad"); }
  });

  /* ═══════════════ ניווט + נעילה ═══════════════ */
  for (const t of document.querySelectorAll(".tab")) {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => { x.classList.remove("active"); x.setAttribute("aria-selected", "false"); });
      t.classList.add("active");
      t.setAttribute("aria-selected", "true");
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      $("panel-" + t.dataset.tab).classList.add("active");
      if (t.dataset.tab === "log") renderLog();
      bumpIdle();
    });
  }

  function lock(reason) {
    S.payload = null;
    S.live = null;
    S.sessionKey = null;   // T-60: המפתח-מת-עם-הנעילה — אפס-שרידים
    S.envelopes = [];
    S.log = [];
    clearTimeout(S.lockTimer);
    $("console").hidden = true;
    $("gate").hidden = false;
    $("unlock-btn").disabled = false;
    $("unlock-btn").textContent = "פתח את הכספת";
    $("gate-error").hidden = true;
    log("lock", reason ?? "manual");
  }
  $("lock-btn").addEventListener("click", () => lock("manual"));

  function bumpIdle() {
    S.idleAt = Date.now();
    clearTimeout(S.lockTimer);
    if (!S.payload) return;
    S.lockTimer = setTimeout(() => lock("auto — 15 דקות חוסר-פעילות"), LOCK_MS);
    tickAutolock();
  }
  function tickAutolock() {
    if (!S.payload) return;
    const left = Math.max(0, LOCK_MS - (Date.now() - S.idleAt));
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    $("autolock").textContent = `נעילה-אוטומטית בעוד ${m}:${String(s).padStart(2, "0")}`;
    if (left > 0) setTimeout(tickAutolock, 1000);
  }
  ["click", "keydown", "pointerdown"].forEach((ev) => document.addEventListener(ev, bumpIdle, { passive: true }));
  // דילוג-על-כל-קליק: bumpIdle מדליק טיימר מחדש — קל מאוד, אין דליפה משמעותית

  function renderLog() {
    const v = $("log-view");
    if (!v) return;
    v.innerHTML = S.log.length
      ? S.log.map((l) => `<div class="log-line"><span class="t">${l.t}</span> <span class="${l.cls}">${escapeHtml(l.action)}</span> ${escapeHtml(l.detail)}</div>`).join("")
      : '<span class="muted">ריק</span>';
  }
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  $("refresh-btn").addEventListener("click", refreshLive);
  $("accounts-refresh").addEventListener("click", refreshLive);
  $("chain-filter").addEventListener("change", renderAccounts);
  $("log-clear").addEventListener("click", () => { S.log = []; renderLog(); });

  /* ═══════════ T-60 · צינור-החתימה: המנוע-מתכנן → המפעיל-מאשר → הכספת-חותמת ═══════════
   * הפולס: same-origin-קודם (בית-Pages: /receipts/) → raw-fallback (Render/localhost).
   * האישור: מעטפת AES-256-GCM תחת מפתח-סשן-לא-ניתן-לחילוץ — זיכרון-בלבד.
   * אפס-מפתח-עובר-על-החוט. */
  const PULSE_SOURCES = [
    "/receipts/cockpit-candidates.json",
    "https://raw.githubusercontent.com/roshpinacare-sys/Sandbox/main/receipts/cockpit-candidates.json",
  ];
  const b64enc = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  async function fetchPulse() {
    for (const url of PULSE_SOURCES) {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        S.pulse = await r.json();
        renderPulse(true);
        return;
      } catch { /* המקור-הבא — ואז-כנות */ }
    }
    renderPulse(false);
  }
  function pulseAgeMin() {
    if (!S.pulse?.pulseAt) return null;
    const ms = Date.now() - new Date(S.pulse.pulseAt).getTime();
    return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60000)) : null;
  }
  function renderPulse(ok) {
    const meta = $("pulse-meta"), tbl = $("pulse-table");
    if (!ok || !S.pulse) {
      meta.textContent = "אין-פולס — עורק-המועמדים-מהמנוע טרם-זרם (כנה, ללא-ירוק-מזויף)";
      tbl.innerHTML = '<div class="muted pad">אין-מועמדים-להצגה</div>';
      return;
    }
    const age = pulseAgeMin();
    const fresh = age !== null && age <= 200;
    meta.textContent =
      `פולס ${fresh ? "חי" : "מפגר"} · גיל ${age ?? "?"} דק' · verdict=${escapeHtml(S.pulse.verdict ?? "?")}` +
      ` · engine=${escapeHtml(S.pulse.engineHead ?? "?")} · selftest=${escapeHtml(S.pulse.selftest ?? "?")}` +
      ` · נסרקו ${S.pulse.scanned ?? 0} · נפסלו ${S.pulse.rejectedCount ?? 0}`;
    const rows = (S.pulse.candidates ?? []).map((c, i) =>
      `<tr><td>${escapeHtml(c.author)}</td>` +
      `<td class="mono">${escapeHtml(String(c.permlink ?? "").slice(0, 48))}${String(c.permlink ?? "").length > 48 ? "…" : ""}</td>` +
      `<td>${Number(c.weight ?? 0)}</td><td>${Number(c.ageMinutes ?? 0)} דק'</td>` +
      `<td>${escapeHtml(c.tag ?? "")}</td>` +
      `<td><button class="btn btn-primary" data-approve="${i}">אישור</button></td></tr>`
    ).join("");
    tbl.innerHTML =
      `<table><thead><tr><th>מחבר</th><th>פרמלינק</th><th>משקל</th><th>גיל</th><th>תגית</th><th></th></tr></thead><tbody>` +
      (rows || '<tr><td colspan="6" class="muted">אין-מועמדים-בפולס-זה</td></tr>') +
      `</tbody></table>`;
    tbl.querySelectorAll("[data-approve]").forEach((b) =>
      b.addEventListener("click", () => approveCandidate(Number(b.dataset.approve), b)),
    );
  }
  async function approveCandidate(i, btn) {
    if (!S.sessionKey) { log("approve-denied", "אין-מפתח-סשן — פתח-את-הכספת-קודם"); return; }
    const c = S.pulse?.candidates?.[i];
    if (!c) return;
    btn.disabled = true; btn.textContent = "חותם…";
    try {
      const id = `${c.author}/${c.permlink}`;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const pt = new TextEncoder().encode(JSON.stringify({
        v: 1,
        id,
        weight: Number(c.weight ?? 0),
        decidedAt: new Date().toISOString(),
        doctrine: "engine-plans · operator-approves · vault-signs · zero-keys-over-wire",
      }));
      const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, S.sessionKey, pt);
      const env = b64enc(iv) + "." + b64enc(ct);
      const fp = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env)))]
        .slice(0, 4).map((x) => x.toString(16).padStart(2, "0")).join("");
      S.envelopes.unshift({ id, fp, env, at: new Date().toISOString() });
      if (S.envelopes.length > 20) S.envelopes.pop();
      renderEnvelopes();
      log("approve", `${id} · מעטפה ${fp}`);
      btn.textContent = "אושר ✓";
    } catch (e) {
      btn.disabled = false; btn.textContent = "אישור";
      log("approve-fail", e.message ?? "seal error");
    }
  }
  function renderEnvelopes() {
    const pre = $("approve-log");
    if (!S.envelopes.length) { pre.textContent = "— אין-אישורים-בסשן-זה —"; return; }
    pre.textContent = S.envelopes.map((e) =>
      `[${e.at.slice(11, 19)}] ${e.id}\n    מעטפה ${e.fp} · ${e.env.length}B — להעברה-לנאמן-המנוע-בלבד`,
    ).join("\n");
  }

  boot();
})();
