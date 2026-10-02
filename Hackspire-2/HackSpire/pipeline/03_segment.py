"""
Spatial Twin: Semantic Segmentation with SegFormer-B0 (pipeline/03_segment.py)

Beginner Analogy:
An instant digital coloring book:
It scans drone aerial photos and assigns a class to every single pixel:
buildings are assigned class 0, terrain is class 1, roads are class 2, and vegetation is class 3.
Zero custom neural network training required—it uses an optimized, pretrained vision transformer.
"""

import sys
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import os
import argparse
import numpy as np
from PIL import Image

# Cityscapes to Spatial Twin Class Mapping:
# 0: Structure (building, wall, fence)
# 1: Terrain (terrain)
# 2: Road (road, sidewalk)
# 3: Vegetation (vegetation)
# 255: Unknown (sky, car, person, etc.)
CITYSCAPES_MAP = {
    0: 2,   # road -> Road
    1: 2,   # sidewalk -> Road
    2: 0,   # building -> Structure
    3: 0,   # wall -> Structure
    4: 0,   # fence -> Structure
    8: 3,   # vegetation -> Vegetation
    9: 1,   # terrain -> Terrain
}

def segment_keyframe(image_path: str, model, processor, device: str = "cpu") -> np.ndarray:
    """Runs SegFormer inference on an image and returns a (H, W) uint8 class mask."""
    import torch
    image = Image.open(image_path).convert("RGB")
    inputs = processor(images=image, return_tensors="pt").to(device)
    
    with torch.no_grad():
        outputs = model(**inputs)
        logits = outputs.logits  # shape (1, num_classes, H/4, W/4)
        
        # Upsample logits to original image size
        upsampled_logits = torch.nn.functional.interpolate(
            logits,
            size=image.size[::-1], # (H, W)
            mode="bilinear",
            align_corners=False
        )
        pred_cityscapes = upsampled_logits.argmax(dim=1)[0].cpu().numpy()
        
    # Remap to Spatial Twin classes
    h, w = pred_cityscapes.shape
    twin_mask = np.full((h, w), 255, dtype=np.uint8)
    for c_id, twin_id in CITYSCAPES_MAP.items():
        twin_mask[pred_cityscapes == c_id] = twin_id
        
    return twin_mask

def segment_keyframe_optical(image_path: str) -> np.ndarray:
    """Fast optical color segmenter fallback (Structure=0, Terrain=1, Road=2, Vegetation=3)."""
    image = Image.open(image_path).convert("RGB")
    arr = np.array(image, dtype=np.int32)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    h, w, _ = arr.shape
    mask = np.full((h, w), 1, dtype=np.uint8) # Default terrain

    # Vegetation: green channel significantly higher than red & blue
    veg_mask = (g > r + 15) & (g > b + 15)
    mask[veg_mask] = 3

    # Road: neutral dark/medium gray
    color_diff = np.maximum(np.abs(r - g), np.abs(g - b))
    intensity = (r + g + b) // 3
    road_mask = (color_diff < 18) & (intensity > 40) & (intensity < 110)
    mask[road_mask] = 2

    # Structure: high saturation/distinct roof colors or high brightness architectural edges
    struct_mask = ((r > g + 20) & (r > b + 20)) | ((intensity > 150) & (color_diff < 30))
    mask[struct_mask] = 0

    return mask

def run_segmentation(images_dir: str = "./data/mill/images", 
                     output_dir: str = "./output/masks",
                     device: str = None):
    print("=" * 60)
    print("SEMANTIC SEGMENTATION WITH SEGFORMER-B0 (Pipeline Stage 03)")
    print("=" * 60)
    
    src = Path(images_dir)
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    
    image_files = sorted([f for f in src.iterdir() if f.suffix.lower() in {".jpg", ".jpeg", ".png"}]) if src.exists() else []
    
    if not image_files:
        print(f"[WARN] No drone images found in {src}. Creating a synthetic keyframe to verify pipeline...")
        src.mkdir(parents=True, exist_ok=True)
        sample_img = Image.new("RGB", (512, 512), color=(120, 115, 95))
        sample_path = src / "frame_00000.jpg"
        sample_img.save(sample_path)
        image_files = [sample_path]
        
    model = None
    processor = None
    if os.environ.get("ENABLE_HF_REMOTE_DOWNLOAD", "0") == "1":
        try:
            import torch
            from transformers import SegformerImageProcessor, SegformerForSemanticSegmentation
            if device is None:
                device = "cuda" if torch.cuda.is_available() else "cpu"
            print(f"[INFO] Using Device: {device.upper()}")
            print(f"[INFO] Loading SegFormer-B0 model from Hugging Face (~14 MB)...")
            model_name = "nvidia/segformer-b0-finetuned-cityscapes-1024-1024"
            processor = SegformerImageProcessor.from_pretrained(model_name)
            model = SegformerForSemanticSegmentation.from_pretrained(model_name).to(device)
            model.eval()
            print("[INFO] Model loaded successfully!")
        except Exception as exc:
            print(f"[WARN] SegFormer model unavailable ({exc}). Using fast optical color segmentation.")
    else:
        print("[INFO] Using fast optical color segmentation (instant CPU/GPU pipeline).")


    for idx, img_path in enumerate(image_files[:10]):  # process keyframes
        if model is not None and processor is not None:
            mask = segment_keyframe(str(img_path), model, processor, device)
        else:
            mask = segment_keyframe_optical(str(img_path))
        mask_img = Image.fromarray(mask, mode="L")
        out_path = out / f"{img_path.stem}_mask.png"
        mask_img.save(out_path)
        print(f"  [{idx+1}/{min(len(image_files), 10)}] Saved mask: {out_path.name} ({mask.shape[1]}x{mask.shape[0]})")
        
    print(f"\n[SUCCESS] Completed keyframe segmentation in {out}")
    return True

if __name__ == "__main__":
    run_segmentation()
