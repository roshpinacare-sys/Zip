# T18 SCOPE — office comparison, interior design, entry-walk (2026-10-12, main)

Owner mandate (verbatim): "סוכן אחר עשה עוד משרד תעשה השוואה שם הגוף זז טוב
הליכה צעדים ידיים תנועות בעיקר וזה ותשווה תשפר נראות גם עיצוב משרד פסיכדלי
אבל אלגנטי ... הקירות יהיו כמו טריפ lsd פעיל אבל בעצימות נמוכה ... וכמה
תמונות קקטוסים קצת עיצוב מעצב פנים ... שיהיה כמה שיותר ריאליסטי אמיתי ...
תעשה מהלך יפה ודחוף"

## Lanes taken (registered BEFORE work — no trampling)

- **FleetHQ** — ONLY these files (all additive/compatible, office-ci must stay green):
  - src/lib/hq/textures.ts (append-only: makePsyArtTexture / makeCactusArtTexture + artPaper helper)
  - src/lib/hq/contract.ts (+3 small colliders for the new cacti, inside existing COLLIDERS IIFE)
  - src/lib/hq/world.ts (AgentBrain constructor + waitT: entry-walk from the south door, deterministic stagger)
  - src/components/hq/Interior.tsx (NEW file: ArtGallery + PsyWash + Cacti)
  - src/components/hq/Office3D.tsx (1 import + 1 mount line: <Interior />)
- **Domain** — ONLY office3d/index.html + office3d/assets/index.{js,css} (rebuilt dist). No hero/index.html edits, no other files.
- **Sandbox** — ops/sovereign/T18-SCOPE-2026-10-12.md (this file) + ops/office/PROTOTYPE-PLAN.md (product plan).

## NOT touched (other agents' lanes, verified active in the last hour)

- FleetHQ ops/*, workflows, memory/*, security lanes (schedule-relay-t64, treasury-arm,
  security-sanitize, fresh-oracle — all running, zero overlap with hq/).
- Domain office3d/v2/** (the other agent's office — comparison source only, read-only),
  acid/hub/hero files, heartbeat memory lanes.
- Sandbox ops/sovereign/DECIDER/**, OWNER-CHANNEL/** (consume-only verification),
  AGENT-LEDGER (zai-15a's lane).

## Comparison measured (browser, this session)

- v2 (office3d/v2): superior BODY LIFE — door-entry walking, visible strides (legs/shins/
  arms procedural), station rotation. Inferior: crude box visuals.
- Ours (office3d): superior avatars (RPM GLB), furniture, lighting, honest truth-laws.
  Was missing: entry-walk (agents spawned seated), wall life (bare walls).
- Adopted: entry-walk (deterministic stagger, nav-only — no fake work). Beat v2 on looks:
  framed psy/cactus gallery, animated low-intensity psy wash on the east wall, 3D cacti
  with real colliders.

## Honesty laws kept

- Entry walk is NAVIGATION only — nameplates show the real foreman state from second one;
  stale truth = "לא ידוע" (unchanged law).
- No work animation without fresh foreman state (unchanged law).
- Cacti got real COLLIDERS — the crew walks around pots, not through them.
