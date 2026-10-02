import { useEffect, useState } from "react";
import type { Box3 } from "three";
import { useSpatialStore } from "@/store/spatialStore";
import { useWebSocket } from "@/hooks/useWebSocket";
import { QueryBox } from "./QueryBox";
import { EditBox } from "./EditBox";
import { LayerControls } from "./LayerControls";
import { ObjectInspector } from "./ObjectInspector";
import { AccuracyBadge } from "./AccuracyBadge";
import { ExportModal } from "./ExportModal";
import { SceneCanvas } from "./three/SceneCanvas";
import { SplatRenderer } from "./three/SplatRenderer";
import { ProxyMeshes } from "./three/ProxyMeshes";
import { GhostOverlay } from "./three/GhostOverlay";
import { CameraControls } from "./three/CameraControls";
import {
  Box,
  RefreshCw,
  ArrowLeft,
  SlidersHorizontal,
  Info,
  Layers,
  Terminal,
  Compass,
  Download,
} from "lucide-react";
import type { SpatialObject } from "@/types/spatial";
import { API_BASE_URL, type BackendStructure } from "@/lib/api";

const WS_URL =
  (import.meta.env["VITE_WS_URL"] as string | undefined) || "ws://127.0.0.1:8000/ws/scene";

export function SpatialTwinApp() {
  const { setObjects, objects } = useSpatialStore();
  const { isConnected } = useWebSocket(WS_URL);
  const [projectInfo, setProjectInfo] = useState<{
    name: string;
    scale: number;
  } | null>(null);
  const [georeference, setGeoreference] = useState<{
    crs_name: string;
    origin_latlon_alt: [number, number, number];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [sceneBounds, setSceneBounds] = useState<Box3 | null>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);

  // Responsive panel collapse states
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [activeLeftTab, setActiveLeftTab] = useState<"query" | "edit" | "layers">("query");

  const fetchDatabaseObjects = async () => {
    setIsLoading(true);
    try {
      console.log("[SpatialTwinApp] Loading structures from PostGIS backend...");
      const [structRes, projRes, geoRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/objects/structures`),
        fetch(`${API_BASE_URL}/api/objects/project`),
        fetch(`${API_BASE_URL}/api/objects/georeference`),
      ]);

      if (projRes.ok) {
        const projData = await projRes.json();
        if (projData) {
          setProjectInfo({ name: projData.name, scale: projData.scale_factor });
        }
      }

      if (geoRes.ok) {
        const geoData = await geoRes.json();
        if (geoData) {
          setGeoreference({
            crs_name: geoData.crs_name || "Scene CRS unavailable",
            origin_latlon_alt: geoData.origin_latlon_alt || [0, 0, 0],
          });
        }
      }

      if (structRes.ok) {
        const rawStructures = await structRes.json();
        console.log(`[SpatialTwinApp] Loaded ${rawStructures.length} structures from database.`);

        const mappedObjects: SpatialObject[] = rawStructures.map((s: BackendStructure) => {
          const bbox = s.splat_bbox || {};
          const minX = bbox.min_x ?? -10;
          const maxX = bbox.max_x ?? 10;
          const minY = bbox.min_y ?? -10;
          const maxY = bbox.max_y ?? 10;
          const minZ = bbox.min_z ?? 0;

          return {
            id: String(s.id),
            label: `Building #${s.id} (${s.region || "Structure"})`,
            layer: "buildings",
            x: (minX + maxX) / 2.0,
            z: (minY + maxY) / 2.0,
            width: Math.max(1.0, maxX - minX),
            depth: Math.max(1.0, maxY - minY),
            height: Number(s.height_m || 20.0),
            elevationM: Number(minZ || 0.0),
            areaM2: Number(s.area_m2 || 150.0),
            region: s.region || "CENTER",
            footprint: s.footprint,
            splatBbox: bbox,
            originalHeightM: s.original_height_m,
            version: s.version || 1,
          };
        });

        setObjects(mappedObjects);
      }
    } catch (err) {
      console.error("[SpatialTwinApp] Failed to fetch database objects:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDatabaseObjects();
  }, []);

  return (
    <div className="w-full h-screen bg-background flex flex-col overflow-hidden text-foreground selection:bg-cyan-500/25">
      {/* Top Application Header — Styled with Landing Page Navbar DNA */}
      <header className="h-14 border-b border-border/80 bg-background/90 px-4 lg:px-6 flex items-center justify-between z-30 backdrop-blur-md shadow-sm">
        {/* Left: Brand Identity & Active Project Info */}
        <div className="flex items-center gap-3">
          <a href="/" title="Return to Landing Page" className="flex items-center gap-2.5 group">
            <div className="flex h-7 w-7 items-center justify-center rounded border border-cyan-500/50 bg-cyan-950/40 group-hover:border-cyan-400 group-hover:bg-cyan-500/20 transition-all">
              <Box className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-base tracking-[0.2em] text-foreground uppercase font-bold">
                Spatial Twin
              </span>
              <span className="font-mono text-[9px] text-cyan-400 tracking-widest uppercase">
                v2.5
              </span>
            </div>
          </a>

          <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-border/80">
            <span className="border border-border/80 bg-surface/40 px-2.5 py-1 font-mono text-[10px] tracking-wider text-muted-foreground uppercase flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
              {projectInfo ? projectInfo.name : "Mill-19 Digital Twin"}
            </span>

            {/* SkyeBrowse Survey Grade Accuracy Badge */}
            <AccuracyBadge />

            <div className="hidden lg:inline-flex items-center gap-2 px-3 py-1 rounded-full border border-cyan-500/30 bg-cyan-950/20 backdrop-blur-md">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400" />
              </span>
              <span className="font-mono text-[10px] tracking-widest text-cyan-300 uppercase font-semibold">
                PostGIS 16 · {objects.length} Structures Live
              </span>
            </div>
          </div>
        </div>

        {/* Right: Operational Controls & Links */}
        <div className="flex items-center gap-2.5">
          {/* Engineering Export Modal Trigger */}
          <button
            onClick={() => setIsExportOpen(true)}
            className="border border-cyan-500/60 bg-cyan-950/40 hover:bg-cyan-500/25 px-2.5 py-1 font-mono text-[10px] tracking-wider uppercase transition-all rounded flex items-center gap-1.5 text-cyan-300 font-semibold shadow-[0_0_12px_rgba(6,182,212,0.15)]"
            title="Download GeoTIFF, DSM, LAS, and DXF deliverables"
          >
            <Download className="h-3 w-3 text-cyan-400" />
            <span className="hidden sm:inline">Exports</span>
          </button>

          {/* Panel toggles for responsive control */}
          <button
            onClick={() => setShowLeftPanel(!showLeftPanel)}
            className={`border px-2.5 py-1 font-mono text-[10px] tracking-wider uppercase transition-all flex items-center gap-1.5 rounded ${
              showLeftPanel
                ? "border-cyan-500/60 bg-cyan-950/30 text-cyan-300"
                : "border-border/80 text-muted-foreground hover:text-foreground"
            }`}
            title="Toggle Left AI & Query Panels"
          >
            <SlidersHorizontal className="h-3 w-3" />
            <span className="hidden md:inline">Tools</span>
          </button>

          <button
            onClick={() => setShowRightPanel(!showRightPanel)}
            className={`border px-2.5 py-1 font-mono text-[10px] tracking-wider uppercase transition-all flex items-center gap-1.5 rounded ${
              showRightPanel
                ? "border-cyan-500/60 bg-cyan-950/30 text-cyan-300"
                : "border-border/80 text-muted-foreground hover:text-foreground"
            }`}
            title="Toggle Right Object Inspector"
          >
            <Info className="h-3 w-3" />
            <span className="hidden md:inline">Inspector</span>
          </button>

          <div className="h-4 w-px bg-border/80 mx-1 hidden sm:block" />

          {/* Database Sync Button */}
          <button
            onClick={fetchDatabaseObjects}
            title="Reload PostGIS structures"
            disabled={isLoading}
            className="border border-border/80 bg-surface/40 hover:border-cyan-500/60 hover:text-cyan-300 hover:bg-cyan-950/20 px-2.5 py-1 font-mono text-[10px] tracking-wider uppercase transition-all rounded flex items-center gap-1.5 text-muted-foreground"
          >
            <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin text-cyan-400" : ""}`} />
            <span className="hidden sm:inline">Sync DB</span>
          </button>

          {/* WebSocket Status Indicator */}
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded border border-border/80 bg-surface/30">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isConnected
                  ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse"
                  : "bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.8)]"
              }`}
            />
            <span className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground">
              {isConnected ? "WS Live" : "WS Offline"}
            </span>
          </div>

          {/* Exit to Landing Page */}
          <a
            href="/"
            className="hidden sm:flex items-center gap-1.5 border border-border/80 px-3 py-1 font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase transition-all hover:border-cyan-500/60 hover:text-cyan-300 hover:bg-cyan-950/20 rounded"
          >
            <ArrowLeft className="h-3 w-3" />
            Overview
          </a>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Side: Spatial AI Query, Natural Language Edit, & Layer Controls */}
        {showLeftPanel && (
          <aside className="w-[380px] shrink-0 border-r border-border/80 bg-background/85 backdrop-blur-md overflow-y-auto flex flex-col z-20 shadow-xl transition-all">
            {/* Quick Segmented Navigation Header for Left Sidebar */}
            <div className="p-3 border-b border-border/80 bg-surface/40 flex items-center justify-between gap-1">
              <button
                onClick={() => setActiveLeftTab("query")}
                className={`flex-1 py-1.5 px-2 font-mono text-[10px] tracking-wider uppercase rounded transition-all text-center flex items-center justify-center gap-1.5 ${
                  activeLeftTab === "query"
                    ? "border border-amber-500/60 bg-amber-500/10 text-amber-300 font-semibold shadow-[0_0_10px_rgba(245,158,11,0.15)]"
                    : "border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
                }`}
              >
                <Terminal className="h-3 w-3 text-amber-400" />
                Query
              </button>

              <button
                onClick={() => setActiveLeftTab("edit")}
                className={`flex-1 py-1.5 px-2 font-mono text-[10px] tracking-wider uppercase rounded transition-all text-center flex items-center justify-center gap-1.5 ${
                  activeLeftTab === "edit"
                    ? "border border-cyan-500/60 bg-cyan-950/30 text-cyan-300 font-semibold shadow-[0_0_10px_rgba(6,182,212,0.15)]"
                    : "border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
                }`}
              >
                <Compass className="h-3 w-3 text-cyan-400" />
                Edit
              </button>

              <button
                onClick={() => setActiveLeftTab("layers")}
                className={`flex-1 py-1.5 px-2 font-mono text-[10px] tracking-wider uppercase rounded transition-all text-center flex items-center justify-center gap-1.5 ${
                  activeLeftTab === "layers"
                    ? "border border-cyan-500/60 bg-cyan-950/30 text-cyan-300 font-semibold shadow-[0_0_10px_rgba(6,182,212,0.15)]"
                    : "border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
                }`}
              >
                <Layers className="h-3 w-3 text-cyan-400" />
                Layers
              </button>
            </div>

            {/* Panel Body according to active tab or combined stack */}
            <div className="flex-1 p-3.5 space-y-3.5 overflow-y-auto">
              {activeLeftTab === "query" && (
                <>
                  <QueryBox />
                  <div className="pt-2 border-t border-border/60">
                    <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground uppercase px-1 pb-1">
                      <span>Quick Access:</span>
                      <button
                        onClick={() => setActiveLeftTab("layers")}
                        className="text-cyan-400 hover:underline"
                      >
                        Adjust Layers →
                      </button>
                    </div>
                  </div>
                </>
              )}

              {activeLeftTab === "edit" && (
                <>
                  <EditBox />
                  <div className="pt-2 border-t border-border/60">
                    <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground uppercase px-1 pb-1">
                      <span>Quick Access:</span>
                      <button
                        onClick={() => setActiveLeftTab("query")}
                        className="text-amber-400 hover:underline"
                      >
                        ← Run Query
                      </button>
                    </div>
                  </div>
                </>
              )}

              {activeLeftTab === "layers" && (
                <>
                  <LayerControls />
                </>
              )}
            </div>
          </aside>
        )}

        {/* Center: 3D Gaussian Splat & Proxy Mesh Viewport */}
        <div className="flex-1 relative bg-black overflow-hidden">
          {/* Subtle Ambient Atmosphere Gradients & Cyber Grid */}
          <div className="pointer-events-none absolute inset-0 grid-backdrop opacity-20 z-0" />
          <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-gradient-to-b from-cyan-500/8 via-teal-500/4 to-transparent blur-3xl rounded-full z-0" />

          {/* Three.js 3D Canvas */}
          <SceneCanvas className="w-full h-full relative z-10" alwaysOn zUp>
            {/* 3D Content — Rendered inside sceneRoot rotation.x = -90° */}
            <SplatRenderer
              splatUrl="/static/scene.splat"
              classesUrl="/static/scene.classes.u8"
              onBounds={setSceneBounds}
              onError={setSceneError}
            />
            <ProxyMeshes />
            <GhostOverlay />
            <CameraControls bounds={sceneBounds} initialTarget={[0, 10, 0]} />
          </SceneCanvas>

          {sceneError && (
            <div
              role="alert"
              className="absolute top-40 left-4 right-4 z-20 rounded border border-red-500/50 bg-background/95 p-3 text-sm text-red-300"
            >
              Scene could not be loaded: {sceneError}
            </div>
          )}

          {/* Top-Left Telemetry & Georeferencing HUD */}
          <div className="absolute top-4 left-4 z-20 pointer-events-none space-y-1 bg-background/85 backdrop-blur-md p-3 rounded-lg border border-border/80 text-left font-mono shadow-[0_4px_25px_rgba(0,0,0,0.6)]">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </span>
              <span className="text-[11px] text-cyan-400 font-bold uppercase tracking-wider">
                Spatial Twin · Local Scene
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground tracking-wider">
              CRS: {georeference ? georeference.crs_name : "Scene CRS unavailable"}
            </p>
            <p className="text-[10px] text-muted-foreground tracking-wider">
              Origin:{" "}
              {georeference
                ? `${georeference.origin_latlon_alt[0].toFixed(4)}°N, ${Math.abs(georeference.origin_latlon_alt[1]).toFixed(4)}°W`
                : "Unavailable"}{" "}
              · Elev: {georeference ? `${georeference.origin_latlon_alt[2]}m` : "Unavailable"}
            </p>
            <p className="text-[10px] text-muted-foreground tracking-wider">
              Frame: +Z UP · Scene representation and calibration are reported by the manifest
            </p>
          </div>

          {/* Interactive Navigation HUD — Bottom Center */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-background/90 backdrop-blur-md px-4 py-2 rounded-full border border-border/80 font-mono text-[10px] tracking-wider text-muted-foreground flex items-center gap-3.5 pointer-events-none shadow-[0_8px_30px_rgba(0,0,0,0.6)]">
            <span className="flex items-center gap-1.5">
              <span className="text-cyan-400 font-bold">L-DRAG</span> Orbit
            </span>
            <span className="text-border-strong">•</span>
            <span className="flex items-center gap-1.5">
              <span className="text-cyan-400 font-bold">SCROLL</span> Zoom
            </span>
            <span className="text-border-strong">•</span>
            <span className="flex items-center gap-1.5">
              <span className="text-cyan-400 font-bold">CLICK</span> Inspect
            </span>
            <span className="text-border-strong">•</span>
            <span className="flex items-center gap-1.5">
              <span className="text-cyan-400 font-bold">SHIFT+DRAG</span> Pan
            </span>
            <span className="text-border-strong">•</span>
            <span className="flex items-center gap-1.5">
              <span className="text-cyan-400 font-bold">WASD</span> Fly
            </span>
          </div>
        </div>

        {/* Right Side: Object Inspector Panel */}
        {showRightPanel && (
          <aside className="w-[340px] shrink-0 border-l border-border/80 bg-background/85 backdrop-blur-md overflow-y-auto flex flex-col p-3.5 z-20 shadow-xl transition-all">
            <ObjectInspector />
          </aside>
        )}
      </div>

      {/* Engineering Deliverables Export Modal */}
      <ExportModal isOpen={isExportOpen} onClose={() => setIsExportOpen(false)} />
    </div>
  );
}
