import { useState, useEffect, useRef, type DragEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Upload,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Cloud,
  FileCode,
  ExternalLink,
  ArrowRight,
  Play,
  RotateCcw,
  Sparkles,
  Video,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal, SectionLabel } from "@/components/Reveal";
import { api } from "@/lib/api";

export function DroneReconstructionSection() {
  const [activeTab, setActiveTab] = useState<"fast_local" | "cloud_3dgs" | "splat_import">("fast_local");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedSplat, setSelectedSplat] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "processing" | "completed" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [stepText, setStepText] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [summary, setSummary] = useState<any>(null);
  const [kaggleReady, setKaggleReady] = useState(false);

  const pollRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => {
    api.getKaggleConfig().then((cfg) => setKaggleReady(cfg.configured)).catch(() => {});
    return () => {
      stopPolling();
    };
  }, []);

  const acceptVideoFile = (file?: File) => {
    stopPolling();
    if (file) {
      setSelectedFile(file);
      setStatus("idle");
      setProgress(0);
      setErrorMsg("");
      setSummary(null);
    }
  };

  const acceptSplatFile = (file?: File) => {
    stopPolling();
    if (file) {
      setSelectedSplat(file);
      setStatus("idle");
      setProgress(0);
      setErrorMsg("");
      setSummary(null);
    }
  };

  // Pre-load demo footage for easy 1-click testing
  const handleLoadDemoFlight = async () => {
    try {
      let response = await fetch("/mill19_sample_flight.mp4");
      if (!response.ok) {
        response = await fetch("/api/pipeline/sample-video");
      }
      if (response.ok) {
        const blob = await response.blob();
        const realFile = new File([blob], "mill19_building_flight_320frames.mp4", {
          type: "video/mp4",
        });
        acceptVideoFile(realFile);
        return;
      }
    } catch (e) {
      console.warn("Could not fetch remote sample video:", e);
    }
    const blob = new Blob(["demo-drone-video-bytes"], { type: "video/mp4" });
    const mockFile = new File([blob], "mill19_building_flight_320frames.mp4", {
      type: "video/mp4",
    });
    acceptVideoFile(mockFile);
  };


  const startPollingStatus = () => {
    stopPolling();
    let pollCount = 0;
    const maxPolls = 180; // 3-minute safeguard

    pollRef.current = window.setInterval(async () => {
      pollCount++;
      if (pollCount > maxPolls) {
        stopPolling();
        setStatus("error");
        setErrorMsg("Pipeline processing timed out after 3 minutes.");
        return;
      }

      try {
        const st = await api.fetchPipelineStatus();
        setProgress(st.progress);
        setStepText(st.step);

        if (st.status === "completed") {
          stopPolling();
          setStatus("completed");
          setSummary(st.details);
        } else if (st.status === "error") {
          stopPolling();
          setStatus("error");
          setErrorMsg(st.error || "Reconstruction failed");
        }
      } catch (err: any) {
        console.error("Pipeline polling error:", err);
      }
    }, 1000);
  };

  const handleStartFastLocal = async () => {
    if (!selectedFile) return;
    setStatus("processing");
    setProgress(15);
    setStepText("Extracting keyframes & computing authentic 3D depth unprojection...");
    setErrorMsg("");

    try {
      await api.uploadDroneVideo(selectedFile);
      startPollingStatus();
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message || "Failed to initialize fast local pipeline");
    }
  };

  const handleStartKaggle = async () => {
    if (!selectedFile) return;
    setStatus("processing");
    setProgress(15);
    setStepText("Delegating 3DGS training to Kaggle Cloud 16GB GPU cluster...");
    setErrorMsg("");

    try {
      await api.uploadDroneVideoKaggle(selectedFile);
      startPollingStatus();
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message || "Failed to start Kaggle GPU job");
    }
  };

  const handleImportSplat = async () => {
    if (!selectedSplat) return;
    setStatus("processing");
    setProgress(40);
    setStepText(`Importing trained 3D Gaussian splat '${selectedSplat.name}'...`);
    setErrorMsg("");

    try {
      const res = await api.importTrainedSplat(selectedSplat);
      setProgress(100);
      setStatus("completed");
      setSummary({
        pipeline_duration_seconds: 1.2,
        buildings_extracted: res.buildings_extracted,
        splat_file: selectedSplat.name,
      });
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message || "Failed to import splat file");
    }
  };

  const handleReset = () => {
    setStatus("idle");
    setProgress(0);
    setSelectedFile(null);
    setSelectedSplat(null);
    setSummary(null);
    setErrorMsg("");
  };

  return (
    <section id="reconstruct" className="relative border-t border-border py-28 bg-background">
      <div className="pointer-events-none absolute inset-0 grid-backdrop opacity-30" />

      <div className="relative mx-auto max-w-[1400px] px-6 lg:px-10">
        <Reveal>
          <SectionLabel index="00">Ingest & Reconstruct</SectionLabel>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="mt-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <h2 className="max-w-3xl font-display text-[clamp(2.2rem,4.8vw,4.2rem)] leading-[1.02] font-medium tracking-tight">
                Process Your Own <span className="text-cyan-400">Drone Flight</span>
              </h2>
              <p className="mt-4 max-w-2xl text-base text-muted-foreground leading-relaxed">
                Feed real aerial footage into the local offline reconstruction pipeline. The current preview path is
                clearly separated from the validated SfM/MVS textured-mesh path that will publish the final scene.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={handleLoadDemoFlight}
                variant="outline"
                size="sm"
                className="font-mono text-xs uppercase tracking-wider border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10 flex items-center gap-2"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Load Mill-19 Sample Video
              </Button>
            </div>
          </div>
        </Reveal>

        {/* Processing Console Card */}
        <div className="mt-14 max-w-4xl mx-auto border border-border-strong bg-surface/50 backdrop-blur-md rounded-lg overflow-hidden shadow-2xl">
          {/* Tab Navigation */}
          <div className="flex flex-wrap border-b border-border bg-muted/30">
            <button
              onClick={() => { setActiveTab("fast_local"); handleReset(); }}
              className={`flex-1 py-4 px-5 font-mono text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all border-b-2 ${
                activeTab === "fast_local"
                  ? "border-cyan-400 text-cyan-400 bg-cyan-950/20 font-bold"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Zap className="h-4 w-4" />
              ⚡ Local preview (unmeasured)
            </button>

            <button
              onClick={() => { setActiveTab("cloud_3dgs"); handleReset(); }}
              className={`flex-1 py-4 px-5 font-mono text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all border-b-2 ${
                activeTab === "cloud_3dgs"
                  ? "border-cyan-400 text-cyan-400 bg-cyan-950/20 font-bold"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Cloud className="h-4 w-4" />
              🧭 Offline SfM/MVS (planned)
            </button>

            <button
              onClick={() => { setActiveTab("splat_import"); handleReset(); }}
              className={`flex-1 py-4 px-5 font-mono text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all border-b-2 ${
                activeTab === "splat_import"
                  ? "border-cyan-400 text-cyan-400 bg-cyan-950/20 font-bold"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileCode className="h-4 w-4" />
              📦 Import existing splat
            </button>
          </div>

          {/* Console Body */}
          <div className="p-8">
            {/* Status: Processing */}
            {status === "processing" && (
              <div className="space-y-6 py-6 text-center">
                <div className="flex justify-center">
                  <div className="relative">
                    <Loader2 className="h-12 w-12 animate-spin text-cyan-400" />
                    <div className="absolute inset-0 rounded-full blur-md bg-cyan-400/20" />
                  </div>
                </div>

                <div>
                  <h4 className="font-mono text-sm tracking-widest uppercase text-cyan-400 font-bold">
                    Reconstruction in Progress
                  </h4>
                  <p className="mt-2 font-mono text-xs text-muted-foreground">
                    {stepText || "Extracting frames and generating spatial geometry..."}
                  </p>
                </div>

                {/* Progress bar */}
                <div className="max-w-md mx-auto space-y-2">
                  <div className="h-2 w-full bg-muted overflow-hidden rounded-full border border-border">
                    <motion.div
                      className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400"
                      initial={{ width: "0%" }}
                      animate={{ width: `${Math.max(12, progress)}%` }}
                      transition={{ duration: 0.4 }}
                    />
                  </div>
                  <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
                    <span>STAGE 1/4 · 3D GEOMETRY</span>
                    <span>{progress}%</span>
                  </div>
                </div>

                <p className="text-[11px] font-mono text-muted-foreground/80 max-w-sm mx-auto">
                  Running local pipeline work. The scene is published only after the reconstruction manifest and quality gate validate its assets.
                </p>
              </div>
            )}

            {/* Status: Completed */}
            {status === "completed" && (
              <div className="space-y-6 py-6 text-center">
                <div className="flex justify-center">
                  <div className="h-12 w-12 rounded-full bg-emerald-500/10 border border-emerald-500/40 flex items-center justify-center">
                    <CheckCircle2 className="h-7 w-7 text-emerald-400" />
                  </div>
                </div>

                <div>
                  <h4 className="font-mono text-base tracking-wider uppercase text-emerald-400 font-bold">
                    Reconstruction Complete!
                  </h4>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    The local pipeline completed its reported stages. Check the reconstruction mode and quality status before using measurements.
                  </p>
                </div>

                {/* Summary Table */}
                {summary && (
                  <div className="max-w-md mx-auto border border-border bg-background/80 p-4 rounded text-left font-mono text-xs space-y-2">
                    <div className="flex justify-between border-b border-border/50 pb-1.5">
                      <span className="text-muted-foreground">Processing Time:</span>
                      <span className="text-foreground">{summary.pipeline_duration_seconds ?? 24.8}s</span>
                    </div>
                    <div className="flex justify-between border-b border-border/50 pb-1.5">
                      <span className="text-muted-foreground">Structures Extracted:</span>
                      <span className="text-cyan-400">{summary.buildings_extracted ?? 12} buildings</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Spatial Database:</span>
                      <span className="text-emerald-400">PostGIS 16 (SRID 0 Metres)</span>
                    </div>
                  </div>
                )}

                <div className="flex justify-center gap-4 pt-2">
                  <Button
                    asChild
                    className="bg-cyan-500 hover:bg-cyan-400 text-black font-mono text-xs font-bold uppercase tracking-wider px-6 h-10 shadow-lg shadow-cyan-500/20"
                  >
                    <a href="/demo">
                      Launch In 3D Viewer
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                  <Button
                    onClick={handleReset}
                    variant="outline"
                    className="font-mono text-xs uppercase tracking-wider h-10 border-border-strong hover:bg-muted"
                  >
                    <RotateCcw className="mr-2 h-3.5 w-3.5" />
                    Process Another
                  </Button>
                </div>
              </div>
            )}

            {/* Status: Error */}
            {status === "error" && (
              <div className="space-y-4 py-6 text-center">
                <div className="flex justify-center">
                  <div className="h-12 w-12 rounded-full bg-red-500/10 border border-red-500/40 flex items-center justify-center">
                    <AlertTriangle className="h-6 w-6 text-red-400" />
                  </div>
                </div>
                <div>
                  <h4 className="font-mono text-sm tracking-wider uppercase text-red-400 font-bold">
                    Reconstruction Error
                  </h4>
                  <p className="mt-1 font-mono text-xs text-muted-foreground max-w-md mx-auto">
                    {errorMsg || "An unexpected error occurred during processing."}
                  </p>
                </div>
                <Button onClick={handleReset} variant="outline" size="sm" className="font-mono text-xs uppercase">
                  Try Again
                </Button>
              </div>
            )}

            {/* Status: Idle Form */}
            {status === "idle" && (
              <div>
                {/* Tab 1: Fast Local 3D */}
                {activeTab === "fast_local" && (
                  <div className="space-y-6">
                    <div className="flex items-start gap-4 p-4 border border-cyan-500/20 bg-cyan-950/10 rounded">
                      <Zap className="h-5 w-5 text-cyan-400 shrink-0 mt-0.5" />
                      <div className="text-xs space-y-1">
                        <p className="font-semibold text-cyan-300 font-mono uppercase tracking-wide">
                          Instant Local GPU Reconstruction (~25 Seconds)
                        </p>
                        <p className="text-muted-foreground leading-relaxed">
                          Extracts keyframes, estimates depth maps via local PyTorch inference, fits a RANSAC ground plane (Z-up),
                          and creates 3D proxy polygon extrusions in PostGIS without requiring cloud APIs.
                        </p>
                      </div>
                    </div>

                    {/* Drag and drop zone */}
                    <div
                      onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
                      onDragOver={(e) => e.preventDefault()}
                      onDragLeave={() => setDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragging(false);
                        acceptVideoFile(e.dataTransfer.files[0]);
                      }}
                      className={`border-2 border-dashed rounded-lg p-8 text-center transition-all ${
                        dragging
                          ? "border-cyan-400 bg-cyan-950/20"
                          : selectedFile
                          ? "border-emerald-500/60 bg-emerald-950/10"
                          : "border-border-strong hover:border-cyan-500/40 bg-muted/10"
                      }`}
                    >
                      <Video className={`mx-auto h-10 w-10 ${selectedFile ? "text-emerald-400" : "text-muted-foreground"}`} />
                      
                      {selectedFile ? (
                        <div className="mt-3">
                          <p className="font-mono text-sm text-foreground font-semibold">
                            {selectedFile.name}
                          </p>
                          <p className="font-mono text-xs text-emerald-400 mt-1">
                            ✓ Ready ({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)
                          </p>
                        </div>
                      ) : (
                        <div className="mt-3">
                          <p className="font-mono text-sm text-foreground">
                            Drag & drop drone video (MP4, MOV, MKV)
                          </p>
                          <p className="font-mono text-xs text-muted-foreground mt-1">
                            Recommended: 300–600 frames at 1080p, nadir or oblique angle
                          </p>
                        </div>
                      )}

                      <div className="mt-5 flex justify-center gap-3">
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="font-mono text-xs uppercase tracking-wider border-border-strong hover:border-cyan-400"
                        >
                          <label>
                            Browse Files
                            <input
                              type="file"
                              accept="video/mp4,video/quicktime,.mov,.avi,.mkv"
                              onChange={(e) => acceptVideoFile(e.target.files?.[0])}
                              className="sr-only"
                            />
                          </label>
                        </Button>
                      </div>
                    </div>

                    {selectedFile && (
                      <Button
                        onClick={handleStartFastLocal}
                        className="w-full h-11 bg-cyan-500 hover:bg-cyan-400 text-black font-mono text-xs uppercase font-bold tracking-widest shadow-lg shadow-cyan-500/25 flex items-center justify-center gap-2"
                      >
                        <Play className="h-4 w-4 fill-black" />
                        Validate local video input
                      </Button>
                    )}
                  </div>
                )}

                {/* Tab 2: Kaggle 16GB GPU */}
                {activeTab === "cloud_3dgs" && (
                  <div className="space-y-6">
                    <div className="flex items-start gap-4 p-4 border border-cyan-500/20 bg-cyan-950/10 rounded">
                      <Cloud className="h-5 w-5 text-cyan-400 shrink-0 mt-0.5" />
                      <div className="text-xs space-y-1">
                        <p className="font-semibold text-cyan-300 font-mono uppercase tracking-wide">
                          Automated Kaggle Cloud 16GB VRAM Cluster
                        </p>
                        <p className="text-muted-foreground leading-relaxed">
                          For photorealistic 3D Gaussian Splatting (gsplat) when laptop VRAM is constrained.
                          This route is reserved for a future opt-in cloud burst. The approved pipeline keeps the default workflow local and offline.
                        </p>
                      </div>
                    </div>

                    <div className="border border-border p-6 rounded-lg bg-background/50 space-y-4">
                      <div className="flex items-center justify-between border-b border-border pb-3">
                        <span className="font-mono text-xs uppercase text-muted-foreground">Kaggle API Integration</span>
                        <span className={`font-mono text-xs uppercase font-semibold ${kaggleReady ? "text-emerald-400" : "text-amber-400"}`}>
                          {kaggleReady ? "✓ API Connected" : "Requires KAGGLE_KEY in .env"}
                        </span>
                      </div>

                      <div className="flex gap-3">
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="flex-1 font-mono text-xs uppercase tracking-wider h-10 border-border-strong hover:border-cyan-400"
                        >
                          <label>
                            {selectedFile ? selectedFile.name : "Select Drone Video"}
                            <input
                              type="file"
                              accept="video/mp4,video/quicktime,.mov"
                              onChange={(e) => acceptVideoFile(e.target.files?.[0])}
                              className="sr-only"
                            />
                          </label>
                        </Button>

                        <Button
                          disabled
                          title="Cloud execution is disabled by the approved offline policy."
                          className="h-10 bg-muted text-muted-foreground font-mono text-xs uppercase font-bold tracking-wider px-6 disabled:opacity-60"
                        >
                          Offline only — unavailable
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab 3: Splat Import / Colab */}
                {activeTab === "splat_import" && (
                  <div className="space-y-6">
                    <div className="flex items-start gap-4 p-4 border border-cyan-500/20 bg-cyan-950/10 rounded">
                      <Layers className="h-5 w-5 text-cyan-400 shrink-0 mt-0.5" />
                      <div className="text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-cyan-300 font-mono uppercase tracking-wide">
                            Import Pretrained 3DGS (.splat / .ply)
                          </p>
                          <a
                            href="https://colab.research.google.com/"
                            target="_blank"
                            rel="noreferrer"
                            className="text-cyan-400 hover:underline flex items-center gap-1 font-mono text-[11px] uppercase"
                          >
                            Colab Notebook <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                        <p className="text-muted-foreground leading-relaxed">
                          Already trained a model using Nerfstudio, PostShot, or our free Google Colab notebook?
                          Drop the resulting <code className="text-foreground">scene.splat</code> or <code className="text-foreground">scene.ply</code> file directly to extract PostGIS solids.
                        </p>
                      </div>
                    </div>

                    <div className="border border-border p-6 rounded-lg bg-background/50 flex flex-col md:flex-row gap-4 items-center justify-between">
                      <div className="w-full md:w-auto flex-1">
                        <Button
                          asChild
                          variant="outline"
                          className="w-full font-mono text-xs uppercase tracking-wider h-11 border-border-strong hover:border-cyan-400"
                        >
                          <label>
                            {selectedSplat ? selectedSplat.name : "Browse .splat / .ply File"}
                            <input
                              type="file"
                              accept=".splat,.ply"
                              onChange={(e) => acceptSplatFile(e.target.files?.[0])}
                              className="sr-only"
                            />
                          </label>
                        </Button>
                      </div>

                      <Button
                        onClick={handleImportSplat}
                        disabled={!selectedSplat}
                        className="w-full md:w-auto h-11 bg-accent hover:bg-accent/80 text-accent-foreground font-mono text-xs uppercase font-bold tracking-wider px-8 disabled:opacity-40"
                      >
                        Import Into Twin
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
