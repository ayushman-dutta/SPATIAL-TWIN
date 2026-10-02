import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/Navbar";
import { Applications } from "@/sections/Applications";
import { DigitalTwin } from "@/sections/DigitalTwin";
import { DroneReconstructionSection } from "@/sections/DroneReconstructionSection";
import { Editing } from "@/sections/Editing";
import { FinalCta } from "@/sections/FinalCta";
import { Hero } from "@/sections/Hero";
import { Pipeline } from "@/sections/Pipeline";
import { Reconstruction } from "@/sections/Reconstruction";
import { Semantic } from "@/sections/Semantic";
import { SpatialAI } from "@/sections/SpatialAI";
import { Technology } from "@/sections/Technology";

const TITLE = "Spatial Twin — AI-Powered 3D Spatial Intelligence";
const DESCRIPTION =
  "Turn one drone pass into an interactive 3D digital twin queryable and editable in natural language using 3D Gaussian Splatting and PostGIS.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="relative bg-background text-foreground min-h-screen">
      <Navbar />
      <Hero />
      <DroneReconstructionSection />
      <Pipeline />
      <Reconstruction />
      <Semantic />
      <SpatialAI />
      <Editing />
      <DigitalTwin />
      <Applications />
      <Technology />
      <FinalCta />
    </main>
  );
}
