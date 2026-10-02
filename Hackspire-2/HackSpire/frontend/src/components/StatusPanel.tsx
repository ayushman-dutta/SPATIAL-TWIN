import { Activity, Zap, CheckCircle2, Server, Cpu } from "lucide-react";
import { useWebSocket } from "@/hooks/useWebSocket";

export function StatusPanel() {
  const { isConnected } = useWebSocket();

  return (
    <div className="w-full border border-border/80 bg-surface/40 backdrop-blur-md rounded-lg p-3.5 shadow-sm space-y-3 font-mono text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded border border-cyan-500/40 bg-cyan-950/30">
            <Activity className="h-3 w-3 text-cyan-400" />
          </div>
          <span className="font-mono text-xs uppercase tracking-wider font-semibold text-foreground">
            System Telemetry
          </span>
        </div>
        <span className="label-tech text-[9px]">Live GPU Runtime</span>
      </div>

      {/* Services List */}
      <div className="space-y-2 pt-1">
        {/* WebSocket */}
        <div className="flex items-center justify-between p-2 rounded border border-border/50 bg-background/50">
          <span className="text-muted-foreground uppercase tracking-wider text-[10px]">WebSocket Mesh</span>
          <div className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isConnected
                  ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse"
                  : "bg-destructive"
              }`}
            />
            <span className={isConnected ? "text-emerald-400 font-semibold" : "text-destructive"}>
              {isConnected ? "CONNECTED" : "OFFLINE"}
            </span>
          </div>
        </div>

        {/* Database */}
        <div className="flex items-center justify-between p-2 rounded border border-border/50 bg-background/50">
          <span className="text-muted-foreground uppercase tracking-wider text-[10px]">PostGIS 16 + SFCGAL</span>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse" />
            <span className="text-emerald-400 font-semibold">HEALTHY</span>
          </div>
        </div>

        {/* Ollama LLM */}
        <div className="flex items-center justify-between p-2 rounded border border-border/50 bg-background/50">
          <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Qwen 2.5:3B (Ollama)</span>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
            <span className="text-cyan-300 font-semibold">RESIDENT</span>
          </div>
        </div>

        {/* VRAM */}
        <div className="flex items-center justify-between p-2 rounded border border-border/50 bg-background/50">
          <div className="flex items-center gap-1.5">
            <Zap className="h-3 w-3 text-cyan-400" />
            <span className="text-muted-foreground uppercase tracking-wider text-[10px]">GPU VRAM Budget</span>
          </div>
          <span className="text-foreground font-bold">~2.2 GB / 4.0 GB</span>
        </div>
      </div>

      {/* Frame Contract Info */}
      <div className="border-t border-border/50 pt-2 text-[10px] text-muted-foreground space-y-1">
        <div className="flex justify-between">
          <span>Coordinate Frame:</span>
          <span className="text-cyan-300 font-semibold">+Z Up (PostGIS SRID 0)</span>
        </div>
        <div className="flex justify-between">
          <span>Splat Format:</span>
          <span className="text-foreground">32-Byte Binary + 1:1 Sidecar</span>
        </div>
      </div>
    </div>
  );
}
