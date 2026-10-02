export type LayerId =
  | "buildings"
  | "roads"
  | "terrain"
  | "vegetation"
  | "infrastructure";

export interface Layer {
  id: LayerId;
  label: string;
  count: number;
  enabled: boolean;
}

export interface Project {
  id: string;
  name: string;
  location: string;
  coordinates: { lat: number; lng: number };
  createdAt: string;
  missionIds: string[];
}

export interface Mission {
  id: string;
  projectId: string;
  label: string;
  durationSec: number;
  altitudeM: number;
  frames: number;
  capturedAt: string;
}

export type ProcessingStage =
  | "capture"
  | "reconstruction"
  | "semantics"
  | "intelligence";

export interface ProcessingJob {
  id: string;
  missionId: string;
  stage: ProcessingStage;
  progress: number;
  status: "queued" | "running" | "complete";
  metrics: { label: string; value: string }[];
}

export interface SpatialObject {
  id: string;
  label: string;
  layer: LayerId;
  /** grid position in scene units */
  x: number;
  z: number;
  width: number;
  depth: number;
  /** metres */
  height: number;
  elevationM: number;
  areaM2: number;
  region?: string | undefined;
  footprint?: any;
  splatBbox?: {
    min_x: number;
    min_y: number;
    min_z: number;
    max_x: number;
    max_y: number;
    max_z: number;
  } | undefined;
  originalHeightM?: number | undefined;
  version?: number | undefined;
}

export interface Scene {
  id: string;
  projectId: string;
  boundsM: [number, number];
  pointCount: number;
  objects: SpatialObject[];
  layers: Layer[];
}

export interface SpatialQuery {
  id: string;
  prompt: string;
  /** typed result headline, e.g. "07 BUILDINGS FOUND" */
  resultLabel: string;
  resultValue: string;
  matchedObjectIds: string[];
}

export interface SpatialEdit {
  id: string;
  command: string;
  targetObjectIds: string[];
  operation: "extrude" | "raise-terrain";
  deltaM: number;
  status: { objects: number; delta: string; state: string };
}

export interface EditPreviewDelta {
  object_id: number;
  current_height_m: number;
  new_height_m: number;
  delta_height_m: number;
  footprint?: any;
  splat_bbox?: {
    min_x: number;
    min_y: number;
    min_z: number;
    max_x: number;
    max_y: number;
    max_z: number;
  };
}

export interface GhostObject {
  id: string;
  originalHeight: number;
  newHeight: number;
  deltaHeight: number;
  elevationM: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  footprint?: any;
}
