# Spatial Twin — System Architecture & Implementation Blueprint

> **High-Level Analogy:**  
> Think of Spatial Twin as an interactive, AI-driven CAD architect combined with a live satellite command center. A drone takes aerial photos or video of a site. Instead of remaining flat, non-interactive "dead pixels", the footage is transformed into a photorealistic 3D Gaussian Splatting scene linked directly to an intelligent geospatial database (PostGIS). When a user types a natural-language question or edit request in plain English, a local LLM translates it into structured commands—allowing buildings to be measured, inspected, or interactively modified in real time.

---

## 1. System Overview & Core Philosophy

The project bridges two complementary halves:
1. **The Visual Layer (Photorealism):** High-fidelity 3D Gaussian Splatting (`scene.splat`) rendered in the browser at 60 FPS using Three.js and custom fragment shaders.
2. **The Intelligence Layer (Spatial Semantics):** A relational geospatial database (PostGIS + SFCGAL 3D solids) storing building footprints, heights, volumes, bounding boxes, and edit histories.
3. **The Translation Bridge (Deterministic AI):** Local Qwen2.5-3B acting strictly as an intent parser. **The LLM never writes raw SQL and never touches the 3D scene directly.** It outputs structured JSON conforming to a Pydantic schema, which the backend safely compiles into parameterised SQL.

```
                              ┌──────────────────────────────────────────────┐
                              │                 DRONE FLIGHT                 │
                              │           (Raw Video MP4 / 4K Poses)         │
                              └──────────────────────┬───────────────────────┘
                                                     │
                             ┌───────────────────────┴───────────────────────┐
                             │                                               │
                             ▼                                               ▼
             ┌───────────────────────────────┐               ┌───────────────────────────────┐
             │       LOCAL PIPELINE          │               │      CLOUD 3DGS PIPELINE      │
             │   (RTX 3050 4GB Optimized)   │               │   (Kaggle / Colab Cluster)    │
             │                               │               │                               │
             │ • PyAV Keyframe Extraction    │               │ • Full COLMAP / SfM Poses     │
             │ • Depth Anything V2 Depth     │               │ • 3D Gaussian Splatting       │
             │ • SegFormer-B0 AI Semantic    │               │   Optimization (10k-30k iter) │
             │ • RANSAC Ground Fitting       │               │ • Binary Splat Export         │
             │ • DBSCAN Building Extraction  │               │   (32 bytes/splat)            │
             └───────────────┬───────────────┘               └───────────────┬───────────────┘
                             │                                               │
                             └───────────────────────┬───────────────────────┘
                                                     │
                                                     ▼
                             ┌───────────────────────────────────────────────┐
                             │               DATA ARTIFACTS                  │
                             │  • scene.splat (32-byte binary point cloud)   │
                             │  • scene.classes.u8 (1:1 semantic sidecar)    │
                             │  • PostGIS / JSON Extracted Solid Geometry    │
                             └───────────────────────┬───────────────────────┘
                                                     │
               ┌─────────────────────────────────────┴─────────────────────────────────────┐
               │                                                                           │
               ▼                                                                           ▼
┌───────────────────────────────┐                                           ┌───────────────────────────────┐
│       FASTAPI BACKEND         │                                           │     REACT + THREE.JS UI       │
│         (Port 8000)           │◄─────────── REST / WebSocket ────────────►│         (Port 8080)           │
│                               │                                           │                               │
│ • /api/query (Intent Engine)  │                                           │ • SpatialTwinApp Viewer       │
│ • /api/edit/preview & apply   │                                           │ • Custom Gaussian WebGL Shader│
│ • /api/pipeline/upload        │                                           │ • Extruded 3D Proxy Meshes    │
│ • /api/pipeline/upload-kaggle │                                           │ • Natural Language Query HUD  │
│ • /ws/scene (Multi-tab sync)  │                                           │ • Edit Mode + Hologram Ghost  │
└──────────────┬────────────────┘                                           └───────────────────────────────┘
               │
               ▼
┌───────────────────────────────┐
│     OLLAMA LLM RUNTIME        │
│    (Qwen2.5:3B via 11434)     │
│                               │
│ Strict JSON Schema Extraction │
└───────────────────────────────┘
```

---

## 2. End-to-End Architectural Layers

### Layer A: Ingestion & 3D Reconstruction Pipeline
The system accommodates both local resource constraints (e.g. 4GB laptop VRAM) and cloud high-end GPU training:

1. **Video & Telemetry Ingestion (`pipeline/video_processor.py` & `pipeline/telemetry_parser.py`):**
   - Ingests uploaded MP4/MOV drone footage via PyAV.
   - Extracts evenly-spaced, motion-stable keyframes across the flight trajectory.
   - Parses DJI `.SRT` / Autel `.ASS` subtitle tracks and EXIF/XMP GPS metadata into a per-frame position, barometric altitude, and gimbal orientation track.
2. **AI Semantic Segmentation & Dynamic Object Masking (`pipeline/03_segment.py`):**
   - Runs NVIDIA SegFormer-B0 (Cityscapes pretrained) on keyframes.
   - Generates pixel-accurate semantic masks: Building (1), Ground/Road (2), Vegetation (3), Sky (4).
   - Flags moving vehicles and pedestrians, removing them from ground plane estimation and building clustering.
3. **Camera Model & Pose Recovery (`pipeline/camera_model.py`):**
   - Extracts focal length, sensor dimensions, and principal points from EXIF or drone specification profiles.
   - Computes Ground Sample Distance (GSD): $\text{GSD} = \frac{\text{flight altitude} \times \text{sensor width}}{\text{focal length} \times \text{image width}}$.
   - Distinguishes **Cloud Path** (full SfM + bundle adjustment yielding survey-grade poses) from **Local Path** (fast preview monocular depth tagged as `reconstruction_mode: "preview_monocular"`).
4. **Dual Reconstruction Modes:**
   - **Local Depth Unprojection (`pipeline/video_depth_reconstructor.py`):** Uses Depth Anything V2 with metric scale calibration via altitude telemetry to generate scaled 3D point clouds on a local GPU in 15–30 seconds.
   - **Cloud Gaussian Splatting (`pipeline/kaggle_runner.py`):** Triggers automated headless training on Kaggle/Colab GPU clusters via the Kaggle API (`ayushmoandutta/spatial-twin-3dgs-cloud-worker`), retrieving fully trained `.splat` scenes.
5. **Scale Recovery & Georeferencing (`pipeline/scale_recovery.py` & `pipeline/georeferencing.py`):**
   - Recovers absolute metric scale from GPS baseline distance and flight altitude telemetry.
   - Computes 7-parameter similarity transform (translation, rotation, scale) to anchor the scene into local East-North-Up (ENU) metric coordinates and geographic WGS84 (`EPSG:4326`) / projected UTM (`EPSG:326xx`).
6. **Coordinate Frame & Ground Alignment (`pipeline/05a_fit_ground_frame.py`):**
   - Applies RANSAC plane fitting on static ground/road points to compute the true terrain normal.
   - Applies a rigid 3D rotation so the ground plane lies at `Z = 0` with ground normal = `+Z` (Z-up metric frame).
7. **Building Extraction & GeoJSON Topology (`pipeline/05b_extract_geometry.py`):**
   - Filters building points and clusters them via DBSCAN.
   - Computes 2D convex hull footprints, base elevations ($Z_{min}$), and 95th-percentile building heights ($Z_{p95}$).
   - Generates 3D bounding boxes and GeoJSON polygons.
8. **Pipeline QA & Reprocessing Gate (`pipeline/quality_gate.py`):**
   - Validates reconstruction coverage (% frames registered), point density, ground-plane fit RMSE, and scale consistency.
   - Emits a structured `quality_report.json` and triggers automatic reprocessing with adjusted spacing if thresholds fail.
9. **Deliverables & Multi-Format Exporters (`pipeline/deliverables_generator.py` & `pipeline/07_export_splat.py`):**
   - Exports photorealistic `scene.splat` (32 bytes/point) + `scene.classes.u8` sidecar for the web viewer.
   - Auto-generates 2D Orthomosaic (`.tif`), Digital Surface Model (`DSM .tif`), and open CAD/GIS formats (`.laz`, `.glb`, `.obj`, `.dxf`, `.geojson`).

---

### Layer B.1: Georeferencing & Accuracy Budget

Every scene is anchored to the real world before metric measurement or editing is permitted:

**1. Frame Hierarchy:**
- **Splat-Local Frame:** Reconstruction output with arbitrary origin.
- **Site Metric Frame:** Z-up, metres, origin at the surveyed or telemetry-derived ground datum ($Z = 0$).
- **World Frame (Geographic):** EPSG:4326 (WGS84 Lat/Lon) and projected UTM (e.g. EPSG:32643).

**2. Accuracy Budget (Stored in `scene.json` and displayed in the UI):**

| Metric | Source | Typical Budget |
|---|---|---|
| **GSD (Ground Sample Distance)** | $\frac{\text{Altitude} \times \text{Sensor Width}}{\text{Focal Length} \times \text{Image Width}}$ | 1.0 – 3.5 cm/px |
| **Relative In-Model Accuracy** | SfM / bundle adjustment residuals | $\pm 2 - 5\text{ cm}$ |
| **Absolute Geographic Accuracy** | Drone GNSS / Telemetry quality | $\pm 0.5 - 2.0\text{ m}$ (Standard GNSS) |
| **Vertical Accuracy** | Barometric sensor + RANSAC ground fit | $\pm 0.1 - 0.3\text{ m}$ |

---

### Layer B.2: Export & Interoperability Matrix

| Deliverable | Format | Primary Consumer |
|---|---|---|
| **Gaussian Splat Scene** | `.splat`, `.ply` | Spatial Twin Web Viewer / SuperSplat |
| **Semantic Class Map** | `.classes.u8` | Spatial Twin GPU Shader |
| **Dense Point Cloud** | `.laz` / `.las` | QGIS, CloudCompare, Forensics |
| **Surface Mesh** | `.glb`, `.obj` | CAD, Blender, AR / Unreal Engine |
| **2D Orthomosaic** | `.tif` (GeoTIFF) | GIS mapping, site inspection |
| **Digital Surface Model** | `.tif` (DSM) | Elevation profiling, flood analysis |
| **Solid Geometry** | `.geojson`, `.dxf` | AutoCAD, Civil 3D, PostGIS |

---

### Layer B: Geospatial Intelligence & Storage
- **PostGIS + SFCGAL Database (`db/schema.sql`):**
  - Stores structures with true 3D solid geometry (`POLYHEDRALSURFACE Z` via `ST_Extrude`).
  - Tables: `structures` (current state), `regions` (spatial zoning), `geometry_history` (immutable audit log), `edit_sessions` (atomic transactions).
  - Spatial queries execute using indexed PostGIS functions (`ST_3DIntersects`, `ST_Area`, `ST_Contains`, `ST_ZMax`).
- **Resilient Standalone Fallback:**
  - If Docker/PostGIS is not running, the backend seamlessly switches to standalone mode using `data/extracted_structures.json`, ensuring the system remains functional offline.

---

### Layer C: Deterministic AI Translation Engine
- **Ollama + Qwen2.5-3B (`backend/nlp/ollama_client.py` & `backend/nlp/intent.py`):**
  - Prompt engineered with strict JSON schema constraints.
  - Temperature set to `0.0` for deterministic parsing.
  - VRAM Keep-Alive: Configured with `keep_alive: 60m` and warmup at FastAPI startup to prevent cold-start latency.
  - Regex Fast-Path: Zero-latency (<1ms) fallback for standard demo queries.
- **SQL Compiler (`backend/nlp/sql_generator.py`):**
  - Validates intent JSON against Pydantic models.
  - Compiles intent into parameterised, injection-safe SQL queries.

---

### Layer D: Web Client & 3D Gaussian Splatting Engine
Built with React, Vite, TypeScript, and Three.js:

1. **Three.js Frame Contract:**
   - Coordinate conversion is isolated to a single root `<Group name="sceneRoot" rotation.x = -90°>` for Z-up metric alignment.
2. **Custom Gaussian Splat Shader (`frontend/src/viewer/SplatMesh.ts`):**
   - Custom WebGL fragment shader with soft circular Gaussian falloff.
   - Parses the 32-byte `.splat` binary buffer and binds `scene.classes.u8` as a GPU attribute.
   - Provides sub-millisecond layer toggling (e.g. hide terrain, isolate buildings) and CPU alpha masking.
3. **Invisible 3D Proxy Meshes (`frontend/src/viewer/ProxyMeshManager.ts`):**
   - Extruded 3D solid footprints rendered transparently over the splats.
   - Enables instant GPU raycasting, click-to-inspect, hover highlights, and object selection without expensive point-cloud search.
4. **Holographic Ghost Meshes:**
   - During natural language edits (e.g., "Add 15 meters to the warehouse"), proposed geometries are rendered as neon cyan holographic wireframes before committing.
5. **Real-Time WebSocket Sync (`backend/ws/manager.py`):**
   - Changes made in one session immediately broadcast `scene_diff` events across all connected clients.

---

## 3. The Natural Language Query & Edit Workflow

### 3.1 Query Flow
```
User: "Which buildings in the North District are taller than 25 meters?"
  │
  ▼
Ollama (Qwen2.5-3B)
  │ parses into Intent JSON:
  │ { action: "query", target_class: "building", region: "North District", 
  │   filter: { field: "height_m", op: ">", value: 25.0 } }
  ▼
SQL Generator
  │ generates parameterised SQL:
  │ SELECT id, name, height_m, ST_AsGeoJSON(footprint_2d) FROM structures
  │ WHERE height_m > $1 AND ST_Intersects(footprint_2d, (SELECT geom FROM regions WHERE name = $2));
  ▼
PostGIS / Standalone Database
  │ returns matching IDs: ["bldg_01", "bldg_04"]
  ▼
Frontend HUD & 3D Viewer
  • Highlights proxy meshes for bldg_01 and bldg_04 in bright amber.
  • Smoothly flies camera to frame the selection.
  • Populates Metrics & Results table with count, average height, and area.
```

### 3.2 Edit & Undo Flow
```
User: "Make all structures in the East Zone 10 meters taller"
  │
  ▼
Ollama -> Intent JSON -> Backend Preview Generator
  │
  ▼
POST /api/edit/preview
  • Returns preview_token (single-use cryptographic token).
  • Returns proposed new heights and bounding boxes.
  • Frontend renders neon cyan holographic ghost meshes over current buildings.
  │
  ▼
User clicks [Apply Changes]
  │
  ▼
POST /api/edit/apply { preview_token }
  • Atomic transaction: saves current state to geometry_history.
  • Updates structures table with new heights and ST_Extrude 3D solids.
  • CPU Splat Masking: sets alpha = 0 for splats in the old bounding volume.
  • Real-time WebSocket event scene_diff emitted to all connected viewports.
  │
  ▼
User clicks [Undo]
  • Restores exact snapshot from geometry_history.
  • Clears splat alpha mask and restores original proxy meshes instantly.
```

---

## 4. Hardware Resource Management (4GB Laptop GPU)

To run photorealistic 3D Gaussian Splatting, neural segmentation, and a large language model on a single 4GB VRAM laptop (RTX 3050):

| Component | VRAM Consumption | Execution Mode | Strategy |
|---|---|---|---|
| **SegFormer-B0** | ~800 MB | Offline / Ingestion | Loaded during video upload, unloaded immediately after segmentation. |
| **Depth Anything V2** | ~1.1 GB | Offline / Ingestion | Loaded only during 3D keyframe unprojection, then freed. |
| **Qwen2.5-3B (Ollama)** | ~2.0 GB | Always Resident | Kept in VRAM via `keep_alive: 60m` with CPU offload headroom. |
| **WebGL Splat Viewer** | ~600 MB - 1.0 GB | Browser | Client-side GPU rendering via WebGL/Three.js. |
| **PostGIS DB** | 0 MB VRAM (System RAM) | Background Daemon | Docker container running on host port 5435. |

---

## 5. Directory Structure & Key Files

```
HackSpire/
├── AGENTS.md                         # Project working agreement and rules
├── PLAN.md                           # Master implementation roadmap
├── docker-compose.yml                # PostGIS + SFCGAL container definition
│
├── backend/                          # FastAPI REST & WebSocket Backend
│   ├── main.py                       # App lifecycle, routers, static mounts
│   ├── config.py                     # Environment variables & hardware profiles
│   ├── nlp/                          # LLM Intent Parser & SQL Generator
│   │   ├── ollama_client.py          # Ollama communication, warmup, keep-alive
│   │   ├── intent.py                 # Pydantic schemas & regex fallback parser
│   │   └── sql_generator.py          # Safe parameterised SQL compiler
│   ├── routers/
│   │   ├── objects.py                # GeoJSON structures, regions, project stats
│   │   ├── query.py                  # Natural language query endpoint
│   │   ├── edit.py                   # Preview, apply, undo transactional edit loop
│   │   └── pipeline.py               # Video upload, status polling, Kaggle hook
│   └── ws/
│       └── manager.py                # WebSocket connection hub & scene_diff broadcaster
│
├── pipeline/                         # Video Processing & 3D Reconstruction Pipeline
│   ├── video_processor.py            # PyAV keyframe extraction from drone footage
│   ├── video_orchestrator.py         # End-to-end processing pipeline orchestrator
│   ├── video_depth_reconstructor.py  # Local 3D depth unprojection
│   ├── kaggle_runner.py              # Kaggle cloud GPU headless 3DGS trainer
│   ├── 03_segment.py                 # SegFormer-B0 AI semantic segmentation
│   ├── 05a_fit_ground_frame.py       # RANSAC ground plane fitting & Z-up alignment
│   ├── 05b_extract_geometry.py       # DBSCAN building extraction & GeoJSON footprints
│   ├── 06_load_db.py                 # SFCGAL ST_Extrude 3D database loading
│   └── 07_export_splat.py            # scene.splat & scene.classes.u8 binary exporter
│
├── db/                               # Database Schemas & Seed Data
│   ├── schema.sql                    # PostGIS 3D structures, history, sessions
│   └── regions.sql                   # Geospatial region boundaries
│
├── frontend/                         # React 18 + Vite + Three.js Application
│   ├── src/
│   │   ├── App.tsx                   # Main route switcher (/ and /demo)
│   │   ├── pages/
│   │   │   ├── LandingPage.tsx       # Modern interactive spatial command center
│   │   │   └── SpatialTwinApp.tsx    # 3D Digital Twin production workspace
│   │   ├── viewer/                   # Three.js 3D Viewport Components
│   │   │   ├── SceneCanvas.tsx       # Three.js canvas & Z-up coordinate root
│   │   │   ├── SplatMesh.ts          # Custom binary Gaussian Splat shader
│   │   │   ├── ProxyMeshManager.ts   # Invisible raycastable building proxies
│   │   │   ├── GhostMeshManager.ts   # Holographic edit preview meshes
│   │   │   └── CameraController.ts   # Smooth fly-to and framing animations
│   │   └── components/
│   │       ├── QueryBar.tsx          # Natural language query input & results
│   │       ├── EditPanel.tsx         # Natural language edit input & undo HUD
│   │       ├── LayerControls.tsx     # Semantic layer visibility & solo controls
│   │       ├── ObjectInspector.tsx   # Building metadata, height, volume inspector
│   │       └── MetricsPanel.tsx      # Aggregate spatial statistics & SQL display
│
└── static/                           # Web-ready binary assets
    ├── scene.splat                   # Photorealistic 3D Gaussian Splats
    └── scene.classes.u8              # 1:1 semantic class binary sidecar
```

---

## 6. Verification & Working Commands Reference

- **Backend Server:**
  ```powershell
  .venv\Scripts\uvicorn backend.main:app --host 127.0.0.1 --port 8000
  ```
- **Frontend Development Server:**
  ```powershell
  cd frontend; npm run dev
  ```
- **Database (Docker PostGIS):**
  ```powershell
  docker compose up -d db
  ```
- **Query Endpoint Smoke Test:**
  ```powershell
  Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/query" -Method Post -ContentType "application/json" -Body '{"text": "Which buildings are taller than 20 metres?"}'
  ```
- **Pipeline Status Check:**
  ```powershell
  Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/pipeline/status"
  ```
