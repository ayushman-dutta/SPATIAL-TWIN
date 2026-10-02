import { X, ChevronDown, Box, Layers, MapPin, Maximize2, ShieldCheck, CornerDownRight } from "lucide-react";
import { useSpatialStore } from "@/store/spatialStore";

export function ObjectInspector() {
  const { selectedObjectId, getSelectedObject, setSelectedObjectId } =
    useSpatialStore();

  const object = getSelectedObject();

  if (!selectedObjectId || !object) {
    return (
      <div className="w-full border border-border/80 bg-surface/40 backdrop-blur-md rounded-lg p-6 shadow-sm flex flex-col items-center justify-center text-center space-y-3 min-h-[360px]">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-950/20 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
          <Box className="h-6 w-6 text-cyan-400/60" />
        </div>
        <div className="space-y-1">
          <p className="label-tech text-[10px] text-cyan-400 font-bold tracking-widest uppercase">
            Object Inspector
          </p>
          <p className="font-mono text-xs text-muted-foreground leading-relaxed max-w-[220px]">
            Click any 3D structure or proxy mesh in the scene to inspect its PostGIS record.
          </p>
        </div>
        <div className="pt-2 border-t border-border/40 w-full">
          <span className="font-mono text-[9px] text-muted-foreground/70 uppercase tracking-wider block">
            Tip: Left-Click building to select · Click background to clear
          </span>
        </div>
      </div>
    );
  }

  const volume = object.width * object.depth * object.height;

  return (
    <div className="w-full border border-border/80 bg-surface/40 backdrop-blur-md rounded-lg p-3.5 shadow-sm space-y-3.5">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-border/50 pb-2.5">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-display text-base font-bold text-foreground uppercase tracking-wider line-clamp-1">
              {object.label}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-1 font-mono text-[10px]">
            <span className="border border-cyan-500/50 bg-cyan-950/40 text-cyan-300 font-bold px-1.5 py-0.5 rounded">
              ID #{object.id}
            </span>
            <span className="text-muted-foreground uppercase tracking-wider">
              · PostGIS Solid
            </span>
          </div>
        </div>

        <button
          onClick={() => setSelectedObjectId(null)}
          className="h-6 w-6 rounded border border-border/60 hover:border-cyan-400 hover:text-cyan-300 text-muted-foreground flex items-center justify-center transition-colors"
          title="Close Inspector"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Badges Row */}
      <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
        <span className="border border-border/80 bg-background/60 text-muted-foreground px-2 py-0.5 rounded uppercase tracking-wider">
          Layer: {object.layer}
        </span>
        {object.region && (
          <span className="border border-cyan-500/40 bg-cyan-950/20 text-cyan-300 px-2 py-0.5 rounded uppercase tracking-wider font-semibold">
            Region: {object.region.toUpperCase()}
          </span>
        )}
        {object.version !== undefined && (
          <span className="border border-border/80 bg-background/60 text-muted-foreground px-2 py-0.5 rounded">
            v{object.version}
          </span>
        )}
      </div>

      {/* Dimensions & Specifications Grid — Matching DigitalTwin.tsx Spec Card */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <div className="border border-border/60 bg-background/60 p-2.5 rounded">
          <p className="label-tech text-[9px]">Height (AGL)</p>
          <p className="font-mono text-sm font-bold text-cyan-400 mt-1">
            {object.height.toFixed(2)} m
          </p>
        </div>

        <div className="border border-border/60 bg-background/60 p-2.5 rounded">
          <p className="label-tech text-[9px]">Footprint Area</p>
          <p className="font-mono text-sm font-semibold text-foreground mt-1">
            {object.areaM2.toFixed(1)} m²
          </p>
        </div>

        <div className="border border-border/60 bg-background/60 p-2.5 rounded">
          <p className="label-tech text-[9px]">Estimated Volume</p>
          <p className="font-mono text-sm font-semibold text-foreground mt-1">
            {volume.toFixed(1)} m³
          </p>
        </div>

        <div className="border border-border/60 bg-background/60 p-2.5 rounded">
          <p className="label-tech text-[9px]">Base Elevation</p>
          <p className="font-mono text-sm font-medium text-muted-foreground mt-1">
            {object.elevationM.toFixed(2)} m
          </p>
        </div>
      </div>

      {/* Bounding Box / Spatial Coordinates (PostGIS) */}
      <div className="space-y-1.5 pt-1">
        <div className="flex items-center justify-between">
          <span className="label-tech text-[9px]">Spatial Coordinates (SRID 0)</span>
          {object.footprint?.coordinates?.[0] && (
            <span className="font-mono text-[9px] text-muted-foreground">
              {object.footprint.coordinates[0].length} vertices
            </span>
          )}
        </div>

        {object.splatBbox ? (
          <div className="bg-background/80 border border-border/80 p-2.5 rounded font-mono text-[10px] space-y-1 shadow-inner">
            <div className="flex justify-between">
              <span className="text-muted-foreground">X (E / W):</span>
              <span className="text-foreground">{object.splatBbox.min_x.toFixed(2)}m → {object.splatBbox.max_x.toFixed(2)}m</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Y (N / S):</span>
              <span className="text-foreground">{object.splatBbox.min_y.toFixed(2)}m → {object.splatBbox.max_y.toFixed(2)}m</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Z (Height):</span>
              <span className="text-cyan-400 font-bold">{object.splatBbox.min_z.toFixed(2)}m → {object.splatBbox.max_z.toFixed(2)}m</span>
            </div>
          </div>
        ) : (
          <div className="bg-background/80 border border-border/80 p-2 rounded font-mono text-[10px] space-y-1">
            <p>Center X: {object.x.toFixed(2)} m · Z: {object.z.toFixed(2)} m</p>
            <p className="text-muted-foreground">Footprint: {object.width.toFixed(2)}m × {object.depth.toFixed(2)}m</p>
          </div>
        )}
      </div>

      {/* Quick Action Commands */}
      <div className="space-y-1.5 pt-1 border-t border-border/50">
        <span className="label-tech text-[9px] block">Quick Actions:</span>
        <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
          <button
            onClick={() => {
              const input = document.querySelector<HTMLInputElement>("input[placeholder*='Raise']");
              if (input) {
                input.value = `Raise building ${object.id} by 10 metres`;
                input.focus();
              }
            }}
            className="border border-border/80 bg-background/60 hover:border-cyan-500/60 hover:text-cyan-300 hover:bg-cyan-950/20 py-1.5 px-2 rounded uppercase tracking-wider text-muted-foreground transition-all text-left flex items-center justify-between"
          >
            <span>+10m Height</span>
            <ChevronDown className="h-3 w-3 rotate-180 text-cyan-400" />
          </button>

          <button
            onClick={() => {
              const input = document.querySelector<HTMLInputElement>("input[placeholder*='Raise']");
              if (input) {
                input.value = `Flatten building ${object.id} to ground`;
                input.focus();
              }
            }}
            className="border border-border/80 bg-background/60 hover:border-cyan-500/60 hover:text-cyan-300 hover:bg-cyan-950/20 py-1.5 px-2 rounded uppercase tracking-wider text-muted-foreground transition-all text-left"
          >
            Flatten 0m
          </button>
        </div>
      </div>

      {/* Edit Audit History */}
      <div className="space-y-1 pt-1 border-t border-border/50">
        <span className="label-tech text-[9px] block">PostGIS Audit History</span>
        <div className="bg-background/60 border border-border/60 p-2 rounded font-mono text-[10px] text-muted-foreground space-y-0.5">
          <div className="flex justify-between">
            <span>Original Height:</span>
            <span className="text-foreground">{object.originalHeightM ? `${object.originalHeightM}m` : `${object.height}m`}</span>
          </div>
          <div className="flex justify-between">
            <span>Status:</span>
            <span className="text-emerald-400">Committed (v{object.version || 1})</span>
          </div>
        </div>
      </div>
    </div>
  );
}
