import { Eye, EyeOff, Layers, Sliders } from "lucide-react";
import { useSpatialStore } from "@/store/spatialStore";
import type { LayerId } from "@/types/spatial";
import { Slider } from "@/components/ui/slider";

const LAYERS: Array<{ id: LayerId; label: string; color: string }> = [
  { id: "buildings", label: "Structures / Splats", color: "bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.6)]" },
  { id: "terrain", label: "Ground & Elevation", color: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" },
  { id: "roads", label: "Road Network", color: "bg-slate-400" },
  { id: "vegetation", label: "Vegetation & Canopy", color: "bg-teal-400" },
  { id: "infrastructure", label: "Industrial Corridors", color: "bg-cyan-700" },
];

export function LayerControls() {
  const {
    layerVisibility,
    toggleLayer,
    setLayerOpacity,
    layerOpacity,
    soloLayerId,
    setSoloLayer,
  } = useSpatialStore();

  return (
    <div className="w-full border border-border/80 bg-surface/40 backdrop-blur-md rounded-lg p-3.5 shadow-sm space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded border border-cyan-500/40 bg-cyan-950/30">
            <Layers className="h-3 w-3 text-cyan-400" />
          </div>
          <span className="font-mono text-xs uppercase tracking-wider font-semibold text-foreground">
            Layer Visibility
          </span>
        </div>
        <span className="label-tech text-[9px]">Scene Alpha</span>
      </div>

      <p className="font-mono text-[10px] text-muted-foreground leading-relaxed">
        Toggle semantic classes and adjust individual opacity thresholds.
      </p>

      {/* Solo mode status */}
      {soloLayerId && (
        <div className="flex items-center justify-between p-2 rounded border border-cyan-500/40 bg-cyan-950/20 font-mono text-[10px]">
          <span className="text-cyan-300 uppercase tracking-wider">
            Solo Active: {soloLayerId}
          </span>
          <button
            onClick={() => setSoloLayer(null)}
            className="text-cyan-400 hover:text-white underline uppercase tracking-wider text-[9px]"
          >
            Clear Solo
          </button>
        </div>
      )}

      {/* Layer toggles */}
      <div className="space-y-2.5 pt-1">
        {LAYERS.map((layer) => {
          const isVisible = layerVisibility[layer.id];
          const isSolo = soloLayerId === layer.id;
          const opacity = layerOpacity[layer.id];

          return (
            <div
              key={layer.id}
              className={`p-2 rounded border transition-all ${
                isVisible
                  ? "border-border/60 bg-background/50"
                  : "border-border/30 bg-background/20 opacity-60"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`h-2.5 w-2.5 rounded-sm ${layer.color}`} />
                  <label className="font-mono text-xs text-foreground tracking-wider uppercase">
                    {layer.label}
                  </label>
                </div>

                <div className="flex items-center gap-1">
                  {/* Visibility toggle button */}
                  <button
                    onClick={() => toggleLayer(layer.id)}
                    className={`h-6 w-6 rounded border font-mono text-[10px] flex items-center justify-center transition-all ${
                      isVisible
                        ? "border-cyan-500/50 bg-cyan-950/30 text-cyan-300 hover:bg-cyan-950/50"
                        : "border-border/60 bg-surface/40 text-muted-foreground hover:text-foreground"
                    }`}
                    title={isVisible ? "Hide Layer" : "Show Layer"}
                  >
                    {isVisible ? (
                      <Eye className="h-3 w-3 text-cyan-400" />
                    ) : (
                      <EyeOff className="h-3 w-3 text-muted-foreground" />
                    )}
                  </button>

                  {/* Solo button */}
                  <button
                    onClick={() => setSoloLayer(isSolo ? null : layer.id)}
                    className={`h-6 px-1.5 rounded border font-mono text-[9px] uppercase tracking-wider transition-all font-semibold ${
                      isSolo
                        ? "border-cyan-500 bg-cyan-400 text-black shadow-[0_0_10px_rgba(6,182,212,0.4)]"
                        : "border-border/60 bg-surface/40 text-muted-foreground hover:text-cyan-300"
                    }`}
                    title="Solo this layer"
                  >
                    Solo
                  </button>
                </div>
              </div>

              {/* Opacity slider */}
              {isVisible && !isSolo && (
                <div className="mt-2.5 pt-2 border-t border-border/30 px-1">
                  <div className="flex items-center justify-between font-mono text-[9px] text-muted-foreground mb-1">
                    <span className="uppercase tracking-wider">Alpha</span>
                    <span className="text-foreground">{Math.round(opacity * 100)}%</span>
                  </div>
                  <Slider
                    value={[opacity]}
                    onValueChange={(val) =>
                      setLayerOpacity(layer.id, val[0] ?? 1.0)
                    }
                    min={0}
                    max={1}
                    step={0.05}
                    className="h-1.5"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
