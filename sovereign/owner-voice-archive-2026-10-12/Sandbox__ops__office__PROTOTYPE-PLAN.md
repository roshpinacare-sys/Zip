# PROTOTYPE-PLAN — המשרד שמנהל לך את העסק אוטונומית
**Product prototype · 2026-10-12 · owner mandate: "בהמשך נוכל לקדם מוצר של משרד שמנהל לך את העסק אוטונומי... צריך לתכנן שזה יהיה האב-טיפוס... המשרד צריך באמת לבנות את עצמו ולהשיג עוד דברים לפי דרישה וניהול... לפתח מוצרים, לחפש דברים שהוא לא רואה, ומה צריך להקים כדי שיוכל לפתור"**

## 1. What already EXISTS and runs (the prototype's skeleton — all measured, not claimed)

| Capability | Where it lives | Proof |
|---|---|---|
| 3D office as the product surface | FleetHQ `src/components/hq/*`, live `Domain/office3d/` | browser-verified this session |
| Crew that walks in, sits, types, writes, drinks, thinks | world.ts brain + pose.ts + Crew.tsx | entry-walk verified this session; pose laws from T47/T51/T52 |
| Truth-only visualization (no fake work) | ROOM_STALE_MS + agentVisualFresh | stale = "לא ידוע", work stops — law intact |
| Real work orders, foreman dispatch | office-forman + work-orders lanes | office-ci receipts, WO-* resolved:true |
| Owner commands the whole sovereignty FROM the office chat | office chat → gate → Sandbox `ops/sovereign/OWNER-CHANNEL/inbox.jsonl` → decider D0 (supreme, read every pulse) | inbox lines read back this session (01:00/01:07Z directives) |
| Self-check organism | agent-verify 51/51, truth-gate ALL-GREEN, dex two-sided books | re-verified T16/T17 |
| Autonomous loops on git 24/7 | value-scan + sovereign-decider via artery-watch internal operator | manual 204 ignition + runs at 00:16Z (T16) |
| Exposure policy (outside viewers) | identity scrubbed (T17): no manager identity, "מפתח-מנהל" gate only, activity visible | re-verified this session: gate with zero identity hints |

## 2. The product story (what the visitor sees vs what the owner gets)

- **Visitor (outside viewer):** enters `Domain/office3d/` — sees a living designed office
  (crew walks in, works by real state, gallery walls, cacti), live measured numbers
  (SP, posts, books) and NO secrets: no manager identity, no key types, no vault paths.
  Activity is public; mechanisms are not.
- **Owner:** same office + 🎙️ chat → claims מפתח-מנהל once → every directive lands on HIS
  git (inbox.jsonl), receives public P0 acknowledgment from the decider, and is executed
  by the fleet. The office is the remote control of the whole organism.

## 3. Roadmap — "the office builds itself" (each step = a measured work-order, no description-only)

**Phase P0 — prototype hardening (NOW, this session's lane):**
- [x] entry-walk + interior design layer (this session: T18)
- [x] owner channel end-to-end (T17)
- [ ] mobile default camera: aim at the crew arc (mobile preset) — next small task
- [ ] auto-refreshing visitor stats panel inside the room (reuse truth-bridge)

**Phase P1 — self-acquisition on demand ("להשיג עוד דברים לפי דרישה"):**
- work-order types the office can issue ITSELF: `WO-acquire-<thing>` (e.g. new model assets,
  new data source, new chain adapter). The value-scan loop already scans for value gaps
  every 30min — extend it to FILE work-orders (not just report) with the D2 gate
  (clean-streak law) as the brake.
- recruitment lane already exists (RecruitmentBoard) — wire it to auto-open WO-recruit
  when a capability gap is measured twice in a row.

**Phase P2 — productized "office for YOUR business" (the sellable artifact):**
- package = this repo's pattern: 3D office + truth-bridge + foreman + owner chat + git anchor.
- tenant = any small business owner: he gets the office URL, claims his key, his office
  runs HIS loops (content, treasury, monitoring) on HIS git. Multi-tenant = per-tenant
  gate + per-tenant inbox path + per-tenant state file. Zero code fork — config only.
- pricing anchor: the office IS the demo (the visitor literally watches the product work).

**Phase P3 — the office that finds its own blind spots ("לחפש דברים שהוא לא רואה"):**
- weekly self-audit work-order: verifier runs with a "find what's NOT wired" checklist
  (the T16 disconnect-audit pattern, mechanized).
- metronome staleness alarms already exist (artery-watch) — add "capability census":
  every pulse, list loops that never fired + files never read + repos never committed;
  blind spots become work-orders automatically.

## 4. Non-negotiable laws carried into the product

1. **No fakes** — every displayed number comes from a measured source; stale = honest "unknown".
2. **Git anchor** — every autonomous action lands on the owner's git (inbox/ledger/commits), survives offline.
3. **Fail-closed** — unverifiable = not claimed; the room shows calm, not invented work.
4. **Owner supremacy** — D0 reads the owner inbox every pulse; agents act autonomously but never above the owner's directives.
5. **Anti-trample coordination** — scope registration before every lane; consume-only for others' outputs.
