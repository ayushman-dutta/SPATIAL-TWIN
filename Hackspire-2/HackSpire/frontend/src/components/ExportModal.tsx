import React, { useEffect, useState } from "react";
import { Download, FileText, Map, Layers, Box, Check, Loader2 } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";

interface ExportItem {
  format: string;
  filename: string;
  size_bytes: number;
  download_url: string;
}

export function ExportModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [exportsList, setExportsList] = useState<ExportItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      fetch(`${API_BASE_URL}/api/exports/list`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && data.available_exports) {
            setExportsList(data.available_exports);
          }
        })
        .catch((err) => console.warn("[ExportModal] Error listing exports:", err))
        .finally(() => setLoading(false));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const formatLabels: Record<string, { label: string; desc: string; icon: any }> = {
    orthomosaic_tif: {
      label: "2D Orthomosaic (.tif)",
      desc: "Top-down orthorectified photographic map for GIS/QGIS",
      icon: Map,
    },
    dsm_tif: {
      label: "Digital Surface Model (.tif)",
      desc: "True metric elevation raster for topography & flood analysis",
      icon: Layers,
    },
    point_cloud_las: {
      label: "Dense Point Cloud (.las)",
      desc: "Standard ASPRS LAS 1.2 point cloud with RGB & classifications",
      icon: Box,
    },
    point_cloud_obj: {
      label: "Wavefront Point Mesh (.obj)",
      desc: "Open 3D model compatible with Blender, Unreal, and CAD",
      icon: Box,
    },
    cad_footprints_dxf: {
      label: "CAD Vector Footprints (.dxf)",
      desc: "AutoCAD 2D closed polygon boundaries and layer definitions",
      icon: FileText,
    },
    gaussian_splat: {
      label: "Gaussian Splat (.splat)",
      desc: "Photorealistic 32-byte 3D Gaussian Splats for web viewers",
      icon: Layers,
    },
    quality_report: {
      label: "QA Certification (.json)",
      desc: "Court-admissible quality report with GSD and RMSE residuals",
      icon: FileText,
    },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 font-mono">
      <div className="w-full max-w-lg bg-background/95 border border-border/90 rounded-xl shadow-2xl p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-border/80 pb-3">
          <div className="flex items-center gap-2">
            <Download className="h-5 w-5 text-cyan-400" />
            <h3 className="font-display text-base tracking-wider uppercase text-foreground font-bold">
              Engineering Export Center
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-xs px-2 py-1 rounded border border-border/60 hover:bg-muted/40"
          >
            ✕ Close
          </button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Download only deliverables produced and validated by the local offline pipeline.
        </p>

        {loading ? (
          <div className="py-8 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
            <span className="text-[10px]">Scanning available deliverables...</span>
          </div>
        ) : (
          <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
            {exportsList.length === 0 ? (
              <div className="p-4 rounded border border-border/60 text-center text-[11px] text-muted-foreground">
                No offline deliverables generated yet. Run video reconstruction or export pipeline.
              </div>
            ) : (
              exportsList.map((item) => {
                const meta = formatLabels[item.format] || {
                  label: item.filename,
                  desc: "Standard geospatial export file",
                  icon: FileText,
                };
                const Icon = meta.icon;
                const sizeMb = (item.size_bytes / (1024 * 1024)).toFixed(2);

                return (
                  <div
                    key={item.format}
                    className="p-3 rounded-lg border border-border/80 bg-surface/40 hover:border-cyan-500/50 flex items-center justify-between gap-3 transition-all"
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="p-1.5 rounded bg-cyan-950/40 border border-cyan-500/30 text-cyan-400 mt-0.5">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold text-foreground tracking-wide">
                          {meta.label}
                        </div>
                        <div className="text-[9px] text-muted-foreground">
                          {meta.desc} · {sizeMb} MB
                        </div>
                      </div>
                    </div>

                    <a
                      href={`${API_BASE_URL}${item.download_url}`}
                      download={item.filename}
                      className="px-3 py-1.5 rounded border border-cyan-500/60 bg-cyan-950/40 hover:bg-cyan-500/20 text-cyan-300 text-[10px] tracking-wider uppercase font-semibold flex items-center gap-1.5 transition-all"
                    >
                      <Download className="h-3 w-3" />
                      Download
                    </a>
                  </div>
                );
              })
            )}
          </div>
        )}

        <div className="pt-2 border-t border-border/80 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>CRS and vertical datum are read from the scene manifest</span>
          <span>No certification is implied by export availability</span>
        </div>
      </div>
    </div>
  );
}
