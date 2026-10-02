import { Send, Loader2, Undo2, Compass, CheckCircle2, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useSpatialStore } from "@/store/spatialStore";
import { API_BASE_URL } from "@/lib/api";

export function EditBox() {
  const {
    objects,
    setGhostObjects,
    clearGhostObjects,
    setPreviewToken,
    previewToken,
    addHiddenBbox,
    setHiddenBboxes,
    setObjects,
  } = useSpatialStore();

  const [edit, setEdit] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [preview, setPreview] = useState<{
    command: string;
    affectedCount: number;
    deltaM: number;
  } | null>(null);
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit.trim()) return;

    setIsLoading(true);
    setMessage("");

    try {
      console.log(`[EditBox] Requesting preview for: "${edit}"`);
      const res = await fetch(`${API_BASE_URL}/api/edit/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: edit }),
      });

      const data = await res.json();

      if (data.status === "success" && data.preview_token) {
        setPreviewToken(data.preview_token);

        // Convert deltas into 3D Ghost objects
        const ghosts = (data.deltas || []).map((d: any) => {
          const match = objects.find((o) => o.id === String(d.object_id));
          return {
            id: String(d.object_id),
            originalHeight: d.current_height_m,
            newHeight: d.new_height_m,
            deltaHeight: d.delta_height_m,
            elevationM: match?.elevationM || 0,
            x: match?.x || 0,
            z: match?.z || 0,
            width: match?.width || 10,
            depth: match?.depth || 10,
            footprint: d.footprint || match?.footprint,
          };
        });

        setGhostObjects(ghosts);

        const deltaVal = data.deltas?.[0]?.delta_height_m ?? 10;
        setPreview({
          command: edit,
          affectedCount: data.affected_count,
          deltaM: deltaVal,
        });
        setMessage(`Preview generated: ${data.message || ""}`);
      } else {
        setMessage(data.message || "Could not generate preview.");
      }
    } catch (error) {
      console.error("[EditBox] Preview failed:", error);
      setMessage("Failed to connect to edit service.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!previewToken) return;

    setIsLoading(true);

    try {
      console.log(`[EditBox] Confirming edit with token: ${previewToken}`);
      const res = await fetch(`${API_BASE_URL}/api/edit/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview_token: previewToken }),
      });

      const data = await res.json();

      if (data.status === "success") {
        // Mask out old splats in the edited structures' bounding boxes
        (data.updated_objects || []).forEach((s: any) => {
          if (s.splat_bbox) {
            addHiddenBbox(s.splat_bbox);
          }
        });

        clearGhostObjects();
        setPreview(null);
        setEdit("");
        setMessage(`✓ Applied: ${data.message}`);
        setTimeout(() => setMessage(""), 4000);
      } else {
        setMessage(`Failed: ${data.message}`);
      }
    } catch (error) {
      console.error("[EditBox] Apply failed:", error);
      setMessage("Failed to apply changes to database.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    clearGhostObjects();
    setPreview(null);
    setMessage("");
  };

  const handleUndo = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/edit/undo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.status === "success") {
        setHiddenBboxes([]);
        setMessage(`✓ ${data.message}`);
      } else {
        setMessage(data.message || "Nothing to undo.");
      }
      setTimeout(() => setMessage(""), 3500);
    } catch (err) {
      console.error("[EditBox] Undo failed:", err);
      setMessage("Failed to undo last edit.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickEdit = (promptText: string) => {
    setEdit(promptText);
  };

  return (
    <div className="w-full border border-border/80 bg-surface/40 backdrop-blur-md rounded-lg p-3.5 shadow-sm space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded border border-cyan-500/40 bg-cyan-950/30">
            <Compass className="h-3 w-3 text-cyan-400" />
          </div>
          <span className="font-mono text-xs uppercase tracking-wider font-semibold text-foreground">
            Natural Language Edit
          </span>
        </div>
        <span className="label-tech text-[9px]">SFCGAL Extrude</span>
      </div>

      <p className="font-mono text-[10px] text-muted-foreground leading-relaxed">
        Modify physical heights with commands like &quot;Raise central buildings by 15m&quot;.
      </p>

      {/* Edit input form */}
      {!preview && (
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            placeholder="e.g. 'Raise central buildings by 15m'..."
            value={edit}
            onChange={(e) => setEdit(e.target.value)}
            disabled={isLoading}
            className="flex-1 bg-background/80 border border-border-strong focus:border-cyan-400 focus:outline-none rounded px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 transition-all"
          />
          <button
            type="submit"
            disabled={isLoading || !edit.trim()}
            className="border border-cyan-500 bg-cyan-500/10 hover:bg-cyan-500 hover:text-black disabled:opacity-50 text-cyan-400 font-mono text-xs font-bold uppercase tracking-wider transition-all shadow-[0_0_15px_rgba(6,182,212,0.2)] px-3.5 py-1.5 rounded flex items-center gap-1.5 shrink-0"
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Send className="h-3 w-3" />
                <span>Edit</span>
              </>
            )}
          </button>
        </form>
      )}

      {/* Canned Quick Edit suggestions */}
      {!preview && (
        <div className="space-y-1.5">
          <span className="label-tech text-[9px] block">Demo Edit Prompts:</span>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => handleQuickEdit("Raise central buildings by 15 metres")}
              className="border border-border/80 bg-background/60 hover:border-cyan-400/60 hover:text-cyan-300 font-mono text-[10px] tracking-wider uppercase px-2.5 py-1 rounded transition-colors text-muted-foreground"
            >
              +15m Central
            </button>
            <button
              type="button"
              onClick={() => handleQuickEdit("Extrude buildings in north region by 20m")}
              className="border border-border/80 bg-background/60 hover:border-cyan-400/60 hover:text-cyan-300 font-mono text-[10px] tracking-wider uppercase px-2.5 py-1 rounded transition-colors text-muted-foreground"
            >
              +20m North
            </button>
            <button
              type="button"
              onClick={() => handleQuickEdit("Lower the western buildings by 10 metres")}
              className="border border-border/80 bg-background/60 hover:border-cyan-400/60 hover:text-cyan-300 font-mono text-[10px] tracking-wider uppercase px-2.5 py-1 rounded transition-colors text-muted-foreground"
            >
              -10m West
            </button>
          </div>
        </div>
      )}

      {/* Preview Confirmation Mode */}
      {preview && (
        <div className="space-y-3 border border-cyan-500/40 bg-cyan-950/20 p-3 rounded-lg shadow-[0_0_20px_rgba(6,182,212,0.15)] font-mono text-xs">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-cyan-300 uppercase tracking-wider text-[11px]">
                Previewing: &quot;{preview.command}&quot;
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Affects {preview.affectedCount} structure{preview.affectedCount !== 1 ? "s" : ""}. Ghost holographic wireframe shows before/after.
              </p>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleConfirm}
              disabled={isLoading}
              className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-black font-mono text-xs font-bold uppercase tracking-wider py-1.5 px-3 rounded shadow-[0_0_15px_rgba(6,182,212,0.3)] transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Applying...
                </>
              ) : (
                "Confirm & Commit"
              )}
            </button>
            <button
              onClick={handleCancel}
              disabled={isLoading}
              className="border border-border-strong hover:bg-muted font-mono text-xs uppercase tracking-wider py-1.5 px-3 rounded text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Undo Button */}
      <div className="pt-1">
        <button
          onClick={handleUndo}
          disabled={isLoading}
          className="border border-border/80 bg-background/60 hover:border-cyan-500/50 hover:text-cyan-300 font-mono text-[10px] tracking-wider uppercase py-1.5 px-3 rounded flex items-center justify-center gap-2 text-muted-foreground w-full transition-all disabled:opacity-50"
        >
          <Undo2 className="h-3.5 w-3.5" />
          <span>Undo Last Geometry Edit</span>
        </button>
      </div>

      {/* Status message */}
      {message && (
        <div className="border border-emerald-500/40 bg-emerald-950/20 text-emerald-300 font-mono text-[11px] p-2 rounded flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          <span>{message}</span>
        </div>
      )}
    </div>
  );
}
