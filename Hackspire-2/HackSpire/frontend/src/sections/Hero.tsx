import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowRight,
  Sparkles,
  Layers,
  Box,
  Cpu,
  Compass,
  RotateCw,
  Search,
  Maximize2,
  Terminal,
  Activity,
  Check,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SceneCanvas } from "@/components/three/SceneCanvas";
import {
  CoordinateMarkers,
  ElevationContours,
  FlightPath,
  GroundGrid,
  InteractiveOrbitControls,
  PointCloud,
  Roads,
  SpatialObjects,
} from "@/components/three/SpatialScene";
import { sceneSync, queriesSync } from "@/lib/mockApi";
import type { SpatialObject } from "@/types/spatial";

export function Hero() {
  // Query simulator state
  const [activeQueryIndex, setActiveQueryIndex] = useState<number | null>(null);
  const [extrudeCentral, setExtrudeCentral] = useState(false);
  const [selectedBuilding, setSelectedBuilding] = useState<SpatialObject | null>(null);
  const [hoveredBuilding, setHoveredBuilding] = useState<SpatialObject | null>(null);

  // Viewport layer controls
  const [showBuildings, setShowBuildings] = useState(true);
  const [showPointCloud, setShowPointCloud] = useState(true);
  const [showContours, setShowContours] = useState(true);
  const [showDrone, setShowDrone] = useState(true);
  const [showRoads, setShowRoads] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);

  // Camera viewpoint state
  const [cameraView, setCameraView] = useState<"perspective" | "topDown" | "isometric">("perspective");

  // Determine highlighted building IDs based on active query or selection
  const highlightedIds = useMemo(() => {
    if (selectedBuilding) return [selectedBuilding.id];
    if (activeQueryIndex === 0) {
      // Query 1: Buildings taller than 20m
      return sceneSync.objects
        .filter((o) => o.layer === "buildings" && o.height > 20)
        .map((o) => o.id);
    }
    if (activeQueryIndex === 1) {
      // Query 2: Distance to road (Building 12)
      return ["bld-12", "bld-04"];
    }
    if (activeQueryIndex === 2) {
      // Query 3: Central cluster
      return sceneSync.objects
        .filter((o) => o.layer === "buildings" && Math.abs(o.x) < 3.5 && Math.abs(o.z) < 3.5)
        .map((o) => o.id);
    }
    return [];
  }, [activeQueryIndex, selectedBuilding]);

  // Extrude central buildings for Query 3
  const extrudeIds = useMemo(() => {
    if (extrudeCentral) {
      return sceneSync.objects
        .filter((o) => o.layer === "buildings" && Math.abs(o.x) < 3.5 && Math.abs(o.z) < 3.5)
        .map((o) => o.id);
    }
    return [];
  }, [extrudeCentral]);

  const handleRunQuery = (index: number) => {
    if (activeQueryIndex === index) {
      setActiveQueryIndex(null);
      setExtrudeCentral(false);
      return;
    }
    setActiveQueryIndex(index);
    setSelectedBuilding(null);
    if (index === 2) {
      setExtrudeCentral(true);
    } else {
      setExtrudeCentral(false);
    }
  };

  const handleResetQuery = () => {
    setActiveQueryIndex(null);
    setExtrudeCentral(false);
    setSelectedBuilding(null);
  };

  // Queries definition
  const SAMPLE_QUERIES = [
    {
      id: 0,
      label: 'Which buildings are taller than 20m?',
      shortLabel: "Height > 20m",
      intent: { action: "filter", table: "structures", property: "height_m", op: ">", value: 20 },
      sql: "SELECT id, height_m, ST_Area(footprint) FROM structures WHERE height_m > 20 ORDER BY height_m DESC;",
      resultSummary: "7 structures matched (Max: 41.2m)",
    },
    {
      id: 1,
      label: 'Find Building 12 distance to nearest road corridor',
      shortLabel: "Bld 12 Corridor",
      intent: { action: "distance", origin_id: "bld-12", target: "roads" },
      sql: "SELECT ST_Distance(s.footprint, r.geom) AS distance_m FROM structures s CROSS JOIN roads r WHERE s.id = 12 LIMIT 1;",
      resultSummary: "Minimum clearance: 42.8 meters",
    },
    {
      id: 2,
      label: 'Extrude central commercial cluster by +15m',
      shortLabel: "Extrude Central +15m",
      intent: { action: "extrude", region: "central", delta_height_m: 15 },
      sql: "UPDATE structures SET height_m = height_m + 15 WHERE ST_Contains(ST_MakeEnvelope(-3.5, -3.5, 3.5, 3.5), footprint);",
      resultSummary: "7 structures extruded live in PostGIS",
    },
  ];

  return (
    <section id="top" className="relative pt-24 pb-16 overflow-hidden bg-background">
      {/* Background Gradients & Cyber Grid */}
      <div className="pointer-events-none absolute inset-0 grid-backdrop opacity-35" />
      <div className="pointer-events-none absolute top-10 left-1/2 -translate-x-1/2 w-[1000px] h-[450px] bg-gradient-to-b from-cyan-500/10 via-teal-500/5 to-transparent blur-3xl rounded-full" />

      <div className="relative mx-auto max-w-[1400px] px-6 lg:px-10">
        {/* Top Operational Status Pill */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="flex justify-center"
        >
          <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full border border-cyan-500/30 bg-cyan-950/20 backdrop-blur-md">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400" />
            </span>
            <span className="font-mono text-[10px] tracking-widest text-cyan-300 uppercase font-semibold">
              Spatial Twin v2.4 · 3D Gaussian Splats + PostGIS · 100% Local GPU
            </span>
          </div>
        </motion.div>

        {/* Main Headline & Value Proposition */}
        <div className="mt-7 text-center max-w-4xl mx-auto">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="font-display text-[clamp(2.4rem,5.8vw,5.4rem)] leading-[0.96] font-normal tracking-tight"
          >
            Turn Drone Footage Into an{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 font-semibold">
              Interactive 3D Digital Twin
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="mt-5 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed"
          >
            Reconstruct single-pass drone video into photorealistic 3D Gaussian Splat clouds aligned with
            a live PostGIS 16 spatial database. Query, inspect, and edit urban skylines in conversational English.
          </motion.p>

          {/* Primary Action Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="mt-8 flex flex-wrap items-center justify-center gap-4"
          >
            <Button
              asChild
              className="h-11 px-7 bg-cyan-500 hover:bg-cyan-400 text-black font-mono text-xs font-bold tracking-wider uppercase shadow-[0_0_25px_rgba(6,182,212,0.35)] transition-all"
            >
              <a href="/demo">
                Launch 3D Twin Demo
                <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>

            <Button
              asChild
              variant="outline"
              className="h-11 px-6 border-border-strong hover:border-cyan-400 hover:bg-muted font-mono text-xs uppercase tracking-wider"
            >
              <a href="#reconstruct">
                <Sparkles className="mr-2 h-4 w-4 text-cyan-400" />
                Ingest Drone Video
              </a>
            </Button>

            <Button
              asChild
              variant="ghost"
              className="h-11 px-5 font-mono text-xs text-muted-foreground hover:text-foreground uppercase tracking-wider"
            >
              <a href="#platform">View Architecture</a>
            </Button>
          </motion.div>
        </div>

        {/* Interactive Query Simulator Pills */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="mt-10 border border-border/80 bg-surface/40 backdrop-blur-md rounded-lg p-3 max-w-4xl mx-auto"
        >
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-2 pb-2.5 border-b border-border/40">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-cyan-400" />
              <span className="font-mono text-xs text-foreground uppercase tracking-wider font-semibold">
                Test Conversational AI Queries:
              </span>
            </div>
            {activeQueryIndex !== null && (
              <button
                onClick={handleResetQuery}
                className="font-mono text-[11px] text-muted-foreground hover:text-cyan-400 flex items-center gap-1 uppercase transition-colors"
              >
                <RotateCw className="h-3 w-3" />
                Reset 3D Scene
              </button>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {SAMPLE_QUERIES.map((q) => {
              const isActive = activeQueryIndex === q.id;
              return (
                <button
                  key={q.id}
                  onClick={() => handleRunQuery(q.id)}
                  className={`flex-1 min-w-[200px] text-left px-3.5 py-2 rounded font-mono text-xs transition-all border ${
                    isActive
                      ? "border-amber-400 bg-amber-500/10 text-amber-300 font-semibold shadow-[0_0_12px_rgba(245,158,11,0.2)]"
                      : "border-border-strong bg-background/60 text-muted-foreground hover:border-cyan-500/50 hover:text-foreground"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate">"{q.label}"</span>
                    {isActive ? (
                      <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0 ml-2 animate-pulse" />
                    ) : (
                      <Search className="h-3 w-3 shrink-0 ml-2 opacity-50" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Active Query Output Terminal Display */}
          <AnimatePresence>
            {activeQueryIndex !== null && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-3 pt-3 border-t border-border/50 font-mono text-[11px] space-y-1.5"
              >
                <div className="flex items-start gap-2 text-cyan-300">
                  <span className="text-muted-foreground shrink-0">Ollama Intent:</span>
                  <span className="truncate">{JSON.stringify(SAMPLE_QUERIES[activeQueryIndex].intent)}</span>
                </div>
                <div className="flex items-start gap-2 text-emerald-300">
                  <span className="text-muted-foreground shrink-0">PostGIS SQL:</span>
                  <span className="truncate text-emerald-400">{SAMPLE_QUERIES[activeQueryIndex].sql}</span>
                </div>
                <div className="flex items-center justify-between text-amber-300 pt-1 border-t border-border/30">
                  <span>Result: {SAMPLE_QUERIES[activeQueryIndex].resultSummary}</span>
                  <span className="text-muted-foreground">⚡ Latency: 980ms (GPU VRAM)</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* 3D Digital Twin Viewport (Centerpiece) */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="mt-8 relative w-full h-[540px] md:h-[620px] lg:h-[680px] rounded-xl border border-cyan-500/30 overflow-hidden shadow-[0_0_50px_rgba(6,182,212,0.12)] bg-black/95"
        >
          {/* Three.js Canvas */}
          <SceneCanvas
            className="w-full h-full"
            camera={{
              position:
                cameraView === "topDown"
                  ? [0, 32, 0.1]
                  : cameraView === "isometric"
                  ? [18, 16, 18]
                  : [0, 10, 24],
              fov: cameraView === "topDown" ? 38 : 42,
            }}
            alwaysOn
          >
            <InteractiveOrbitControls
              autoRotate={autoRotate && !selectedBuilding}
              autoRotateSpeed={0.5}
              target={[0, 1, 0]}
            />
            <GroundGrid size={64} divisions={32} />
            {showPointCloud && <PointCloud count={3800} size={0.05} />}
            {showContours && <ElevationContours rows={22} />}
            {showRoads && <Roads />}
            <CoordinateMarkers count={6} />
            {showDrone && <FlightPath speed={0.05} />}

            {showBuildings && (
              <SpatialObjects
                objects={sceneSync.objects}
                highlightIds={highlightedIds}
                extrudeIds={extrudeIds}
                extrudeMeters={15}
                selectedId={selectedBuilding?.id}
                interactive
                onSelect={(obj) => {
                  setSelectedBuilding(obj);
                  if (obj) setActiveQueryIndex(null);
                }}
                onHover={(obj) => setHoveredBuilding(obj)}
              />
            )}
          </SceneCanvas>

          {/* Top-Left Telemetry HUD */}
          <div className="absolute top-4 left-4 z-10 pointer-events-none space-y-1 bg-black/70 backdrop-blur-md p-3 rounded border border-border/60 text-left font-mono">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] text-cyan-400 font-bold uppercase tracking-wider">
                Mill-19 Digital Twin Live
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              GIS Origin: 47.6205° N, 122.3493° W · SRID 0
            </p>
            <p className="text-[10px] text-muted-foreground">
              Altitude: 118m AGL · Frame Normal: +Y Up
            </p>
          </div>

          {/* Top-Right Layer Switches */}
          <div className="absolute top-4 right-4 z-10 flex flex-wrap gap-1.5 bg-black/70 backdrop-blur-md p-2 rounded border border-border/60">
            <button
              onClick={() => setShowBuildings(!showBuildings)}
              className={`px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider rounded transition-colors ${
                showBuildings ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Buildings
            </button>
            <button
              onClick={() => setShowPointCloud(!showPointCloud)}
              className={`px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider rounded transition-colors ${
                showPointCloud ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Points
            </button>
            <button
              onClick={() => setShowContours(!showContours)}
              className={`px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider rounded transition-colors ${
                showContours ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Contours
            </button>
            <button
              onClick={() => setShowDrone(!showDrone)}
              className={`px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider rounded transition-colors ${
                showDrone ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Drone
            </button>
          </div>

          {/* Bottom-Left Camera Views & Auto-Rotate */}
          <div className="absolute bottom-4 left-4 z-10 flex items-center gap-2 bg-black/70 backdrop-blur-md p-2 rounded border border-border/60 font-mono text-[10px]">
            <button
              onClick={() => setCameraView("perspective")}
              className={`px-2.5 py-1 uppercase rounded ${
                cameraView === "perspective" ? "bg-muted text-foreground font-bold" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Perspective
            </button>
            <button
              onClick={() => setCameraView("topDown")}
              className={`px-2.5 py-1 uppercase rounded ${
                cameraView === "topDown" ? "bg-muted text-foreground font-bold" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Top-Down (GIS)
            </button>
            <button
              onClick={() => setAutoRotate(!autoRotate)}
              className={`px-2.5 py-1 uppercase rounded flex items-center gap-1 ${
                autoRotate ? "text-cyan-400" : "text-muted-foreground"
              }`}
            >
              <RotateCw className={`h-3 w-3 ${autoRotate ? "animate-spin" : ""}`} />
              Auto-Orbit
            </button>
          </div>

          {/* Building Inspector Modal Overlay */}
          <AnimatePresence>
            {(selectedBuilding || hoveredBuilding) && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="absolute bottom-4 right-4 z-20 w-72 bg-black/85 backdrop-blur-md p-4 rounded-lg border border-amber-500/50 shadow-2xl text-left font-mono"
              >
                {(() => {
                  const b = selectedBuilding || hoveredBuilding!;
                  return (
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between border-b border-border/60 pb-2">
                        <span className="font-bold text-amber-400 uppercase tracking-wider">
                          {b.label}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {selectedBuilding ? "Selected" : "Hovered"}
                        </span>
                      </div>
                      <div className="space-y-1 text-[11px]">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Height:</span>
                          <span className="text-foreground font-semibold">{b.height.toFixed(1)} meters</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Footprint Area:</span>
                          <span className="text-foreground">{b.areaM2} m²</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">PostGIS Geom:</span>
                          <span className="text-cyan-400">ST_Extrude (Solid)</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Position (X, Z):</span>
                          <span className="text-muted-foreground">[{b.x.toFixed(1)}, {b.z.toFixed(1)}]</span>
                        </div>
                      </div>
                      {selectedBuilding && (
                        <div className="pt-2">
                          <Button
                            asChild
                            size="sm"
                            className="w-full h-7 text-[10px] uppercase font-bold bg-amber-500 hover:bg-amber-400 text-black rounded-none"
                          >
                            <a href="/demo">Inspect in Full App →</a>
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bottom Center Interaction Hint */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none hidden sm:flex items-center gap-3 bg-black/60 backdrop-blur-md px-4 py-1.5 rounded-full border border-border/40 text-[10px] font-mono text-muted-foreground">
            <span>🖱️ Click building to inspect</span>
            <span>•</span>
            <span>Drag to orbit</span>
            <span>•</span>
            <span>Scroll to zoom</span>
          </div>
        </motion.div>

        {/* Live Telemetry KPI Metrics Strip */}
        <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4 border-t border-border pt-8 text-left">
          <div className="p-4 rounded border border-border/60 bg-surface/30">
            <div className="flex items-center gap-2 text-cyan-400 mb-1">
              <Cpu className="h-4 w-4" />
              <span className="label-tech text-cyan-400">Inference Latency</span>
            </div>
            <p className="font-mono text-xl sm:text-2xl font-bold text-foreground">&lt; 980 ms</p>
            <p className="text-[11px] text-muted-foreground mt-1">Local Ollama Qwen 2.5 3B</p>
          </div>

          <div className="p-4 rounded border border-border/60 bg-surface/30">
            <div className="flex items-center gap-2 text-teal-400 mb-1">
              <Layers className="h-4 w-4" />
              <span className="label-tech text-teal-400">Visual Layer</span>
            </div>
            <p className="font-mono text-xl sm:text-2xl font-bold text-foreground">1.42 M Splats</p>
            <p className="text-[11px] text-muted-foreground mt-1">3D Gaussian Splatting (gsplat)</p>
          </div>

          <div className="p-4 rounded border border-border/60 bg-surface/30">
            <div className="flex items-center gap-2 text-emerald-400 mb-1">
              <Box className="h-4 w-4" />
              <span className="label-tech text-emerald-400">Spatial Intelligence</span>
            </div>
            <p className="font-mono text-xl sm:text-2xl font-bold text-foreground">PostGIS 16</p>
            <p className="text-[11px] text-muted-foreground mt-1">SFCGAL 3D Solid Polygon Extrusions</p>
          </div>

          <div className="p-4 rounded border border-border/60 bg-surface/30">
            <div className="flex items-center gap-2 text-amber-400 mb-1">
              <Activity className="h-4 w-4" />
              <span className="label-tech text-amber-400">Hardware Budget</span>
            </div>
            <p className="font-mono text-xl sm:text-2xl font-bold text-foreground">4.0 GB VRAM</p>
            <p className="text-[11px] text-muted-foreground mt-1">100% on Laptop GPU (RTX 3050)</p>
          </div>
        </div>
      </div>
    </section>
  );
}
