import type {
  Mission,
  ProcessingJob,
  Project,
  Scene,
  SpatialEdit,
  SpatialObject,
  SpatialQuery,
} from "@/types/spatial";
import * as mockApi from "./mockApi";

export const API_BASE_URL =
  (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "";

export interface BackendStructure {
  id: number;
  project_id: number;
  class_name: string;
  footprint: any;
  height_m: number;
  area_m2: number;
  region: string | null;
  splat_bbox: {
    min_x: number;
    min_y: number;
    min_z: number;
    max_x: number;
    max_y: number;
    max_z: number;
  } | null;
  original_height_m: number | null;
  version: number;
}

export interface QueryMetrics {
  count: number;
  avg_height_m: number;
  total_area_m2: number;
  min_height_m: number;
  max_height_m: number;
}

export interface QueryResponse {
  status: string;
  query: string;
  matched_ids: number[];
  objects: BackendStructure[];
  metrics: QueryMetrics | null;
  intent: any | null;
  sql: string | null;
  message?: string;
  latency_ms: number;
}

export function transformStructureToSpatialObject(s: BackendStructure): SpatialObject {
  const bbox = s.splat_bbox;
  let width = 10;
  let depth = 10;
  let x = 0;
  let z = 0;
  let elevationM = 0;

  if (bbox) {
    width = Math.max(1, bbox.max_x - bbox.min_x);
    depth = Math.max(1, bbox.max_y - bbox.min_y);
    x = (bbox.min_x + bbox.max_x) / 2;
    z = (bbox.min_y + bbox.max_y) / 2;
    elevationM = bbox.min_z;
  }

  return {
    id: String(s.id),
    label: `Structure #${s.id}${s.region ? ` (${s.region.toUpperCase()})` : ""}`,
    layer: "buildings",
    x,
    z,
    width,
    depth,
    height: s.height_m,
    elevationM,
    areaM2: s.area_m2,
    region: s.region ?? undefined,
    footprint: s.footprint,
    splatBbox: bbox ?? undefined,
    originalHeightM: s.original_height_m ?? s.height_m,
    version: s.version,
  };
}

export const api = {
  getProject: (): Promise<Project> => mockApi.getProject(),
  getMissions: (): Promise<Mission[]> => mockApi.getMissions(),
  getPipeline: (): Promise<ProcessingJob[]> => mockApi.getPipeline(),
  getScene: (): Promise<Scene> => mockApi.getScene(),
  getQueries: (): Promise<SpatialQuery[]> => mockApi.getQueries(),
  getEdits: (): Promise<SpatialEdit[]> => mockApi.getEdits(),

  // Live Backend Endpoints with Dual-Layer Proxy/Direct Fallback
  fetchBackendStructures: async (): Promise<SpatialObject[]> => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/objects/structures`);
      if (!res.ok) throw new Error(`Failed to fetch structures: ${res.statusText}`);
      const data: BackendStructure[] = await res.json();
      return data.map(transformStructureToSpatialObject);
    } catch (err) {
      if (!API_BASE_URL) {
        const direct = await fetch("http://127.0.0.1:8000/api/objects/structures");
        if (direct.ok) {
          const data: BackendStructure[] = await direct.json();
          return data.map(transformStructureToSpatialObject);
        }
      }
      throw err;
    }
  },

  fetchBackendProject: async (): Promise<any> => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/objects/project`);
      if (!res.ok) throw new Error(`Failed to fetch project: ${res.statusText}`);
      return await res.json();
    } catch (err) {
      if (!API_BASE_URL) {
        const direct = await fetch("http://127.0.0.1:8000/api/objects/project");
        if (direct.ok) return await direct.json();
      }
      throw err;
    }
  },

  submitQuery: async (text: string): Promise<QueryResponse> => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`Query failed: ${res.statusText}`);
      return await res.json();
    } catch (err) {
      if (!API_BASE_URL) {
        const direct = await fetch("http://127.0.0.1:8000/api/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (direct.ok) return await direct.json();
      }
      throw err;
    }
  },

  uploadDroneVideo: async (file: File): Promise<{ job_id: string; status: string; message: string }> => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(`${API_BASE_URL}/api/pipeline/upload`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || "Video upload failed");
      }
      return await res.json();
    } catch (err: any) {
      if (!API_BASE_URL) {
        const direct = await fetch("http://127.0.0.1:8000/api/pipeline/upload", {
          method: "POST",
          body: formData,
        });
        if (direct.ok) return await direct.json();
        const directErr = await direct.json().catch(() => ({ detail: direct.statusText }));
        throw new Error(directErr.detail || "Video upload failed");
      }
      throw err;
    }
  },

  fetchPipelineStatus: async (): Promise<{
    job_id: string | null;
    status: "idle" | "processing" | "completed" | "error";
    step: string;
    progress: number;
    details: any;
    error: string | null;
  }> => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/pipeline/status`);
      if (!res.ok) throw new Error(`Status check failed: ${res.statusText}`);
      return await res.json();
    } catch (err) {
      if (!API_BASE_URL) {
        const direct = await fetch("http://127.0.0.1:8000/api/pipeline/status");
        if (direct.ok) return await direct.json();
      }
      throw err;
    }
  },

  getKaggleConfig: async (): Promise<{ configured: boolean; username: string }> => {
    const res = await fetch(`${API_BASE_URL}/api/pipeline/kaggle-config`);
    if (!res.ok) return { configured: false, username: "" };
    return await res.json();
  },

  uploadDroneVideoKaggle: async (file: File): Promise<{ job_id: string; status: string; message: string }> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${API_BASE_URL}/api/pipeline/upload-kaggle`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || "Kaggle upload failed");
    }
    return await res.json();
  },

  importTrainedSplat: async (file: File): Promise<{ status: string; message: string; buildings_extracted: number }> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${API_BASE_URL}/api/pipeline/import-splat`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || "Splat import failed");
    }
    return await res.json();
  },
};

export type Api = typeof api;
