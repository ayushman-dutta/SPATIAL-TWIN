# Comparison Report — Spatial Twin vs. SkyeBrowse
### Architecture gap analysis, with a concrete additions list for `ARCHITECTURE.md`

**Prepared:** 02 Oct 2026
**Documents compared:**
- **A — Spatial Twin** (`ARCHITECTURE.md`, "Spatial Twin — System Architecture & Implementation Blueprint")
- **B — SkyeBrowse** (the drone-video-to-3D pipeline architecture reconstructed from SkyeBrowse's public documentation, knowledge base, and patent coverage)

---

## 1. Executive summary

These are **not competing implementations of the same thing** — they are two different products that happen to share one input (drone footage). Reading them side by side is useful precisely because each fills gaps the other leaves open.

- **SkyeBrowse is a *reality-capture* pipeline.** Its job is to turn a video into a *metrically accurate, georeferenced, court-admissible* 3D record as fast as possible, then let people measure it and export it. Its outputs are textured mesh, dense point cloud, orthomosaic and DSM — engineering artifacts.
- **Spatial Twin is a *digital-twin / analysis* platform.** Its job is to turn footage into a *photorealistic, semantically understood, queryable and editable* scene. Its outputs are a Gaussian-splat scene plus 3D solid geometry in PostGIS, driven by a natural-language intent engine.

In one line: **SkyeBrowse optimises for truth (accuracy, provenance, compliance); Spatial Twin optimises for interaction (photorealism, semantics, editing).** Neither is strictly "ahead" — but for a project that intends to *measure, edit and act on* real sites, Spatial Twin's blueprint is missing several foundations that SkyeBrowse treats as non-negotiable.

The single biggest gap: **`ARCHITECTURE.md` has no real georeferencing and no accuracy model.** It builds a "Z-up metric frame" from RANSAC ground fitting, but nothing ties that frame to the real world, nothing sets its true scale, and nothing states how accurate any measurement actually is. Everything downstream — measurement, editing in metres, GIS export, legal use — inherits that weakness.

Section 7 is the deliverable you asked for: **14 concrete additions**, each with rationale and ready-to-paste Markdown.

---

## 2. At a glance

| | **Spatial Twin (A)** | **SkyeBrowse (B)** |
|---|---|---|
| **Category** | Digital twin + AI analysis platform | Cloud reality-capture / photogrammetry platform |
| **Primary output** | Photorealistic Gaussian-splat scene + PostGIS 3D solids | Textured mesh + dense point cloud + orthomosaic + DSM |
| **Input** | Drone MP4 (4K) | Any MP4/MOV from drone, phone, 360, body-cam |
| **Reconstruction** | Depth Anything V2 (local, monocular) **or** cloud 3DGS via COLMAP SfM | Videogrammetry: SfM → MVS → mesh → texture |
| **Pose recovery** | COLMAP (cloud path only); local path has **no poses** | Full SfM + bundle adjustment on every job |
| **Georeferencing** | **None** (arbitrary Z-up metric frame) | GPS telemetry (SRT/ASS) → metric ENU; no GCPs |
| **Accuracy** | **Not specified** | Documented tiers: ~0.1″–6″, relative + absolute |
| **Semantics** | SegFormer-B0 (4 classes) + PostGIS solids | AI floor plans / site plans, object removal |
| **Measurement** | Via PostGIS/SFCGAL solids | Direct on-surface distance/area/angle/volume |
| **Interaction** | Natural-language query + edit, undo, hologram preview | View, measure, annotate, share |
| **Exports** | `.splat`, `.classes.u8`, GeoJSON | LAZ, GLB, OBJ, USDZ, GeoTIFF, DXF, GeoJSON |
| **Infra** | Local RTX 3050 + Kaggle/Colab burst | AWS / AWS GovCloud, CDN, managed queue |
| **Compliance** | **None described** | CJIS, FedRAMP Moderate, chain of custody, audit |
| **Target user** | Analyst / demo / hackathon | Public safety, construction, insurance, survey |

---

## 3. The fundamental difference

The two systems diverge at one architectural decision, and everything else follows from it: **how the scene is represented.**

SkyeBrowse represents the world as **explicit geometry** — triangles and points with real coordinates. That choice makes measurement, georeferencing and compliance straightforward, but it is a lossy, "engineered" view of the scene.

Spatial Twin represents the world as **radiance** — Gaussian splats — which is visually stunning and renders at 60 FPS, but is *implicit*: a splat has no inherent notion of "this is a building", "this surface is at Z = 4.2 m", or "this is north". Spatial Twin compensates by bolting a **second, explicit representation** (PostGIS 3D solids) alongside the splats and keeping the two in sync through proxy meshes.

That dual-representation design is genuinely clever, and it is the strongest part of the blueprint. But it also means Spatial Twin has *two* things that can drift out of agreement, and `ARCHITECTURE.md` does not yet say how they are kept aligned to the real world.

---

## 4. Dimension-by-dimension comparison

| Dimension | Spatial Twin | SkyeBrowse | Verdict |
|---|---|---|---|
| Photorealism | High (Gaussian splats) | Medium (textured mesh) | **A ahead** |
| Geometric precision | Unspecified | Survey-grade, documented | **B ahead** |
| Georeferencing / CRS | Absent | Telemetry-based, no GCP | **B ahead** |
| Accuracy model | Absent | Tiered + relative/absolute | **B ahead** |
| Semantic understanding | SegFormer + solids + LLM | AI plans, object removal | **A ahead** (richer) |
| Natural-language interaction | Yes (query + edit) | No | **A ahead** |
| Editing / what-if | Yes (hologram, undo) | No | **A ahead** |
| Multi-view consistency | Only on cloud path | Always (SfM) | **B ahead** |
| 2D deliverables (ortho/DSM) | Absent | Auto-generated | **B ahead** |
| Interop / export formats | 3 formats | 6+ industry formats | **B ahead** |
| Speed to first result | 15–30 s local / cloud burst | ~1:1 with video | **B ahead** (consistent) |
| Compliance / audit | Minimal (history table) | CJIS, FedRAMP, chain of custody | **B ahead** |
| Hardware accessibility | 4 GB laptop target | Any browser | **A ahead** (edge-friendly) |
| Multi-user sync | WebSocket scene_diff | Share links | **A ahead** |
| Dynamic-scene handling | Not addressed | Moving-object removal | **B ahead** |

---

## 5. Where Spatial Twin is genuinely ahead

Worth stating plainly, so the additions below are not mistaken for "become SkyeBrowse":

1. **Interaction model.** A natural-language intent engine that queries *and edits* a twin, with preview tokens, holographic ghosts and undo, has no equivalent in SkyeBrowse. This is Spatial Twin's moat.
2. **Deterministic-AI discipline.** "The LLM never writes raw SQL and never touches the scene" — constrained JSON, Pydantic validation, temperature 0.0, parameterised compilation — is a *correct* and mature design that many LLM-integrated systems get wrong.
3. **Photorealism.** Gaussian splats look far better than a textured mesh, which matters for stakeholder communication and virtual tours.
4. **Edge feasibility.** Designing for a 4 GB laptop with explicit VRAM budgeting and load/unload sequencing is a real engineering strength SkyeBrowse sidesteps by being cloud-only.
5. **Dual representation.** Splats for looks + solids for logic is the right architecture for a twin; it just needs a real-world anchor.

---

## 6. Where SkyeBrowse is ahead (the gaps in `ARCHITECTURE.md`)

These are the concrete weaknesses the report's additions target:

1. **No georeferencing.** No CRS, no lat/long, no telemetry ingestion, no vertical datum. The "metric frame" is local and unanchored.
2. **No accuracy model.** No GSD, no relative-vs-absolute accuracy, no validation, no error budget — yet the system makes metre-scale edits and (implicitly) measurements.
3. **Scale ambiguity is unaddressed.** Depth Anything V2 produces *relative* depth, and COLMAP/3DGS reconstructions are *scale-free*; both are called "metric" without saying how true scale is recovered.
4. **Local path has no multi-view geometry.** The local branch unprojects monocular depth per keyframe — no bundle adjustment, no cross-view consistency — while the doc presents both branches as interchangeable.
5. **No 2D deliverables.** No orthomosaic, no DSM, no contours — the outputs most GIS/CAD consumers actually ask for.
6. **Thin interoperability.** Only `.splat`, `.classes.u8`, GeoJSON — no LAS/LAZ, GLB/OBJ, GeoTIFF, DXF.
7. **No QA / reprocessing loop.** A bad reconstruction is shipped silently; SkyeBrowse re-runs until a quality bar is met.
8. **No security, privacy or compliance layer.** No authn/authz, no RBAC, no encryption, no retention policy, no handling of faces/plates.
9. **No concurrency model.** WebSocket sync exists but conflict resolution, roles and session ownership are undefined.
10. **No deployment/scaling story.** Local-vs-Kaggle is described, but not storage lifecycle, orchestration, CDN or production hosting.
11. **No testing or validation harness**, and **no API contract / schema documentation** despite listing endpoints.
12. **Dynamic-scene handling missing.** Moving people/vehicles create splat "floaters" and corrupt ground fitting; nothing addresses this.

---

## 7. Additions to make in `ARCHITECTURE.md`

Below are 14 additions. Each has a **why**, a **priority**, and a **ready-to-paste Markdown block**. Priorities: **P0** = foundational, do first; **P1** = needed before real-world use; **P2** = production hardening.

### Priority summary

| # | Addition | Priority | Fixes gap |
|---|---|---|---|
| A1 | Georeferencing & CRS | **P0** | 6.1 |
| A2 | Scale recovery & accuracy budget | **P0** | 6.2, 6.3 |
| A3 | Camera model & pose recovery | **P0** | 6.4 |
| A4 | Dense reconstruction & 2D deliverables | **P1** | 6.5 |
| A5 | Interoperability & exports | **P1** | 6.6 |
| A6 | Drone telemetry & metadata ingestion | **P1** | 6.1 |
| A7 | Pipeline QA & reprocessing loop | **P1** | 6.7 |
| A8 | Dynamic-scene handling | **P1** | 6.12 |
| A9 | Security, privacy & compliance | **P1** | 6.8 |
| A10 | Concurrency & multi-user model | **P2** | 6.9 |
| A11 | Deployment, scaling & storage lifecycle | **P2** | 6.10 |
| A12 | Testing & validation harness | **P2** | 6.11 |
| A13 | API contracts & data schemas | **P2** | 6.11 |
| A14 | Observability & ops | **P2** | 6.10 |

---

### A1 — Georeferencing & Coordinate Reference System (P0)

**Why:** This is the load-bearing gap. Without it, "metres", "north" and "the North District" are all relative to an arbitrary origin, and no output can be dropped into GIS/CAD or compared across flights. SkyeBrowse solves this with the drone's own GPS telemetry — a route available to you too.

**Paste after Section 2 (Architectural Layers), as a new Layer B.1:**

```markdown
### Layer B.1: Georeferencing & Coordinate Reference System

Every scene is anchored to the real world before any measurement or edit is allowed.

**Frame hierarchy (each scene carries all three):**
1. **Splat-local frame** — COLMAP/depth output. Arbitrary origin, arbitrary scale.
2. **Site metric frame** — Z-up, metres, origin at the surveyed ground datum.
   Produced by RANSAC ground fitting (05a) + scale recovery (see A2).
3. **World frame (geographic)** — EPSG:4326 (lat/long, WGS84) and a projected
   metric CRS for the site (e.g. EPSG:326xx UTM). Vertical datum recorded
   explicitly (ellipsoidal vs. orthometric) and stored per scene.

**Anchoring methods (best available wins):**
- **Direct** — drone telemetry (SRT/ASS/EXIF GPS) → rigid 7-parameter
  similarity transform (3 translation + 3 rotation + 1 scale) to a metric ENU frame.
- **Reference** — a known-length object or surveyed GCP pair placed in the scene;
  operator marks two points, system solves scale + rotation.
- **Manual** — operator drags two points onto a known dimension (last resort).

**Contract:**
- `scene.json` stores: `crs_epsg`, `vertical_datum`, `origin_latlon_alt`,
  `scale_factor`, `transform_matrix`, `anchor_method`, `residual_rmse`.
- All DB geometry is stored in the world frame; the viewer converts to
  site metric frame via a single root transform (mirrors the existing
  `sceneRoot rotation.x = -90°` contract).
- Measurements are **refused** (with a clear message) when no anchor exists.
```

---

### A2 — Scale recovery & accuracy budget (P0)

**Why:** Depth Anything V2 returns *relative* depth, and COLMAP/3DGS reconstructions are *scale-free* by construction. Your doc calls both "metric" — that claim is currently unsupported. You need an explicit scale-recovery step and a stated accuracy budget, or every measurement is unverifiable.

**Paste after A1:**

```markdown
### Layer B.2: Scale Recovery & Accuracy Budget

**Scale recovery (mandatory before metric use):**
- **Cloud 3DGS path:** COLMAP gives scale-free geometry. Recover scale from
  (a) GPS telemetry camera positions, (b) known-distance reference, or
  (c) a surveyed GCP pair. Solve a single scalar + rotation.
- **Local depth path:** Depth Anything V2 is relative. Convert to metric using
  (a) a known object dimension, (b) camera height/altitude prior, or
  (c) telemetry. Monocular depth is a *relative* field — do not present raw
  output as metric.

**Accuracy budget (recorded per scene, shown in the UI):**

| Term | Source | Typical |
|---|---|---|
| GSD (ground sample distance) | altitude × sensor / focal length | computed |
| Relative accuracy (in-model) | reconstruction residuals | ±X cm |
| Absolute accuracy (world) | anchor method + telemetry quality | ±X cm–m |
| Vertical accuracy | ground fit + datum | ±X cm |

- Publish **relative** and **absolute** accuracy separately — they answer
  different questions ("is this wall 5 m from that wall?" vs "where on Earth is it?").
- Validate against a known reference on every flight; store the residual.
- Measurement UI displays the accuracy of the number it is showing.
```

---

### A3 — Camera model & pose recovery (P0)

**Why:** The doc says the local path uses "camera intrinsic projection" but never says where intrinsics come from, and it implies the local and cloud paths are equivalent when only the cloud path recovers poses. Make the camera model and pose source explicit, and state the local path's limitation.

**Paste after A2:**

```markdown
### Layer A.1: Camera Model & Pose Recovery

**Intrinsics:** focal length + principal point + distortion model, sourced from
(1) EXIF, (2) drone spec sheet, or (3) COLMAP auto-calibration. Distortion model
chosen per lens (pinhole+radial for standard; equirectangular for 360 sources).

**Poses:**
- **Cloud path:** full SfM — feature extraction, sequential matching,
  geometric verification, incremental SfM + bundle adjustment → per-frame
  intrinsics and extrinsics. This is the reference implementation.
- **Local path (documented limitation):** monocular depth unprojection uses
  *approximate* per-frame poses (or none). It is a fast preview, **not**
  a survey-grade reconstruction. State this explicitly and gate metric
  features accordingly.

**Contract:** a scene produced by the local path is tagged
`reconstruction_mode: "preview_monocular"` and cannot claim survey-grade accuracy.
```

---

### A4 — Dense reconstruction & 2D deliverables (P1)

**Why:** Your consumers will ask for an orthomosaic and a DSM far more often than a splat. Adding a classical mesh/ortho branch also gives you a *validated* geometric cross-check against the splat geometry.

**Paste as a new sub-section under Layer A:**

```markdown
### Layer A.2: Dense Reconstruction & 2D Deliverables (optional branch)

Alongside the 3DGS scene, generate explicit geometry for measurement and GIS:
- **Dense MVS** (PatchMatch-style depth maps fused) → dense point cloud → `.laz`.
- **Mesh** → surface reconstruction + decimation → `.glb` / `.obj`.
- **Orthomosaic** → orthorectified top-down mosaic → `.tif` (GeoTIFF).
- **DSM / contours** → elevation model + contour lines for GIS.

This branch is the *ground-truth* geometry against which splat-derived
measurements can be sanity-checked, and it is what CAD/GIS tools ingest.
```

---

### A5 — Interoperability & export formats (P1)

**Why:** `.splat` + GeoJSON is a closed world. Real workflows need open formats.

**Paste near the artifacts table (Section 1) or as a new section:**

```markdown
### Export & Interoperability Matrix

| Deliverable | Format | Consumer |
|---|---|---|
| Gaussian scene | `.splat`, `.ply` | this viewer / Splat viewers |
| Semantic sidecar | `.classes.u8` | this viewer |
| Dense cloud | `.laz` / `.las` | GIS, forensics, CAD |
| Mesh | `.glb`, `.obj` | CAD, web, AR (`.usdz`) |
| Orthomosaic | `.tif` (GeoTIFF) | GIS (QGIS/ArcGIS) |
| Elevation | `.tif` (DSM) | GIS |
| Footprints / solids | `.geojson`, `.dxf` | GIS, CAD |
| Twin state | PostGIS dump | downstream analytics |

All exports carry the scene's CRS and accuracy metadata.
```

---

### A6 — Drone telemetry & metadata ingestion (P1)

**Why:** Telemetry is what makes A1 possible and is cheap to capture. It belongs in the ingestion stage.

**Paste into Layer A step 1:**

```markdown
- **Telemetry ingestion:** parse DJI `.SRT` / Autel `.ASS` subtitle tracks and
  EXIF/XMP GPS into a per-frame position/altitude/gimbal track. Used for
  (a) seeding SfM, (b) direct georeferencing, (c) scale recovery. If absent,
  the scene is flagged `unanchored` and requires manual scale (see A2).
```

---

### A7 — Pipeline QA & reprocessing loop (P1)

**Why:** Right now a failed ground fit or a floater-ridden splat is shipped silently. Add a quality gate that can trigger a re-run — the pattern SkyeBrowse uses to guarantee output quality.

**Paste as a new pipeline stage:**

```markdown
### Pipeline QA & Reprocessing Loop

After reconstruction, run automated checks and gate the result:
- Reconstruction coverage (% frames registered, sparse point count).
- Ground-plane fit residual; splat count / density; floater heuristic.
- Anchor residual (A1) and scale sanity (A2).
If any check fails a threshold, automatically re-run with adjusted parameters
(more iterations, different keyframe spacing, stricter matching) up to N retries,
then surface a clear failure state to the operator. Every model carries a
`quality_report.json`.
```

---

### A8 — Dynamic-scene handling (P1)

**Why:** Moving people and vehicles produce splat artifacts and corrupt RANSAC ground fitting and DBSCAN clustering. SkyeBrowse removes them; you should at least detect and mask them.

**Paste into the semantic/segmentation stage:**

```markdown
- **Dynamic-object handling:** SegFormer (or a person/vehicle detector) flags
  moving agents; those splats are tagged and excluded from ground fitting,
  building clustering and measurement, and optionally alpha-masked out of the
  final scene. Store the mask so it is reversible.
```

---

### A9 — Security, privacy & compliance layer (P1)

**Why:** The doc has an audit table but no auth, no encryption, no retention, no privacy handling — yet it edits authoritative geometry and may capture people and licence plates.

**Paste as a new layer:**

```markdown
### Layer E: Security, Privacy & Governance

- **AuthN/AuthZ:** identity provider + role-based access (viewer / editor /
  admin); every edit and export is attributable.
- **Encryption:** TLS in transit; encryption at rest for artifacts and DB.
- **Audit:** extend `geometry_history` into a full audit log (who, what, when,
  from where) covering queries, edits, exports and shares.
- **Privacy:** automatic face / licence-plate blurring on capture of public
  spaces; configurable retention windows per project; right-to-erasure path.
- **Data residency & compliance:** document target regimes (e.g. India DPDP Act
  for domestic deployments; CJIS/FedRAMP only if you go US public-sector).
- **Access to the LLM:** prompt-injection guardrails; the intent parser must
  never be able to trigger destructive SQL or cross-project reads.
```

---

### A10 — Concurrency & multi-user model (P2)

**Why:** `scene_diff` broadcasts changes but does not say who may change what, or what happens when two editors collide.

**Paste near the WebSocket section:**

```markdown
### Concurrency Model

- Session ownership + roles; only editors may emit mutating diffs.
- Optimistic locking on structures; conflicting edits surface a merge prompt
  rather than silently overwriting.
- Edit transactions are atomic and reversible (already true) — extend the same
  guarantee to concurrent sessions via server-authoritative ordering.
```

---

### A11 — Deployment, scaling & storage lifecycle (P2)

**Why:** The local-vs-Kaggle split is described as a processing choice but not as a deployable system.

**Paste as a new section:**

```markdown
### Deployment & Storage Lifecycle

- **Compute:** local worker (preview) + burst cloud GPU (3DGS training);
  queue-based dispatch so uploads never block the UI.
- **Storage tiers:** hot (active scenes), warm (recent artifacts),
  cold/archive (raw video + originals); explicit retention per tier.
- **Delivery:** CDN-fronted static artifacts; the viewer streams `.splat`
  progressively rather than downloading whole scenes.
- **Environments:** dev / staging / prod with seeded sample scenes.
```

---

### A12 — Testing & validation harness (P2)

**Why:** Section 6 lists smoke commands but no test strategy; for a measurement system, validation *is* the product.

```markdown
### Testing & Validation

- **Golden scenes:** fixed captures with known ground truth (known dimensions)
  run on every pipeline change; assert accuracy within budget.
- **Unit:** SQL compiler, intent schema, splat parser, coordinate transforms.
- **Integration:** upload → reconstruct → anchor → query → edit → undo.
- **Regression:** LLM intent parsing against a labelled query set.
```

---

### A13 — API contracts & data schemas (P2)

**Why:** Endpoints are listed but request/response shapes are not.

```markdown
### API Contracts

Document each endpoint with request/response schemas and error codes
(`/api/query`, `/api/edit/preview`, `/api/edit/apply`, `/api/pipeline/upload*`,
`/ws/scene`). Publish an OpenAPI spec from the FastAPI app; version the API.
Define the canonical `scene.json`, `structures`, `regions`, `geometry_history`
and `edit_sessions` schemas in one place and reference them everywhere.
```

---

### A14 — Observability & ops (P2)

```markdown
### Observability

Structured logs, per-stage timing, pipeline success/failure metrics, VRAM and
queue depth dashboards, and alerting on failed reconstructions or anchor
residuals above threshold.
```

---

## 8. Corrections to existing content (not additions — fixes)

These are places where the current `ARCHITECTURE.md` states something that is inaccurate or internally inconsistent and should be edited:

1. **"metric 3D point clouds" (Layer A, local mode).** Depth Anything V2 is a *relative* depth model. Either soften to "scaled point clouds (scale recovered per A2)" or add the scale-recovery step. As written it overclaims.
2. **"4K Poses" in the top diagram.** Poses are only recovered on the cloud path; the diagram implies they arrive with the video. Clarify the source.
3. **Artifacts list vs. local path.** The artifacts box shows only `scene.splat` + `scene.classes.u8`, but the local path produces point clouds, not splats. State which artifacts each branch yields.
4. **"ground/road splats" in 05a.** Ground fitting runs on the point cloud, which exists before splats on the local path. Make the stage's input explicit so it works on both branches.
5. **Hardware table sequencing.** The table lists VRAM per component but not the *time-ordering*; add that SegFormer and Depth Anything are never co-resident with the LLM to respect the 4 GB budget.
6. **"Spatial Twin" vs "HackSpire" naming.** The directory tree is `HackSpire/` while the doc is titled Spatial Twin — align for clarity.

---

## 9. Suggested order of work

1. **A1 + A2 + A3** (georeferencing, scale/accuracy, camera model) — do together; they are one coherent unit and unblock all metric claims.
2. **A6 + A8** (telemetry, dynamic objects) — cheap, and they feed A1/A2 quality.
3. **A4 + A5 + A7** (2D deliverables, exports, QA) — makes outputs usable and trustworthy.
4. **A9** (security/privacy) — before any external user touches the system.
5. **A10–A14** — production hardening.

---

## 10. What this report does *not* recommend

It does **not** recommend turning Spatial Twin into SkyeBrowse. Do not drop Gaussian splats, the LLM intent engine, the holographic editing, or the edge-hardware focus — those are your differentiators. The additions above are the *substructure* a digital twin needs to be trusted with real measurements and real edits. SkyeBrowse is simply a good reference for how that substructure is done in production: telemetry-anchored georeferencing, a stated accuracy model, multi-view geometry, open exports, and a quality gate.

---

*Sources: Spatial Twin `ARCHITECTURE.md` (project blueprint). SkyeBrowse pipeline facts derived from SkyeBrowse's public website, knowledge base and patent coverage, as reconstructed in the accompanying architecture page.*
