import { Send, Loader2, Sparkles, Database } from "lucide-react";
import { useState } from "react";
import { useSpatialStore } from "@/store/spatialStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

/**
 * QueryBox
 *
 * Natural language query interface wired to the FastAPI AI agent loop.
 *
 * Beginner Analogy:
 * The voice assistant for your 3D city:
 * You ask "Which buildings are taller than 20 metres?", the local AI turns your question into
 * an exact PostGIS database query, filters the buildings instantly, and lights them up in radiant amber in 3D.
 */

import { API_BASE_URL } from "@/lib/api";

interface QueryResultItem {
  id: string;
  label: string;
  layer: string;
  height: number;
  area: number;
  region: string;
}

export function QueryBox() {
  const { setHighlightedObjectIds, setSelectedObjectId } = useSpatialStore();
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<QueryResultItem[]>([]);
  const [sqlExecuted, setSqlExecuted] = useState("");
  const [metrics, setMetrics] = useState<{
    count: number;
    avg_height_m: number;
    total_area_m2: number;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    setErrorMsg("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: query }),
      });

      if (!response.ok) {
        throw new Error(`Query failed: HTTP ${response.status}`);
      }

      const data = await response.json();
      console.log("[QueryBox] Backend response:", data);

      if (data.matched_ids && Array.isArray(data.matched_ids)) {
        const idStrings = data.matched_ids.map((id: number | string) => String(id));
        setHighlightedObjectIds(idStrings);

        const items: QueryResultItem[] = (data.objects || []).map((obj: any) => ({
          id: String(obj.id),
          label: `Building #${obj.id}`,
          layer: obj.class_name || "structures",
          height: Number(obj.height_m || 0),
          area: Number(obj.area_m2 || 0),
          region: obj.region || "CENTER",
        }));

        setResults(items);
        setSqlExecuted(data.sql || "");
        setMetrics(data.metrics || null);
      } else {
        setResults([]);
        setHighlightedObjectIds([]);
        setSqlExecuted(data.sql || "");
        setMetrics(null);
      }
    } catch (err: any) {
      console.error("[QueryBox] Execution failed:", err);
      setErrorMsg(err.message || "Failed to communicate with AI query service");
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickQuery = (example: string) => {
    setQuery(example);
  };

  return (
    <div className="w-full border border-border/80 bg-surface/40 backdrop-blur-md rounded-lg p-3.5 shadow-sm space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded border border-amber-500/40 bg-amber-950/30">
            <Sparkles className="h-3 w-3 text-amber-400" />
          </div>
          <span className="font-mono text-xs uppercase tracking-wider font-semibold text-foreground">
            Spatial AI Query
          </span>
        </div>
        <span className="label-tech text-[9px]">PostGIS Engine</span>
      </div>

      <p className="font-mono text-[10px] text-muted-foreground leading-relaxed">
        Query urban geometry in natural English (e.g. &quot;Which buildings are taller than 20m?&quot;).
      </p>

      {/* Query input form */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          placeholder="Ask about heights, regions, footprints..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={isLoading}
          className="flex-1 bg-background/80 border border-border-strong focus:border-amber-400 focus:outline-none rounded px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 transition-all"
        />
        <button
          type="submit"
          disabled={isLoading || !query.trim()}
          className="border border-amber-500 bg-amber-500/10 hover:bg-amber-500 hover:text-black disabled:opacity-50 text-amber-400 font-mono text-xs font-bold uppercase tracking-wider transition-all shadow-[0_0_15px_rgba(245,158,11,0.2)] px-3.5 py-1.5 rounded flex items-center gap-1.5 shrink-0"
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <>
              <Send className="h-3 w-3" />
              <span>Ask</span>
            </>
          )}
        </button>
      </form>

      {/* Canned Quick Queries */}
      <div className="space-y-1.5">
        <span className="label-tech text-[9px] block">Quick Queries:</span>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => handleQuickQuery("Which buildings are taller than 20 metres?")}
            className="border border-border/80 bg-background/60 hover:border-amber-400/60 hover:text-amber-300 font-mono text-[10px] tracking-wider uppercase px-2.5 py-1 rounded transition-colors text-muted-foreground"
          >
            Taller than 20m
          </button>
          <button
            type="button"
            onClick={() => handleQuickQuery("Show all buildings in the north region")}
            className="border border-border/80 bg-background/60 hover:border-amber-400/60 hover:text-amber-300 font-mono text-[10px] tracking-wider uppercase px-2.5 py-1 rounded transition-colors text-muted-foreground"
          >
            North region
          </button>
          <button
            type="button"
            onClick={() => handleQuickQuery("Buildings between 25 and 40 metres")}
            className="border border-border/80 bg-background/60 hover:border-amber-400/60 hover:text-amber-300 font-mono text-[10px] tracking-wider uppercase px-2.5 py-1 rounded transition-colors text-muted-foreground"
          >
            Between 25m & 40m
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-2.5 rounded border border-destructive/40 bg-destructive/10 text-destructive font-mono text-xs">
          {errorMsg}
        </div>
      )}

      {/* Results summary & table */}
      {results.length > 0 && (
        <div className="space-y-2.5 pt-2 border-t border-border/60">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="font-semibold text-amber-400 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              Matched: {results.length} buildings
            </span>
            {metrics && (
              <span className="text-[10px] text-muted-foreground">
                Avg: {metrics.avg_height_m}m · Area: {metrics.total_area_m2}m²
              </span>
            )}
          </div>

          <div className="border border-border/80 rounded bg-background/50 overflow-hidden max-h-48 overflow-y-auto">
            <Table className="text-[11px] font-mono">
              <TableHeader className="bg-surface/70 sticky top-0 z-10 border-b border-border/60">
                <TableRow className="h-7 hover:bg-transparent">
                  <TableHead className="py-1 text-[10px] tracking-wider uppercase text-muted-foreground">Building</TableHead>
                  <TableHead className="py-1 text-[10px] tracking-wider uppercase text-muted-foreground">Region</TableHead>
                  <TableHead className="py-1 text-right text-[10px] tracking-wider uppercase text-muted-foreground">Height</TableHead>
                  <TableHead className="py-1 text-right text-[10px] tracking-wider uppercase text-muted-foreground">Area</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r) => (
                  <TableRow
                    key={r.id}
                    onClick={() => setSelectedObjectId(r.id)}
                    className="cursor-pointer hover:bg-amber-500/15 h-7 transition-colors border-b border-border/30"
                  >
                    <TableCell className="py-1 font-semibold text-amber-400">
                      {r.label}
                    </TableCell>
                    <TableCell className="py-1">
                      <span className="border border-border/80 bg-surface/60 text-[9px] font-mono uppercase px-1.5 py-0.5 rounded text-muted-foreground">
                        {r.region}
                      </span>
                    </TableCell>
                    <TableCell className="py-1 text-right text-foreground font-semibold">
                      {r.height.toFixed(1)}m
                    </TableCell>
                    <TableCell className="py-1 text-right text-muted-foreground">
                      {r.area.toFixed(0)}m²
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Expandable Parameterized SQL */}
          {sqlExecuted && (
            <details className="text-[10px] font-mono border border-border/60 bg-surface/30 rounded p-2">
              <summary className="cursor-pointer font-medium text-muted-foreground flex items-center justify-between select-none hover:text-cyan-300 transition-colors">
                <span className="flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
                  <Database className="h-3 w-3 text-cyan-400" />
                  Compiled PostGIS SQL
                </span>
                <span className="text-[9px] text-cyan-400">View Query</span>
              </summary>
              <pre className="mt-2 p-2 bg-black/85 rounded border border-border/70 text-[10px] text-emerald-400 whitespace-pre-wrap overflow-x-auto shadow-inner leading-relaxed">
                {sqlExecuted}
              </pre>
            </details>
          )}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && results.length === 0 && !errorMsg && (
        <div className="text-center py-3 text-muted-foreground font-mono text-[10px] border border-dashed border-border/60 rounded bg-surface/20">
          Enter a prompt or select a quick query above to highlight structures.
        </div>
      )}
    </div>
  );
}
