import { motion, useMotionValueEvent, useScroll } from "motion/react";
import { useState } from "react";
import { Box } from "lucide-react";

const LINKS = [
  { label: "Reconstruct", href: "#reconstruct" },
  { label: "Platform", href: "#platform" },
  { label: "Spatial AI", href: "#spatial-ai" },
  { label: "Technology", href: "#technology" },
  { label: "Applications", href: "#applications" },
];

export function Navbar() {
  const { scrollY } = useScroll();
  const [solid, setSolid] = useState(false);
  useMotionValueEvent(scrollY, "change", (v) => setSolid(v > 60));

  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-500 ${
        solid
          ? "border-b border-border bg-background/85 backdrop-blur-md shadow-lg"
          : "border-b border-transparent bg-background/40 backdrop-blur-sm"
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-6 lg:px-10">
        <a href="#top" className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded border border-cyan-500/50 bg-cyan-950/40">
            <Box className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-base tracking-[0.2em] text-foreground uppercase font-bold">
              Spatial Twin
            </span>
            <span className="font-mono text-[9px] text-cyan-400 tracking-widest uppercase hidden sm:inline">
              v2.4
            </span>
          </div>
        </a>

        <div className="hidden items-center gap-2 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="border border-border/80 px-3 py-1.5 font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase transition-all hover:border-cyan-500/60 hover:text-cyan-300 hover:bg-cyan-950/20"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <a
            href="/demo"
            className="flex items-center gap-2 border border-cyan-500 bg-cyan-500/10 px-4 py-2 font-mono text-[10px] tracking-[0.16em] text-cyan-400 uppercase transition-all hover:bg-cyan-500 hover:text-black font-semibold shadow-[0_0_15px_rgba(6,182,212,0.2)]"
          >
            Launch 3D Twin
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
          </a>
        </div>
      </nav>
    </motion.header>
  );
}
