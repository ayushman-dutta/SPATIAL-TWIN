"""
Spatial Twin: I/O Utilities for PLY and Web SPLAT Binary Assets (pipeline/common/io.py)

Beginner Analogy:
A precision packing crate:
It takes ~1.5 million 3D Gaussian splats and tightly packs each one into exactly 32 bytes
so that a web browser can stream and render the 3D scene effortlessly at 60 FPS,
while ensuring not a single splat shifts position or loses its class label.
"""

import os
import struct
import numpy as np
from pathlib import Path
from typing import Dict, Any, Tuple, Optional
from plyfile import PlyData, PlyElement

def load_ply(ply_path: str) -> Dict[str, np.ndarray]:
    """
    Loads 3D Gaussian Splats from a standard .ply file.
    Returns dictionary with:
      - positions: (N, 3) float32
      - scales: (N, 3) float32 (exponentiated or linear)
      - rotations: (N, 4) float32 normalized quaternions (w, x, y, z)
      - colors: (N, 4) uint8 RGBA
      - opacities: (N,) float32 in range [0, 1]
    """
    path = Path(ply_path)
    if not path.exists():
        raise FileNotFoundError(f"PLY file not found: {path}")

    plydata = PlyData.read(str(path))
    v = plydata["vertex"]
    
    positions = np.column_stack([v["x"], v["y"], v["z"]]).astype(np.float32)
    n = positions.shape[0]

    # Handle colors
    if "red" in v and "green" in v and "blue" in v:
        r = v["red"].astype(np.uint8)
        g = v["green"].astype(np.uint8)
        b = v["blue"].astype(np.uint8)
        a = v["alpha"].astype(np.uint8) if "alpha" in v else np.full(n, 255, dtype=np.uint8)
        colors = np.column_stack([r, g, b, a])
    elif "f_dc_0" in v:
        # Spherical harmonics DC component to RGB: RGB = 0.5 + 0.28209479177387814 * f_dc
        C0 = 0.28209479177387814
        r = np.clip((0.5 + C0 * v["f_dc_0"]) * 255, 0, 255).astype(np.uint8)
        g = np.clip((0.5 + C0 * v["f_dc_1"]) * 255, 0, 255).astype(np.uint8)
        b = np.clip((0.5 + C0 * v["f_dc_2"]) * 255, 0, 255).astype(np.uint8)
        colors = np.column_stack([r, g, b, np.full(n, 255, dtype=np.uint8)])
    else:
        colors = np.full((n, 4), 200, dtype=np.uint8)

    # Handle scales
    if "scale_0" in v:
        # Log scales -> exponentiate
        s0 = np.exp(v["scale_0"].astype(np.float32))
        s1 = np.exp(v["scale_1"].astype(np.float32))
        s2 = np.exp(v["scale_2"].astype(np.float32))
        scales = np.column_stack([s0, s1, s2])
    else:
        scales = np.full((n, 3), 0.05, dtype=np.float32)

    # Handle rotations (quaternions)
    if "rot_0" in v:
        r0 = v["rot_0"].astype(np.float32)
        r1 = v["rot_1"].astype(np.float32)
        r2 = v["rot_2"].astype(np.float32)
        r3 = v["rot_3"].astype(np.float32)
        rotations = np.column_stack([r0, r1, r2, r3])
        # Normalize
        norm = np.linalg.norm(rotations, axis=1, keepdims=True) + 1e-8
        rotations = rotations / norm
    else:
        rotations = np.zeros((n, 4), dtype=np.float32)
        rotations[:, 0] = 1.0  # Identity quaternion w=1

    # Handle opacity
    if "opacity" in v:
        opacities = 1.0 / (1.0 + np.exp(-v["opacity"].astype(np.float32)))
    else:
        opacities = np.ones(n, dtype=np.float32)

    return {
        "positions": positions,
        "scales": scales,
        "rotations": rotations,
        "colors": colors,
        "opacities": opacities
    }

def save_ply(filepath: str, 
             positions: np.ndarray, 
             colors: np.ndarray, 
             scales: Optional[np.ndarray] = None, 
             rotations: Optional[np.ndarray] = None, 
             opacities: Optional[np.ndarray] = None):
    """
    Saves a 3D Gaussian Splat point cloud to a standard .ply file.
    """
    n = positions.shape[0]
    dtype = [
        ('x', 'f4'), ('y', 'f4'), ('z', 'f4'),
        ('red', 'u1'), ('green', 'u1'), ('blue', 'u1'), ('alpha', 'u1'),
        ('scale_0', 'f4'), ('scale_1', 'f4'), ('scale_2', 'f4'),
        ('rot_0', 'f4'), ('rot_1', 'f4'), ('rot_2', 'f4'), ('rot_3', 'f4'),
        ('opacity', 'f4')
    ]
    v_data = np.empty(n, dtype=dtype)
    v_data['x'] = positions[:, 0].astype(np.float32)
    v_data['y'] = positions[:, 1].astype(np.float32)
    v_data['z'] = positions[:, 2].astype(np.float32)
    
    if colors.shape[1] == 3:
        colors = np.column_stack([colors, np.full(n, 255, dtype=np.uint8)])
    v_data['red'] = colors[:, 0].astype(np.uint8)
    v_data['green'] = colors[:, 1].astype(np.uint8)
    v_data['blue'] = colors[:, 2].astype(np.uint8)
    v_data['alpha'] = colors[:, 3].astype(np.uint8)
    
    if scales is None:
        scales = np.full((n, 3), 0.08, dtype=np.float32)
    v_data['scale_0'] = np.log(np.maximum(scales[:, 0], 1e-4)).astype(np.float32)
    v_data['scale_1'] = np.log(np.maximum(scales[:, 1], 1e-4)).astype(np.float32)
    v_data['scale_2'] = np.log(np.maximum(scales[:, 2], 1e-4)).astype(np.float32)
    
    if rotations is None:
        rotations = np.zeros((n, 4), dtype=np.float32)
        rotations[:, 0] = 1.0
    v_data['rot_0'] = rotations[:, 0].astype(np.float32)
    v_data['rot_1'] = rotations[:, 1].astype(np.float32)
    v_data['rot_2'] = rotations[:, 2].astype(np.float32)
    v_data['rot_3'] = rotations[:, 3].astype(np.float32)
    
    if opacities is None:
        opacities = np.full(n, 0.95, dtype=np.float32)
    clamped_op = np.clip(opacities, 0.01, 0.99)
    v_data['opacity'] = np.log(clamped_op / (1.0 - clamped_op)).astype(np.float32)
    
    el = PlyElement.describe(v_data, 'vertex')
    Path(filepath).parent.mkdir(parents=True, exist_ok=True)
    PlyData([el]).write(str(filepath))

def save_splat(positions: np.ndarray, 
               scales: np.ndarray, 
               rotations: np.ndarray, 
               colors: np.ndarray, 
               out_path: str):
    """
    Exports 3D Gaussian Splats into the standard web 32-byte .splat binary format.
    Format per splat (32 bytes):
      - position: 3 x float32 (12 bytes)
      - scale:    3 x float32 (12 bytes)
      - color:    4 x uint8 RGBA (4 bytes)
      - rotation: 4 x uint8 (4 bytes, quantized quaternion)
    """
    n = positions.shape[0]
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    
    # Quantize quaternions to uint8: q_u8 = np.clip((q * 128 + 128), 0, 255)
    rot_u8 = np.clip(rotations * 128.0 + 128.0, 0, 255).astype(np.uint8)
    
    # Ensure float32
    pos_f32 = positions.astype(np.float32)
    scale_f32 = scales.astype(np.float32)
    rgba_u8 = colors.astype(np.uint8)

    # Pack into buffer
    # Structured array for zero-copy fast writing
    dtype = np.dtype([
        ("pos", "<f4", (3,)),
        ("scale", "<f4", (3,)),
        ("color", "u1", (4,)),
        ("rot", "u1", (4,))
    ])
    
    buffer = np.empty(n, dtype=dtype)
    buffer["pos"] = pos_f32
    buffer["scale"] = scale_f32
    buffer["color"] = rgba_u8
    buffer["rot"] = rot_u8
    
    with open(out, "wb") as f:
        f.write(buffer.tobytes())

def save_classes(class_ids: np.ndarray, out_path: str):
    """
    Saves a 1-byte-per-splat class sidecar file (scene.classes.u8).
    Class IDs:
      0: Structure / Building
      1: Terrain / Ground
      2: Road
      3: Vegetation
      255: Unknown
    """
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    u8_data = class_ids.astype(np.uint8)
    with open(out, "wb") as f:
        f.write(u8_data.tobytes())

def load_classes(in_path: str) -> np.ndarray:
    """Loads a 1-byte-per-splat class sidecar file."""
    return np.fromfile(in_path, dtype=np.uint8)
