# SPATIAL TWIN — Implementation Plan (Antigravity Edition)
> Drone footage → photorealistic 3D scene → queryable + editable in plain English, all on one laptop GPU.
> Source of truth: uploaded `Spatial_Twin_Complete_Overview` document. Where added, changed, or disagreed, labelled **[DOC]** (from document), **[REC]** (recommendation), or **[FLAG]** (unclear / risky / contradictory).
> Nothing is coded yet. This file is the contract we build against, one phase at a time.

---

## 0. How to use this file
- Saved in repo root as `PLAN.md`.
- Working Agreement (Section 16) governs all project interactions and phase workflows. Read `PLAN.md` before every phase.
- Work one phase at a time. Each phase has: Goal → Build → Files → Tech → Expected result → Test → Exit criteria. Do not start the next phase until the exit criteria pass.
- When something breaks, paste the error using the format in Section 16.4.

---

## 1. Project Understanding

### 1.1 Problem [DOC]
Drone footage is easy to capture but is "dead pixels": a video cannot answer "which buildings are taller than 20 m?" or "what if these were 40 m taller?". Making footage measurable/editable today needs survey crews, CAD experts, LiDAR, or paid cloud 3D services.

### 1.2 Users [DOC + REC]
City planners, construction / mining site managers, disaster-response teams, real-estate developers. For the hackathon the real user is a judge watching a ~5 minute demo.

### 1.3 Solution [DOC]
A web app that turns drone imagery into a digital twin with two separate but aligned layers:

| Layer | What it is | Technology | Analogy |
|---|---|---|---|
| Visual layer | Photorealistic 3D scene made of ~1.2–1.5 M coloured blobs ("splats") | 3D Gaussian Splatting (gsplat) | A hyper-real 3D photo |
| Intelligence layer | Every object's class, footprint, height, area, region, edit history | PostgreSQL + PostGIS (+ SFCGAL) | A filing cabinet that understands shapes |
| Translator | English → validated "intent JSON" → parameterised SQL | Ollama + Qwen2.5-3B + Pydantic | A waiter who only writes on a fixed order slip |
| Editor | Change DB geometry, draw a new procedural mesh, hide old splats, push via WebSocket | Three.js + FastAPI | Cover the old wall with tape, paint a new one |

**Core rule:** the LLM never writes SQL and never touches the scene. It only fills a form.

### 1.4 Core features (the 7 dashboard surfaces) [DOC]
1. 3D Scene Viewer (orbit/pan/zoom, layer visibility, ghost overlay, click-to-inspect, camera pose readout)
2. Natural-language Query box (results highlighted in 3D + sortable results table)
3. Natural-language Edit box (preview → confirm → live change; undo; ghost before/after; derived values recalculated)
4. Object Inspector (class, id, height, area, volume, bbox, region, edit history, quick actions)
5. Layer Controls (per-class toggles, opacity, solo, ghost, mesh-vs-splat)
6. Metrics & Results panel (aggregates, before/after deltas, CSV export, expandable SQL)
7. System Status panel (VRAM, model, service health, last intent JSON + SQL)

### 1.5 Inputs / outputs
- **Offline input:** Mill-19 "Building" drone photos + camera poses (subset ≈ 300–500 frames, 4× downsampled).
- **Offline output:** `scene.splat` + class sidecar + populated PostGIS tables.
- **Live input:** one English sentence.
- **Live output:** highlighted objects + metrics (query) or a changed skyline with undo (edit).

### 1.6 Constraints [DOC]
- Laptop NVIDIA GPU; never two heavy models in VRAM together (unload between stages); no neural-network training (all models pretrained; gsplat is per-scene optimisation); everything local (no cloud APIs); 48–72 h build; P0/P1/P2 discipline; demo is precomputed offline, only the instant loop runs on stage.

### 1.7 Expected outcome
A rehearsed 5-minute demo: orbit the photoreal scene → typed query lights up buildings → typed edit changes the skyline → ghost before/after → undo. Plus backup recording.

### 1.8 What the document does NOT include (we will not invent it)
Authentication/authorisation (deferred to post-hackathon "Phase 4"), cloud deployment, multi-user features, real georeferencing (GPS/UTM) for the demo, any model training, mobile UI. Decision: none of these are built. We say so honestly in the demo.

---

## 2. Flags, Contradictions & Decisions

| # | Type | Issue | Decision |
|---|---|---|---|
| D1 | [FLAG] | Part 1 says all 7 features are "deliverable in 48–72 h", but the build plan marks Inspector/Metrics/Status as P1 and CSV/charts/Cesium as P2. | Follow the build plan priorities. |
| D2 | [FLAG] | Doc says "4 Docker services", but also says only PostGIS should be containerised. | Docker = PostGIS only. Backend, Ollama, frontend run natively. |
| D3 | [FLAG] | `gsplat` (Python trainer) vs `gsplat.js` (browser viewer) are different projects. | Use both, in different places; never confuse. |
| D4 | [FLAG] | The doc's command `python train.py --data_dir … --max_splats …` is written as if gsplat had a one-line trainer. gsplat is a library; training is done through its example trainer script (e.g. `examples/simple_trainer.py`) or the original `graphdeco-inria/gaussian-splatting`. Flags differ per version. | Phase 1 discovers the real command that works on your machine; we record it in `docs/commands.md`. Splat cap is set via the trainer's strategy/densification settings. |
| D5 | [FLAG] | Mill-19 (Mega-NeRF) ships poses in Mega-NeRF's own layout with a normalisation (origin + pose scale factor), not guaranteed to be a ready-to-use COLMAP folder. The doc says "COLMAP camera poses provided". | Phase 2 starts with a data-format inspection + conversion step. Time-boxed (see Plan B). |
| D6 | [FLAG] | The doc says "add class_id to the .ply" and also "export to .splat for the browser". The common `.splat` format has no class field and some converters re-order/sort splats, which silently breaks per-splat labels. | Write our own exporter that keeps the order, and ship a sidecar file `scene.classes.u8` (1 byte per splat, same order). Positions for masking are read from the `.splat` itself. |
| D7 | [FLAG] | Doc says "Z = min Z of the cluster" for the building base and "multiply Z by scale_factor". Drone data has no guaranteed up-axis or ground plane. | [REC] Pipeline stage 5a: fit a ground plane (RANSAC on terrain/road splats), rotate so ground normal = +Z, ground = z 0, apply scale. Height = p95(z) − ground. |
| D8 | [FLAG] | Doc has "Click any object → Inspector" but splats cannot be raycast cheaply. | [REC] Build invisible proxy meshes (extruded footprints from GeoJSON) per object. Raycast the proxies for picking; reuse the same meshes for highlighting and ghosting. |
| D9 | [FLAG] | Doc's EXTRUDE SQL updates `WHERE region = $2`, so what was previewed and what is applied could differ. | [REC] Preview returns a `preview_token` + fixed `object_ids`; apply uses `WHERE id = ANY($ids)` from that token. |
| D10 | [FLAG] | Custom GLSL shader for masking is the hardest frontend item for a beginner. | [REC] Plan A = shader uniform (per doc). Plan B (start here) = CPU-side masking: on edit, loop the splat position buffer once and set alpha 0 for splats inside the edit box (1.5 M points ≈ tens of ms). Same visual result, far simpler. Upgrade to shader only if time remains. |
| D11 | [FLAG] | Coordinate frames: PostGIS/pipeline are Z-up metres; Three.js is Y-up. Mismatch = "meshes float in the wrong place" bugs. | [REC] One Frame Contract (Section 3.3). All conversion happens in exactly one parent `Group` in the frontend. |
| D12 | [FLAG] | Doc pins Three.js 0.163, but the chosen splat viewer library may require a different Three.js version. | Pin whatever the chosen viewer needs; decide in the Phase 6 bake-off. |
| D13 | [FLAG] | VRAM table arithmetic is loose (3.2 GB + 4.8 GB headroom on 8 GB − ~1 GB OS). | Rule stays: only Qwen (~2.2 GB) + browser render (~1 GB) live. Verify with `nvidia-smi`. (Note: Machine is RTX 3050 4GB). |
| D14 | [FLAG] | Doc says "Tank & Temples". | It is Tanks and Temples. |
| D15 | [FLAG] | SegFormer-B0 was trained on street-level Cityscapes; Mill-19 is top-down aerial. Class quality is uncertain. | 1-hour smoke test (Phase 2) with a decision gate: SegFormer → Grounding DINO + SAM 2 → hand-painted labels for the ~5 key buildings. |
| D16 | [REC] | Training is offline. If your laptop GPU/driver fights gsplat, the reconstruction (and only that) can run on a free cloud GPU (Colab/Kaggle), then you download `scene.ply`. | Listed as Plan B for Phase 1/2. Everything live stays local. |
| D17 | [REC] | "Metric accuracy" | Claim approximate scale (~±10–20 %), never "survey-grade". |

---

## 3. Architecture

### 3.1 High-level
```
                USER  (types: "Which buildings are taller than 20 m?")
                  │
                  ▼
  ┌─────────────────────────────────┐
  │ FRONTEND  React + Vite + TS     │  :5173
  │  Three.js viewport, panels      │◄──────── WebSocket /ws/scene ───────┐
  └───────────────┬─────────────────┘                                     │
                  │ REST /api/*  (Vite proxy)                             │
                  ▼                                                       │
  ┌─────────────────────────────────┐        ┌────────────────────────────┴─┐
  │ BACKEND  FastAPI + Uvicorn      │ :8000  │ OLLAMA + Qwen2.5-3B  :11434  │
  │ validate → translate → compile  │◄──────►│ English → intent JSON        │
  │ → execute → broadcast           │        └──────────────────────────────┘
  └───────────────┬─────────────────┘
                  │ SQL (asyncpg, parameterised)
                  ▼
  ┌─────────────────────────────────┐
  │ POSTGRESQL 16 + PostGIS 3.4     │ :5432  (Docker)
  │ + SFCGAL — source of truth      │
  └─────────────────────────────────┘
                  ▲
                  │ loaded once
  ┌─────────────────────────────────┐
  │ OFFLINE PIPELINE (GPU, 3–5 h)   │  Mill-19 → gsplat → SegFormer →
  │ scripts in /pipeline            │  label splats → extract geometry → DB
  └─────────────────────────────────┘  also outputs scene.splat + scene.classes.u8
```

### 3.2 Two flows
- **Offline factory (once):** manufactures the starting state. May take hours. Not part of the live demo.
- **Live loop (instant):** frontend → backend → Ollama → validate → compile → PostGIS → response + WebSocket → 3D update. Target < 3 s per command.

### 3.3 Frame Contract (very important)
- Scene frame = right-handed, Z-up, unit = metres, ground plane at z = 0, origin near scene centre.
- Pipeline transforms poses/splats into the scene frame once (stage 5a) and stores the transform + `scale_factor` in `projects`.
- PostGIS uses SRID 0 (plain Cartesian metres). No GPS, no UTM in the MVP.
- The exported `scene.splat` and every GeoJSON footprint are already in the scene frame.
- Frontend: one parent `<Group name="sceneRoot" rotation.x = -90°>` converts Z-up → Three.js Y-up. Splats, proxy meshes, highlights and ghosts are all children. Nobody else rotates anything.

### 3.4 Data contracts between components
| From → To | Format | Notes |
|---|---|---|
| Pipeline → filesystem | `scene.splat`, `scene.classes.u8`, `masks/*.png`, `labels.npy` | class ids 0 structure, 1 terrain, 2 road, 3 vegetation, 255 unknown |
| Pipeline → DB | SQL inserts via `06_load_db.py` | idempotent (re-runnable) |
| Backend → Frontend | JSON; geometry as GeoJSON in scene frame | no client-side spatial math |
| LLM → Backend | Intent JSON (schema below) | forced by Ollama `format` = JSON schema, temperature 0 |
| Backend → All clients | WebSocket `scene_diff {updated:[ids], removed:[ids], version}` | one message type |

---

## 4. Technology Choices

### 4.1 Essential
| Tech | What | Used for | Beginner note |
|---|---|---|---|
| Python 3.11 | language | backend + offline pipeline | use a `venv` |
| NVIDIA driver + CUDA 12.x + PyTorch | GPU runtime | gsplat, SegFormer | verify with `torch.cuda.is_available()` |
| gsplat (nerfstudio) | 3DGS trainer | build the scene | version pinned after Phase 1 |
| Mill-19 Building | dataset | demo drone footage | large download (10–15 GB) |
| SegFormer-B0 (`nvidia/segformer-b0-finetuned-cityscapes-1024-1024`) | pretrained segmenter | class per pixel | ~14 MB, no training |
| Docker + `postgis/postgis:16-3.4` | DB container | PostGIS + SFCGAL | only container we run |
| FastAPI + Uvicorn | web framework/server | REST + WebSocket | auto docs at `/docs` |
| Pydantic v2 | validation | intent schema, API models | guard between LLM and SQL |
| asyncpg | DB driver | parameterised queries | |
| Ollama + `qwen2.5:3b` | local LLM | English → intent JSON | native install |
| React 18 + Vite + TypeScript | frontend | UI | |
| Three.js + a splat viewer lib (gsplat.js / alternatives, see 4.3) | 3D | render + edit | |
| Zustand | tiny state store | layers, selection, scene version | |
| GeoJSON | wire format | footprints | |

### 4.2 Optional (only if ahead)
TailwindCSS (plain CSS modules initial), TanStack Table/Query, `use-debounce`, `phi3:mini` backup LLM, Grounding DINO + SAM 2 (only if SegFormer fails), CesiumJS, pgRouting, Depth Anything, Redis/Celery/MinIO.

### 4.3 Splat viewer bake-off (Phase 6, max 45 min) [REC]
Candidates: `gsplat.js` (HF, in doc), `@mkkellogg/gaussian-splats-3d`, Spark (Three.js-based). Pick the first that can:
1. load `.splat` (or `.ply`)
2. live in our own Three.js scene next to normal meshes
3. let us hide splats by index/region (CPU masking or shader hook)
4. run at ≥ 30 fps on laptop.

### 4.4 Deliberately excluded
Auth, cloud services, model training, Kubernetes, Redis/MinIO/Celery (P2), microservices.

---

## 5. MVP Definition

### MUST HAVE (P0 — no demo without these)
- Working environment (CUDA, PyTorch, gsplat, Ollama, Docker PostGIS).
- Trained 3DGS scene visible in our browser app.
- Labelled splats → geometry extraction → PostGIS tables filled (≥ 8 buildings with plausible heights).
- Intent schema + Ollama client + SQL compiler.
- Query loop end-to-end (English → highlighted in 3D + results table).
- Edit loop end-to-end: preview → confirm → new mesh + old splats hidden + WebSocket refresh.
- Ghost before/after overlay.
- Undo.
- Rehearsed demo, backup screen recording, canned fallback commands.

### SHOULD HAVE (P1)
Object Inspector, metrics with before/after deltas, layer toggles, friendly errors, status panel, expandable SQL/intent display.

### NICE TO HAVE (P2)
Helipad FLATTEN showcase, CSV export, charts, CesiumJS, redo, shader-based masking (D10 Plan A), camera pose in URL hash, per-layer opacity, Phi-3 backup model.

### Demo-driven acceptance (the MVP is "done" when all of these are true)
- "Which buildings are taller than 20 metres?" lights up the right buildings in ≤ 3 s.
- "Raise the two central buildings by 40 metres" → preview flashes → confirm → skyline changes, old splats hidden, ghost shows the original.
- "Undo" restores the original.
- Two browser tabs update together.
- A nonsense command shows a friendly message and changes nothing.

---

## 6. Repository Structure
```
spatial-twin/
├── PLAN.md                     # this file
├── README.md
├── .gitignore
├── .env.example                # never commit .env
├── docker-compose.yml          # PostGIS only
├── docs/
│   ├── decisions.md            # results of every decision gate (D4, D5, D15, viewer, ...)
│   ├── commands.md             # exact commands that worked on THIS machine
│   └── demo-script.md
├── db/
│   ├── init/01_extensions.sql
│   ├── schema.sql
│   ├── regions.sql
│   └── seed.sql                # fake buildings for building the app before real data exists
├── pipeline/                   # offline, run once
│   ├── common/ (frame.py, io.py)
│   ├── 00_env_check.py
│   ├── 01_prepare_data.py
│   ├── 02_train_splat.md       # exact trainer command lives in docs/commands.md
│   ├── 03_segment.py
│   ├── 04_label_splats.py
│   ├── 05a_fit_ground_frame.py
│   ├── 05b_extract_geometry.py
│   ├── 06_load_db.py
│   └── 07_export_splat.py      # order-preserving .splat + classes.u8
├── backend/
│   ├── main.py
│   ├── config.py               # reads .env
│   ├── routers/ (query.py, edit.py, objects.py, status.py)
│   ├── agent/ (intent_schema.py, ollama_client.py, sql_compiler.py, fallback_matcher.py)
│   ├── db/ (connection.py, queries.py)
│   ├── ws/manager.py
│   ├── schemas/
│   └── tests/
├── frontend/
│   └── src/ (components/, store/, hooks/, three/, api/, App.tsx)
├── static/                     # scene.splat, scene.classes.u8 (gitignored, served by backend)
├── data/                       # datasets (gitignored)
└── output/                     # training outputs, masks (gitignored)
```

---

## 7. Database Design

### 7.1 What is stored and why
- Project + `scale_factor` + frame transform: makes "metres" mean something and lets us rebuild the frame.
- Objects per layer (footprint, height, area, region): answers every query without touching the scene.
- `regions` polygons: maps "central", "north" to a WHERE clause.
- `geometry_history`: undo + audit.
- `edit_sessions`: groups edits so one Undo reverses one command.

### 7.2 Tables
`projects`, `structures`, `terrain`, `roads`, `vegetation`, `geometry_history`, `regions`, `edit_sessions`.
Key columns in `structures`:
`id serial PK`, `project_id`, `class text`, `footprint geometry(Polygon,0)`, `solid geometry(PolyhedralSurfaceZ,0)`, `height_m real`, `area_m2 real`, `region text`, `splat_bbox` (min/max xyz), `original_height_m real`, `version int default 1`.

### 7.3 Indexes
GIST on `footprint`, `solid`; btree on `height_m`; btree on `geometry_history(object_id, version)`.

---

## 8. API Contracts & Intent JSON
All under `http://localhost:8000`. Interactive docs at `/docs`.

```json
{
  "operation": "QUERY_HEIGHT | SELECT_REGION | EXTRUDE | TRANSLATE | FLATTEN",
  "layer": "structures | terrain | roads | vegetation",
  "filter": { "type": null, "region": null, "min_height_m": null, "max_height_m": null, "within_m_of": null },
  "magnitude": { "value": null, "unit": "m" },
  "direction": "N | S | E | W | UP | DOWN | null",
  "scope": "preview | apply"
}
```

---

## 9. ML / Offline Pipeline Plan
- Stage 00: Environment check (`pipeline/00_env_check.py`)
- Stage 01: Data prep (`pipeline/01_prepare_data.py`)
- Stage 02: 3DGS Train (`output/mill/point_cloud.ply`)
- Stage 03: Keyframe segmentation (`masks/*.png`)
- Stage 04: Splat labelling (`labels.npy`)
- Stage 05a: Ground plane & Frame alignment
- Stage 05b: Geometry extraction (DBSCAN + alpha-shape)
- Stage 06: DB loader (`06_load_db.py`)
- Stage 07: Export order-preserving `.splat` and `scene.classes.u8`

---

## 10. Frontend Plan
- Left: Query/Edit box, Metrics.
- Centre: 3D viewport (Three.js with Splat viewer + proxy meshes).
- Right: Object Inspector (slides in).
- Top/Bottom: Layer controls, Status panel.

---

## 11. Development Roadmap
- **PHASE 0:** Project setup (Docker PostGIS, repo structure, README, env)
- **PHASE 1:** Env bring-up + smoke tests (GPU, gsplat, Ollama)
- **PHASE 2:** Offline pipeline (scene + labels + geometry → DB)
- **PHASE 3:** Database (schema, regions, seed data)
- **PHASE 4:** Backend skeleton (FastAPI, status, objects, WS)
- **PHASE 5:** AI agent + query loop
- **PHASE 6:** Frontend shell + 3D viewer + alignment
- **PHASE 7:** Edit loop + WebSocket + ghost + undo
- **PHASE 8:** Panels & polish
- **PHASE 9:** Testing & hardening
- **PHASE 10:** Demo preparation

---

## 16. Working Agreement (Agent Rules)

### 16.1 Standing rules
1. Read `PLAN.md` fully before every phase. Do not invent requirements; if something is unclear, ask.
2. One phase at a time. Finish, verify, report, then STOP and wait for confirmation to proceed.
3. Beginner mode: before new concepts, give a one-line real-world analogy, then the code. Explain what / why / where / how it connects.
4. Complete working files, not fragments. State `FILE: path` for every file created/changed; don't silently touch unrelated files.
5. No hard-coded secrets. `.env` + `.env.example`. Validate all input. Handle errors with friendly messages.
6. Give only the commands needed for the current step, each followed by "What this does".
7. After every step: how to test + expected result. Don't say "done" until the test passes.
8. Prefer the simplest reliable approach (see D10). No new library without justification and approval.
9. Record every working command/version in `docs/commands.md` and every decision in `docs/decisions.md`.
10. Never claim a feature exists that we have not built and tested.

### 16.2 Per-phase report format
```
PHASE N — DONE
Created/changed: (files + one line each)
Commands run:
How to run it:
How to verify (steps + expected result):
Problems encountered + fixes:
Checklist update:
Waiting for your confirmation to start PHASE N+1.
```

### 16.3 Kick-off prompt template
```
Read PLAN.md. We are starting PHASE <N> only.
Follow the Working Agreement. Explain the concepts first in simple language,
then implement exactly the items listed for this phase — nothing from later phases.
Run the tests listed for the phase and show me the results. Then stop.
```

### 16.4 Error handling format
`ERROR` (key line) → `WHAT IT MEANS` (simple) → `WHY IT HAPPENED` → `FIX` (smallest change) → `TEST` (how to verify). Do not restart the project.

---

## 17. Progress Tracker
```
[x] Project understanding + implementation plan
[x] Phase 0  — Project setup (repo, Docker PostGIS, README)
[x] Phase 1  — Env bring-up + smoke tests (GPU, gsplat, Ollama)
[x] Phase 2  — Offline pipeline (scene + labels + geometry → DB)
[x] Phase 3  — Database (schema, regions, seed)
[x] Phase 4  — Backend skeleton (FastAPI, status, objects, WS)
[x] Phase 5  — AI agent + query loop
[x] Phase 6  — Frontend shell + 3D viewer + alignment
[x] Phase 7  — Edit loop + WebSocket + ghost + undo
[ ] Phase 8  — Panels & polish
[ ] Phase 9  — Testing & hardening
[ ] Phase 10 — Demo preparation
```

---

## 18. Approved Offline Videogrammetry Extension (2026-10-03)

The approved target is a local/offline reconstruction from real drone video that can eventually publish a validated, textured, structured 3D model with accurate details where the capture and independent references support them. This extension supersedes the earlier splat-only offline claim while preserving Gaussian Splatting, SegFormer, PostGIS/SFCGAL, and the LLM intent engine.

### Modes and safety contract
- `preview_monocular`: Depth Anything or equivalent preview only; not metric and not a surface model.
- `sfm_mvs`: COLMAP camera recovery plus dense MVS, mesh, texture, orthomosaic/DSM, and metric/geospatial gates.
- `gaussian_splat`: actual 3DGS training using the shared COLMAP pose artifact; Gaussian output is not a substitute for validated mesh geometry.
- Local-only execution is the default. Cloud transfer is disabled unless separately authorized.
- A scene manifest is fail-closed: missing scale, quality, pose, geometry, or artifact evidence means measurements, metre-based edits, and geographic exports are unavailable.
- Accuracy is reported separately for reconstruction diagnostics, alignment residuals, and independent physical/checkpoint assessment. No default survey-grade claim is permitted.

### Approved execution phases
1. Phase A — local toolchain preflight, isolated jobs, resource leases, scene manifest, capability gates.
2. Phase B — dense frame extraction, timestamp synchronization, telemetry and dynamic masks.
3. Phase C — COLMAP sequential SfM, loop closure, pose priors, bundle adjustment, trajectory artifacts.
4. Phase D — Sim(3) scale/georeference and accuracy evidence.
5. Phase E — COLMAP dense MVS, local resource profile, and LAS/LAZ export.
6. Phase F — surface meshing, cleanup/decimation, photographic texturing, GLB/OBJ browser model.
7. Phase G — DSM/orthomosaic with explicit coverage and NoData.
8. Phase H — real Gaussian training from shared poses, preserving splat/class contracts.
9. Phase I — semantic propagation, dynamic filtering, PostGIS, path replay, and mesh/splat edit integration.
10. Phase J — QA/reprocessing, export matrix, observability, consumer validation, and release documentation.

Every phase is verified and reported before the next phase begins. Synthetic scene generation remains an explicit test/demo fixture only and cannot be used as proof that a real video reconstruction succeeded.

