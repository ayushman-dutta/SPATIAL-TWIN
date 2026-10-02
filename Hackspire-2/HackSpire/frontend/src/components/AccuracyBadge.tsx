import React, { useEffect, useState } from "react";
import { AlertTriangle, CircleHelp, ShieldCheck } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";

interface SceneStatus {
  reconstruction_mode: string;
  scale_status: string;
  georeference_status: string;
  quality_status: string;
  independent_accuracy: string;
  capabilities: Record<string, boolean>;
  message: string;
}

/**
 * The badge is deliberately fail-closed: missing metadata is "unassessed", never survey grade.
 */
export function AccuracyBadge() {
  const [scene, setScene] = useState<SceneStatus | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/objects/scene`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setScene(data);
      })
      .catch((err) => console.warn("[AccuracyBadge] Failed to fetch scene status:", err));
  }, []);

  const assessed = scene?.quality_status === "passed" && scene.independent_accuracy === "assessed";
  const label = assessed ? "Accuracy assessed" : "Accuracy unassessed";
  const mode = scene?.reconstruction_mode || "unknown";

  return (
    <div className="relative inline-block text-left font-mono">
      <button
        onClick={() => setShowTooltip(!showTooltip)}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`px-2.5 py-1 rounded border flex items-center gap-1.5 transition-all text-[10px] tracking-wider uppercase font-semibold ${
          assessed
            ? "border-emerald-500/60 bg-emerald-950/40 text-emerald-300"
            : "border-amber-500/60 bg-amber-950/30 text-amber-300"
        }`}
      >
        {assessed ? <ShieldCheck className="h-3 w-3" /> : <CircleHelp className="h-3 w-3" />}
        <span>{label}</span>
      </button>

      {showTooltip && (
        <div className="absolute top-full mt-2 left-0 w-72 bg-background/95 backdrop-blur-md border border-border/90 p-3 rounded-lg shadow-2xl z-50 text-[10px] space-y-2 pointer-events-auto">
          <div className="flex items-center gap-1.5 border-b border-border/80 pb-1.5 text-foreground font-bold">
            {assessed ? (
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
            )}
            <span>
              {assessed ? "Independent assessment available" : "No accuracy certification"}
            </span>
          </div>
          <div className="space-y-1 text-muted-foreground">
            <div className="flex justify-between">
              <span>Reconstruction mode:</span>
              <span className="text-foreground">{mode}</span>
            </div>
            <div className="flex justify-between">
              <span>Scale:</span>
              <span className="text-foreground">{scene?.scale_status || "unknown"}</span>
            </div>
            <div className="flex justify-between">
              <span>Georeference:</span>
              <span className="text-foreground">{scene?.georeference_status || "unanchored"}</span>
            </div>
            <div className="flex justify-between">
              <span>Quality gate:</span>
              <span className="text-foreground">{scene?.quality_status || "unassessed"}</span>
            </div>
          </div>
          <p className="pt-1.5 border-t border-border/80 text-amber-300">
            {scene?.message || "Accuracy is not independently assessed."}
          </p>
        </div>
      )}
    </div>
  );
}
