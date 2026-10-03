// llm-bridge — r166 sovereign fleet service (port 3048).
// OpenAI-compatible chat-completions endpoint over z-ai-web-dev-sdk (backend only).
// Purpose: any OpenAI/litellm-client agent (mini-swe-agent, reef-infra route, etc.)
// can run against OUR OWN LLM capability — no third-party API keys.
//
// Endpoints:
//   GET  /health                    -> {ok, model, completions}
//   GET  /v1/models                 -> OpenAI list payload
//   POST /v1/chat/completions       -> OpenAI chat.completion payload (non-streaming)
//
// Mapping notes: z-ai SDK takes system prompts in the first message; we keep
// role "system" if the SDK accepts it and fall back to "assistant" mapping
// (per SDK docs) when system role is refused. thinking stays disabled.

import ZAI from "z-ai-web-dev-sdk";

const PORT = 3048;
const MODEL_ID = "sovereign-zai";

let zai: any = null;
let completions = 0;

async function getZai() {
  if (!zai) zai = await ZAI.create();
  return zai;
}

function json(_unused: unknown, code: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: code,
    headers: { "Content-Type": "application/json" },
  });
}

type Msg = { role: string; content: string };

function mapMessages(messages: Msg[]): Msg[] {
  // SDK docs: system prompt travels in the first message; "assistant" role is
  // its documented carrier. Merge leading system messages into one, mapped to
  // "assistant", keep user/assistant messages in order.
  const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
  const out: Msg[] = [];
  if (sys) out.push({ role: "assistant", content: sys });
  out.push(...rest);
  if (out.length === 0) out.push({ role: "user", content: "" });
  return out;
}

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  idleTimeout: 240, // long agent turns
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return json(null, 200, {
        ok: true,
        service: "llm-bridge",
        engine: "z-ai-web-dev-sdk (backend)",
        model: MODEL_ID,
        completions,
      });
    }

    if (req.method === "GET" && url.pathname === "/v1/models") {
      return json(null, 200, {
        object: "list",
        data: [{ id: MODEL_ID, object: "model", created: 1735689600, owned_by: "sovereign" }],
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return json(null, 400, { error: { message: "invalid_json", type: "bad_request" } });
      }
      const messages = Array.isArray(body?.messages) ? body.messages : null;
      if (!messages) {
        return json(null, 400, { error: { message: "messages array required", type: "bad_request" } });
      }
      const t0 = Date.now();
      // r176 — ניסיון-חוזר-אחד-לשגיאות-שרת-רגעיות: שני-אירועי-502-היום-נתפסו-שניהם
      // בתוך-~2-דק'-מהתחלה-מחדש-של-הגשר (kill-test-→-push-מיד). כל-502-רגעי
      // מאלץ-את-ה-gate-ל-fail-open-ומחליש-את-שכבת-הסקירה. מעתה: מתח-אחד-אחרי-1.5ש';
      // כישלון-אמיתי-ממשיך-ל-502-כנה (R123 — אין "נניח-שהצליח").
      let completion: any = null;
      let lastErr: any = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const client = await getZai();
          completion = await client.chat.completions.create({
            messages: mapMessages(messages),
            thinking: { type: "disabled" },
          });
          lastErr = null;
          break;
        } catch (e: any) {
          lastErr = e;
          if (attempt === 1) {
            console.log(`[llm-bridge] upstream error (attempt 1) — retrying in 1.5s: ${String(e?.message || e).slice(0, 160)}`);
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
      }
      try {
        if (lastErr || !completion) throw lastErr ?? new Error("no_completion");
        const content: string = completion?.choices?.[0]?.message?.content ?? "";
        completions++;
        return json(null, 200, {
          id: `chatcmpl-sovereign-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: body?.model || MODEL_ID,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason: "stop",
            },
          ],
          usage: {
            // honest estimation: characters/4 (we do not receive token counts)
            prompt_tokens: Math.ceil(JSON.stringify(messages).length / 4),
            completion_tokens: Math.ceil((content || "").length / 4),
            total_tokens: 0,
          },
          sovereign: { took_ms: Date.now() - t0, upstream: "z-ai" },
        });
      } catch (err: any) {
        return json(null, 502, {
          error: { message: String(err?.message || err).slice(0, 300), type: "upstream_error" },
        });
      }
    }

    return json(null, 404, { error: { message: "not_found", type: "bad_request" } });
  },
});

function noop() {}

console.log(`[llm-bridge] OpenAI-compatible endpoint on :${PORT} model=${MODEL_ID}`);
