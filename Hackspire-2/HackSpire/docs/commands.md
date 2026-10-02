# Spatial Twin — Working Commands Log

This document records the exact, verified commands that worked on this specific machine.

## Phase 0: Project Setup & Database

### Initialize Git
```powershell
git init
```

### Start PostGIS Container (Port 5435 to avoid local conflicts)
```powershell
docker compose up -d db
```

### Verify Container Status
```powershell
docker compose ps
# Expected: Up (healthy) on 127.0.0.1:5435->5432/tcp
```

### Verify PostGIS & SFCGAL Extensions
```powershell
docker exec -i spatial-twin-db psql -U spatial_user -d spatial_twin -c "SELECT PostGIS_Full_Version();"
# Result: POSTGIS="3.4.3 e365945" PGSQL="160" SFCGAL="1.3.8"
```

### Test 3D Solid Geometry (SFCGAL ST_Extrude)
```powershell
docker exec -i spatial-twin-db psql -U spatial_user -d spatial_twin -c "SELECT ST_AsText(ST_Extrude('POLYGON((0 0,1 0,1 1,0 1,0 0))'::geometry,0,0,5));"
# Result: POLYHEDRALSURFACE Z (((0 0 0,0 1 0,1 1 0,1 0 0,0 0 0)),((0 0 5,1 0 5,1 1 5,0 1 5,0 0 5))...)
```

## Phase 1: Environment Bring-up & Smoke Tests

### Run Environment Diagnostics
```powershell
& ".\.venv\Scripts\python.exe" pipeline/00_env_check.py
# Result: Python 3.11.15, PyTorch 2.6.0+cu124, CUDA Active (RTX 3050 4.0GB VRAM), PostGIS Online, Ollama Online (qwen2.5:3b)
```

### Run Ollama Structured Output Smoke Test (Intent JSON)
```powershell
& ".\.venv\Scripts\python.exe" -u pipeline/test_ollama_intent.py
# Result: 5/5 queries passed with strict JSON schema compliance (~0.8s - 1.2s latency)
```

## Phase 2: Offline ML & Geometry Pipeline

### Apply Database Schema & Regions
```powershell
Get-Content db/schema.sql | docker exec -i spatial-twin-db psql -U spatial_user -d spatial_twin
Get-Content db/regions.sql | docker exec -i spatial-twin-db psql -U spatial_user -d spatial_twin
```

### Run Master Offline Pipeline (End-to-End)
```powershell
& ".\.venv\Scripts\python.exe" -u pipeline/run_pipeline.py
# Runs:
#  - Stage 01b: 3D point cloud verification/synthesis (60,000 splats)
#  - Stage 03:  SegFormer-B0 CUDA keyframe semantic segmentation
#  - Stage 04:  3D splat class projection and majority voting
#  - Stage 05a: RANSAC ground plane fitting & rigid Z-up frame alignment
#  - Stage 05b: DBSCAN building clustering, 2D footprints & 3D bounding boxes
#  - Stage 06:  PostGIS database loading with 3D SFCGAL PolyhedralSurfaceZ solids
#  - Stage 07:  Web binary export: scene.splat (32-byte/pt) + scene.classes.u8 (1-byte/pt)









# In your terminal:
.\.venv\Scripts\python.exe pipeline/demo_3d.py
```

## Phase 5: AI Agent & Query Loop

### Run Automated Test Suite (Pytest)
```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_query_loop.py -v
# Result: 11 passed in ~7.4s (covers intent parsing, SQL compilation, regex fallback, height/region/range queries, and nonsense handling)
```

### Start Backend Server
```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

### Test Query Endpoint (PowerShell / curl)
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/query" -Method Post -ContentType "application/json" -Body '{"text": "Which buildings are taller than 20 metres?"}' | ConvertTo-Json -Depth 5
# Returns: matched_ids, filtered GeoJSON objects, metrics (count, avg_height_m, total_area_m2), and parameterized SQL
```

## Phase 6: Frontend Shell + 3D Viewer + Alignment

### Install Dependencies
```powershell
cd frontend
npm install
```

### Build & Validate Frontend Bundle
```powershell
npm run build
# Result: Successful compilation of client and SSR bundles with zero syntax/type errors
```

### Start Vite Development Server
```powershell
npm run dev
# Serves on: http://localhost:8080/ (Landing page at / and master digital twin application at /demo)
```

### Verify End-to-End Twin & 3D Splat Assets
```powershell
Invoke-WebRequest -Uri "http://localhost:8080/demo" -UseBasicParsing
Invoke-WebRequest -Uri "http://127.0.0.1:8000/static/scene.splat" -Method Head -UseBasicParsing
```

### Verify Sub-Second Ollama Natural Language Query
```powershell
Measure-Command { Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/query" -Method Post -ContentType "application/json" -Body '{"text": "Show structures in the center region"}' }
# Result: ~980ms end-to-end latency with 100% LLM schema adherence and zero timeouts
```

## Phase 7: Drone Video Upload & In-App ML Pipeline

### Run Pipeline API Test Suite (Pytest)
```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_pipeline_api.py -v
# Result: 5 passed in ~5.4s (verifies /status, rejection, upload, kaggle-config, and splat import)
```

### Upload Drone Video via API (cURL / PowerShell)
```powershell
curl.exe -X POST "http://localhost:8080/api/pipeline/upload" -F "file=@data/mill19_sample_flight.mp4"
# Result: {"job_id":"22647320","status":"processing","message":"Video 'mill19_sample_flight.mp4' uploaded successfully..."}
```

### Check Real-Time Pipeline Progress
```powershell
curl.exe -s http://localhost:8080/api/pipeline/status
# Result: {"job_id":"22647320","status":"completed","step":"Digital Twin reconstruction complete!","progress":100,...}
```

### Verify Extracted Structures & Splats via Vite Proxy
```powershell
curl.exe -s http://localhost:8080/api/objects/structures
curl.exe -s -I http://localhost:8080/static/scene.splat
```

## Phase 8: 3D Workspace Visual Redesign & Design System Alignment

### Build Frontend Production Assets
```powershell
npm run build
# Result: Successful compilation of client and SSR bundles with zero TypeScript or CSS errors
```

### Verify Endpoints
```powershell
powershell -Command "Invoke-WebRequest -Uri 'http://localhost:8080/' -UseBasicParsing | Select-Object StatusCode"
powershell -Command "Invoke-WebRequest -Uri 'http://localhost:8080/demo' -UseBasicParsing | Select-Object StatusCode"
## Phase 9: SkyeBrowse Telemetry, Optics & Metric Scale Calibration

### Run Phase A Unit Test Suite
```powershell
.\.venv\Scripts\python.exe tests/test_phase_a.py
# Result: All tests passed:
#  - [PASS] Telemetry SRT parsing verified (DJI subtitle lat/lon/alt/gimbal)
#  - [PASS] Camera model verified (GSD: 2.05 cm/px at 50m)
#  - [PASS] Metric scale recovery verified (scale: 3.8315 m/unit, method: gps_camera_baseline_alignment)
## Phase 10: SkyeBrowse Georeferencing, Dual CRS & Metadata Contract

### Run Phase B Unit Test Suite
```powershell
.\.venv\Scripts\python.exe tests/test_phase_b.py
# Result: All tests passed:
#  - [PASS] UTM zone and EPSG determination verified (Zone 10N / Zone 56S)
#  - [PASS] WGS84 <-> UTM projection roundtrip verified (<0.01m precision)
#  - [PASS] GeoreferenceAnchor frame conversions and metadata verified
```

## Phase 11: SkyeBrowse Pipeline QA & Dynamic Object Filtering

### Run Phase C Unit Test Suite
```powershell
.\.venv\Scripts\python.exe tests/test_phase_c.py
# Result: All tests passed:
#  - [PASS] Dynamic object classes properly mapped in CITYSCAPES_MAP
#  - [PASS] Quality Gate evaluation verified (Tier: Survey Grade, RMSE: 4.9 cm, Floaters: 5)
```

## Phase 12: SkyeBrowse 2D Deliverables & Multi-Format Exporters

### Run Phase D Unit Test Suite
```powershell
.\.venv\Scripts\python.exe tests/test_phase_d.py
# Result: All tests passed:
#  - [PASS] Orthomosaic (.tif) & DSM (.tif) raster generation verified (600x599)
#  - [PASS] Open engineering formats (LAS 1.2, Wavefront OBJ, AutoCAD DXF) verified
```

### List and Download Deliverables via API
```powershell
powershell -Command "Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/exports/list' | ConvertTo-Json -Depth 4"
# Downloads deliverable:
# Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/exports/download/gaussian_splat' -OutFile 'scene.splat'
```

## Phase 13: SkyeBrowse Frontend Accuracy HUD, GIS Telemetry & Export Center

### Validate Frontend Production Build
```powershell
cd frontend
npm run build
# Result: Successful compilation of client and SSR bundles with zero syntax/type errors
```

### Verify Endpoints and Live App
```powershell
powershell -Command "Invoke-WebRequest -Uri 'http://localhost:8080/demo' -UseBasicParsing | Select-Object StatusCode"
# Result: 200 OK
powershell -Command "Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/objects/georeference' | ConvertTo-Json -Depth 3"
# Result: 200 OK with WGS84 and UTM EPSG coordinates
powershell -Command "Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/objects/quality-report' | ConvertTo-Json -Depth 3"
# Result: 200 OK with quality tier and residuals
powershell -Command "Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/exports/list' | ConvertTo-Json -Depth 3"
# Result: 200 OK with available deliverables
```

## Phase A (approved offline videogrammetry foundation)

### Verify project-local COLMAP 4.2.1
```powershell
# The archive is kept under .tools/ and is ignored by Git.
.\\.tools\\colmap-4.2.1\\bin\\colmap.exe -h
# Verified: COLMAP 4.2.1 (Commit bd1fcf6 on 2026-09-29 with CUDA, boost hash maps)
```

### Run read-only pipeline preflight
```powershell
.\\.venv\\Scripts\\python.exe pipeline/00_preflight.py --json --colmap .\\.tools\\colmap-4.2.1\\bin\\colmap.exe
# Expected: JSON reports exact COLMAP version, required command/help availability,
# NVIDIA memory information, Python, OS, and disk space. It fails if required COLMAP
# commands are unavailable; it does not claim that reconstruction has succeeded.
```

### Run Phase A tests
```powershell
.\\.venv\\Scripts\\python.exe -m pytest pipeline/tests/test_runtime.py pipeline/tests/test_toolchain.py -v
# Expected: isolated lease, timeout cleanup, stage logs, and preflight tests pass
# without requiring a GPU, COLMAP reconstruction, database, or real scene assets.
```

### Local-only upload safety contract
```powershell
curl.exe -X POST "http://127.0.0.1:8000/api/pipeline/upload" -F "file=@<real-video>.mp4"
# Expected: status=staged with a per-job SHA-256 and dimensions. Phase A does not
# reconstruct or publish a scene; the previously published scene remains unchanged.
```

## Phase B — Dense frame audit and telemetry

### Extract dense real frames with PTS timestamps
```powershell
.\\.venv\\Scripts\\python.exe pipeline/video_processor.py `
  data\\uploads\\<job>\\source.mp4 output\\reconstruction_jobs\\<job>\\frames `
  --stride 1 --max-dimension 2048 --duplicate-delta 0.0001
# Expected: frames.json records every decoded/inspected frame, source PTS timestamps,
# sharpness, duplicate decisions, retained image paths, and rejection counts.
```

### Parse DJI SRT telemetry
```powershell
.\\.venv\\Scripts\\python.exe pipeline/02b_telemetry.py `
  --frames-manifest output\\reconstruction_jobs\\<job>\\frames\\frames.json `
  --srt data\\uploads\\<job>\\flight.srt `
  --output output\\reconstruction_jobs\\<job>\\telemetry.json
# Expected: records are matched by timestamp within the configured age window.
# Missing matches remain unmatched; no GPS or pose is fabricated.
```

## Phase C — COLMAP sparse SfM and camera trajectory

### Run local Structure-from-Motion
```powershell
.\\.venv\\Scripts\\python.exe pipeline/04_colmap_sfm.py `
  --frames output\\reconstruction_jobs\\<job>\\frames `
  --workspace output\\reconstruction_jobs\\<job>\\sfm `
  --colmap .\\.tools\\colmap-4.2.1\\bin\\colmap.exe `
  --max-image-size 1600
# Expected on valid footage: status=sparse_ready, sparse model/Ply, trajectory.json,
# a metadata-only flight_path.geojson (no geographic features before Phase D), and
# sfm_summary.json. The runner uses linear sequential overlap
# plus explicit loop detection to avoid quadratic matching on dense video.
# status=registration_failed is an intentional fail-closed result; do not continue to MVS.
```

### Optional local telemetry pose priors
```powershell
.\\.venv\\Scripts\\python.exe pipeline/04_colmap_sfm.py `
  --frames output\\reconstruction_jobs\\<job>\\frames `
  --workspace output\\reconstruction_jobs\\<job>\\sfm-with-priors `
  --colmap .\\.tools\\colmap-4.2.1\\bin\\colmap.exe `
  --telemetry output\\reconstruction_jobs\\<job>\\telemetry.json `
  --apply-pose-priors
# Expected: pose_priors.json records local Cartesian candidates and COLMAP uses
# pose_prior_mapper. This is opt-in; it remains unvalidated for metric scale and CRS.
```

### Run Phase C tests
```powershell
.\\.venv\\Scripts\\python.exe -m pytest -q pipeline/tests/test_phase_c.py pipeline/tests/test_pose_priors.py
# Expected: fake-COLMAP orchestration, pose parsing, trajectory export, pose-prior
# installation, and the missing-manifest failure path pass without requiring a
# reconstruction or GPU.
```

### Full Python regression suite after Phase C
```powershell
.\\.venv\\Scripts\\python.exe -m pytest -q
# Actual: 43 passed, 1 skipped.
```

Actual Phase C smoke result on `data/uploads/33ed78c9_12131915_3840_2160_30fps.mp4`:
20 temporal-subset frames were inspected; COLMAP registered 3/20 (15.000%), so the
CLI exited 2 with `registration_failed`. A full 484-frame run previously registered
7/484 (1.446%). Both results are intentionally blocked from MVS; they are not mesh
successes. The GeoJSON file intentionally has no LineString until a valid WGS84/CRS
transform exists; local camera centers are available in `trajectory.json`.

Artifacts are in COLMAP's local similarity frame. `scale_status=unknown` and
`georeference_status=unanchored` remain until Phase D supplies validated evidence.

> Historical Phase 9–13 entries above describe code that was later reverted by D34. They are retained as history and are not evidence that those telemetry, QA, georeferencing, orthomosaic, or export features currently exist.

