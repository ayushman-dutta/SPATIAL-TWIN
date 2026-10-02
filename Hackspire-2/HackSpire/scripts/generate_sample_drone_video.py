"""
Generates a realistic synthetic drone video for testing video ingestion and 3D reconstruction.
"""
import math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
import av

def create_sample_drone_video(output_path: str = "./data/mill19_sample_flight.mp4", duration_sec: int = 5, fps: int = 30):
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    
    width, height = 640, 480
    total_frames = duration_sec * fps
    
    container = av.open(str(out), mode="w")
    stream = container.add_stream("h264", rate=fps)
    stream.width = width
    stream.height = height
    stream.pix_fmt = "yuv420p"
    
    print(f"[SAMPLE VIDEO] Generating {total_frames} frames ({duration_sec}s @ {fps}fps) -> {out}...")
    
    for frame_idx in range(total_frames):
        t = frame_idx / total_frames
        angle = t * math.pi * 0.8 # Orbit flight path
        
        # Base terrain (warm earthy industrial ground)
        img = Image.new("RGB", (width, height), color=(118, 114, 98))
        draw = ImageDraw.Draw(img)
        
        # Paved road network
        road_w = 40
        draw.rectangle([width * 0.48 - road_w/2, 0, width * 0.48 + road_w/2, height], fill=(68, 68, 72))
        draw.rectangle([0, height * 0.52 - road_w/2, width, height * 0.52 + road_w/2], fill=(68, 68, 72))
        
        # Several distinct industrial structures with perspective shifts
        dx = math.sin(angle) * 35
        dy = math.cos(angle) * 20
        
        # Building 1 (Main Mill Plant - Brick Red)
        b1_x1, b1_y1 = int(120 + dx), int(110 + dy)
        draw.rectangle([b1_x1, b1_y1, b1_x1 + 140, b1_y1 + 110], fill=(168, 76, 58), outline=(130, 50, 40), width=2)
        # Roof detail
        draw.rectangle([b1_x1 + 15, b1_y1 + 15, b1_x1 + 125, b1_y1 + 95], fill=(145, 65, 50))
        
        # Building 2 (Blast Furnace Tower - Metallic Slate)
        b2_x1, b2_y1 = int(360 - dx), int(90 - dy)
        draw.rectangle([b2_x1, b2_y1, b2_x1 + 160, b2_y1 + 140], fill=(180, 165, 145), outline=(120, 110, 95), width=2)
        draw.rectangle([b2_x1 + 25, b2_y1 + 25, b2_x1 + 75, b2_y1 + 115], fill=(200, 185, 165))
        
        # Building 3 (Cooling Warehouse - Industrial Blue)
        b3_x1, b3_y1 = int(140 - dx*0.7), int(310 - dy*0.8)
        draw.rectangle([b3_x1, b3_y1, b3_x1 + 130, b3_y1 + 100], fill=(85, 118, 158), outline=(60, 85, 120), width=2)
        
        # Building 4 (Smelter - Dark Steel)
        b4_x1, b4_y1 = int(380 + dx*0.5), int(320 + dy*0.6)
        draw.rectangle([b4_x1, b4_y1, b4_x1 + 150, b4_y1 + 95], fill=(138, 112, 84), outline=(95, 75, 55), width=2)
        
        # Surrounding vegetation clusters
        draw.ellipse([30 + dx*0.3, 40, 85 + dx*0.3, 95], fill=(42, 118, 45))
        draw.ellipse([540 - dx*0.4, 400, 600 - dx*0.4, 460], fill=(38, 105, 40))
        draw.ellipse([50, 410, 110, 465], fill=(46, 125, 48))
        
        frame = av.VideoFrame.from_image(img)
        for packet in stream.encode(frame):
            container.mux(packet)
            
    # Flush stream
    for packet in stream.encode():
        container.mux(packet)
        
    container.close()
    print(f"[SUCCESS] Sample drone flight generated: {out} ({out.stat().st_size:,} bytes)")
    return out

if __name__ == "__main__":
    create_sample_drone_video()
