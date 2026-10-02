# Spatial Twin 🛰️

> **From Drone Footage to an Interactive 3D Spatial Digital Twin**  
> Photorealistic 3D Gaussian Splatting + PostGIS spatial intelligence, queryable and editable in plain English, running 100% locally on a single laptop GPU (NVIDIA RTX 3050 4GB).

---

## 🏗️ Architecture Overview

> **Analogy:** Think of Spatial Twin like Google Earth merged with Iron Man's holographic computer. The 3D splats show you what the world looks like down to the centimeter, while the PostGIS spatial database knows the exact dimensions, volume, and identity of every building so an AI can answer questions and manipulate the scene.

```
                      ┌───────────────────────────────────────┐
                      │    Drone Footage / 3D Splat Cloud     │
                      └──────────────────┬────────────────────┘
                                         ▼
                      ┌───────────────────────────────────────┐
                      │    Offline Reconstruction Pipeline    │
                      │  • SegFormer Semantic Segmentation   │
                      │  • RANSAC Ground Fitting (Z-Up)       │
                      │  • DBSCAN Building Clustering         │
                      │  • SFCGAL 3D Solid Polygon Extrusion  │
                      └───────┬───────────────────────┬───────┘
                              │                       │
           Exported 3D Splats │                       │ 3D Geometry & Footprints
        (scene.splat + u8)    │                       │ (SRID 0 Metres)
                              ▼                       ▼
           ┌───────────────────────┐   ┌─────────────────────────────┐
           │ Static Asset Server   │   │  PostGIS 16 + SFCGAL (Docker)│
           │ (FastAPI /static)     │   │  spatial-twin-db (Port 5435)│
           └──────────┬────────────┘   └──────────────┬──────────────┘
                      │                               │
                      │         FastAPI Backend       │
                      │  (http://127.0.0.1:8000)      │
                      │  • Ollama Intent Parser (LLM) │
                      │  • Safe Parameterized SQL     │
                      │  • WebSocket Scene Broadcast  │
                      └───────────────┬───────────────┘
                                      │
                                      ▼
                      ┌───────────────────────────────┐
                      │  Frontend App (Port 8080)     │
                      │  • Three.js Splat Renderer    │
                      │  • Extruded Proxy Meshes      │
                      │  • Raycast Click-to-Inspect   │
                      │  • Natural Language Query Box │
                      └───────────────────────────────┘
```

1. **Visual Layer:** Custom WebGL Gaussian Splat fragment shader rendering binary `.splat` buffers (32 bytes/splat) with 1:1 binary semantic sidecar classification (`scene.classes.u8`) for real-time CPU-side alpha layer masking.
2. **Spatial Intelligence Layer:** PostgreSQL 16 + PostGIS 3.4 + SFCGAL database container storing true 2D footprints (`ST_Polygon`), 3D solid polyhedral surfaces (`ST_Extrude`), heights, bounding boxes, and computed metrics.
3. **Reasoning & Query Engine:** Local LLM (`qwen2.5:3b` via Ollama) enforcing strict JSON schema intent parsing with sub-second execution (~980ms), backed by a deterministic regex fallback matcher.
4. **Interactive 3D Frontend:** React + Vite + Three.js (`@react-three/fiber`) featuring live raycasted proxy mesh picking, radiant amber query highlights, real-time PostGIS inspector, and WebSocket updates.

---

## 💻 System Requirements & Prerequisites

- **Operating System:** Windows 10/11, Ubuntu 22.04+, or macOS
- **GPU:** NVIDIA GPU with CUDA support (e.g. RTX 3050 Laptop 4GB VRAM or better)
- **Docker Desktop:** Installed and running (with Compose v2)
- **Python:** Version 3.11.x
- **Node.js:** Version 20+ with `npm`
- **Ollama:** Installed locally ([ollama.com](https://ollama.com))

---

## 🚀 How to Run the Complete System

Follow these steps in order to start all components.

### Step 1: Clone Repository & Setup Environment Variables

```powershell
# Copy the example environment file
cp .env.example .env
```

*Default environment variables configured in `.env`:*
- `POSTGRES_PORT=5435` (mapped to container port 5432 to avoid host conflicts)
- `POSTGRES_DB=spatial_twin`
- `POSTGRES_USER=spatial_user`
- `POSTGRES_PASSWORD=spatial_pass`
- `OLLAMA_BASE_URL=http://127.0.0.1:11434`
- `OLLAMA_MODEL=qwen2.5:3b`
- `STATIC_ASSETS_DIR=data/web`

---

### Step 2: Start PostGIS Database Container

> **What this does:** Boots the PostgreSQL 16 + PostGIS 3.4 + SFCGAL container on host port `5435`.

```powershell
docker compose up -d db
```

#### Verify Database Health & SFCGAL 3D Extension:
```powershell
# Check container status (must show healthy on port 5435)
docker compose ps

# Verify PostGIS and SFCGAL versions
docker exec -i spatial-twin-db psql -U spatial_user -d spatial_twin -c "SELECT PostGIS_Full_Version();"

# Verify 3D SFCGAL Polyhedral solid extrusion
docker exec -i spatial-twin-db psql -U spatial_user -d spatial_twin -c "SELECT ST_AsText(ST_Extrude('POLYGON((0 0,1 0,1 1,0 1,0 0))'::geometry,0,0,5));"
```

---

### Step 3: Start Ollama & Pull the AI Model

> **What this does:** Ensures the local Ollama LLM service is running and downloads the Qwen 2.5 3B model.

```powershell
# Pull the required 3B parameter model (~1.9 GB)
ollama pull qwen2.5:3b

# Verify Ollama is serving the model
curl.exe http://127.0.0.1:11434/api/tags
```

---

### Step 4: Setup Python Backend Environment

> **What this does:** Creates a Python 3.11 virtual environment and installs backend dependencies.

```powershell
# Create virtual environment (if not already created)
python -m venv .venv

# Activate virtual environment
# On Windows PowerShell:
.\.venv\Scripts\Activate.ps1
# On Linux/macOS:
# source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

*(Optional) Seed database and run pipeline if regenerating 3D splats:*
```powershell
# Applies schema and initial regions
Get-Content db/schema.sql | docker exec -i spatial-twin-db psql -U spatial_user -d spatial_twin
Get-Content db/regions.sql | docker exec -i spatial-twin-db psql -U spatial_user -d spatial_twin

# Runs the complete offline ML & geometry pipeline
python pipeline/run_pipeline.py
```

---

### Step 5: Start the FastAPI Backend Server

> **What this does:** Launches the FastAPI backend on `http://127.0.0.1:8000`. On boot, it automatically connects to PostGIS, pre-warms the Ollama model in GPU VRAM, and serves static 3D splat files.

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

#### Verify Backend Server:
- **API Status:** `http://127.0.0.1:8000/api/status` (Returns `{"status":"OK","db_connected":true}`)
- **Interactive Swagger Docs:** `http://127.0.0.1:8000/docs`
- **Static 3D Splat Assets:** `http://127.0.0.1:8000/static/scene.splat`

---

### Step 6: Start the Frontend Application

> **What this does:** Installs npm packages and launches the Vite React development server.

Open a **new terminal window**:

```powershell
cd frontend

# Install frontend dependencies
npm install

# Start the Vite development server
npm run dev
```

The frontend will start and display:
```
  VITE v6.x.x  ready in 450 ms

  ➜  Local:   http://localhost:8080/
  ➜  Network: use --host to expose
```

---

## 🌐 Application URLs

| Interface | URL | Purpose |
|---|---|---|
| **Digital Twin 3D App** | [http://localhost:8080/demo](http://localhost:8080/demo) | Full 3D viewer, object inspector, and live query interface |
| **Landing Page** | [http://localhost:8080/](http://localhost:8080/) | Product introduction and live demo entry point |
| **Backend API Health** | [http://127.0.0.1:8000/api/status](http://127.0.0.1:8000/api/status) | Confirms database connectivity and backend state |
| **Swagger / OpenAPI** | [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) | Interactive API exploration and manual testing |

---

## 🔍 How to Use the Digital Twin

1. **Orbit & Explore:** Left-click and drag in the 3D viewport to orbit around the Mill-19 scene. Right-click and drag to pan, scroll to zoom.
2. **Click to Inspect:** Click on any building proxy mesh. The **Object Inspector** on the right panel instantly displays:
   - Real PostGIS Building ID & Class
   - Exact physical height in metres (`height_m`)
   - Surface footprint area (`area_m2`) and estimated volume
   - Geographic region (`center`, `east`, `north`, etc.)
   - 3D Bounding Box coordinates
3. **Ask Natural Language Questions:** Type questions into the **Query Box** on the bottom-left panel and hit Enter:
   - *"Which buildings are taller than 20 metres?"*
   - *"Show structures in the center region"*
   - *"Find objects shorter than 15m"*
4. **Live Visual Highlights:** Matched buildings illuminate in **radiant amber** in the 3D scene, while summary metrics (total count, average height, total ground footprint) and the compiled PostGIS SQL query appear in the query box.
5. **Toggle Semantic Layers:** Use the layer toggles on the sidebar (Structures, Ground, Vegetation) to dynamically show or hide specific classes of splats.

---

## 🧪 Testing & Verification Commands

### 1. Test Backend AI Query Loop (Automated Tests)
```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_query_loop.py -v
```
*Expected Result:* 11/11 tests pass in ~7 seconds, verifying intent parsing, SQL compilation, regex fallback, height/region queries, and nonsense handling.

### 2. Test Live Query Endpoint with PowerShell
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/query" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"text": "Which buildings are taller than 20 metres?"}' | ConvertTo-Json -Depth 5
```
*Expected Result:* Returns status `"success"`, matched IDs `[30, 25, 22, 29, 21, 27, 23]`, live metrics, and parameterized PostGIS SQL in `< 1.2s`.

### 3. Verify Frontend Production Build
```powershell
cd frontend
npm run build
```
*Expected Result:* Vite builds both client and server bundles cleanly with 0 TypeScript or lint errors.

---

## 📂 Project Structure

```
spatial-twin/
├── backend/                  # FastAPI Application
│   ├── agent/               # AI reasoning engine (Ollama client, intent schema, SQL compiler)
│   ├── db/                  # Asyncpg database connection and queries
│   ├── routers/             # API routes: /api/status, /api/objects, /api/query
│   ├── schemas/             # Pydantic data schemas
│   ├── ws/                  # WebSocket connection manager
│   └── main.py              # Application entry point with lifespan warmup
├── frontend/                 # React + Three.js Web Application
│   ├── src/
│   │   ├── components/      # UI components (QueryBox, ObjectInspector, EditBox, etc.)
│   │   │   └── three/       # 3D viewport (SplatRenderer, ProxyMeshes, SceneSetup)
│   │   ├── lib/             # API client, PostGIS transformers, and utils
│   │   ├── store/           # Zustand state management (objects, highlights, selection)
│   │   └── routes/          # TanStack router pages (/ and /demo)
│   └── package.json         # Frontend dependencies and build scripts
├── pipeline/                 # Offline ML & 3D Reconstruction Pipeline
│   ├── 00_env_check.py      # CUDA, PostGIS, and Ollama environment diagnostics
│   ├── 01_colmap_runner.py  # Structure-from-Motion photogrammetry
│   ├── 03_segformer.py      # SegFormer semantic keyframe segmentation
│   ├── 05_postprocess.py    # RANSAC ground alignment & DBSCAN clustering
│   ├── 06_load_postgis.py   # PostGIS database loader with 3D SFCGAL solids
│   └── 07_export_web.py     # Binary .splat and .classes.u8 exporter
├── data/
│   └── web/                 # Static 3D assets served by backend (scene.splat, scene.classes.u8)
├── db/                       # SQL database migrations and region definitions
├── docker-compose.yml        # PostGIS 16 + SFCGAL container configuration
├── PLAN.md                   # Complete architectural plan and phase checklist
├── AGENTS.md                 # Working agreements, rules, and error protocols
└── README.md                 # Project documentation and setup guide
```

---

## 🛠️ Troubleshooting & Known Gotchas

- **Ollama Cold Starts:** Ollama unloads idle models from VRAM after 5 minutes. The backend sets `keep_alive: 60m` and pre-warms the model on startup via `lifespan(app)`. If you ever restart Ollama manually, run `curl.exe http://127.0.0.1:8000/api/status` to trigger re-warming.
- **Port 5432 in Use:** By default, PostGIS runs on host port **5435** (`127.0.0.1:5435`) to avoid conflicts with existing local PostgreSQL installations.
- **Three.js Coordinates:** The scene root is rotated `-90°` on the X-axis (`rotation.x = -Math.PI / 2`) so PostGIS coordinates $(X, Y, Z)$ map directly to Three.js coordinates $(X, Z_{\text{up}}, -Y)$ without per-mesh conversions.

---

## 📜 License

MIT License. Developed for HackSpire 2026.
