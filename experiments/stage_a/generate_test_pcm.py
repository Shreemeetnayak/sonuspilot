import numpy as np
import json
import os

def generate_signals():
    fs = 44100
    duration = 2048 / fs # 1 FFT frame
    t = np.linspace(0, duration, 2048, endpoint=False)
    
    signals = {
        "silence": np.zeros(2048, dtype=np.float32),
        "sine_1k": 0.5 * np.sin(2 * np.pi * 1000 * t).astype(np.float32),
        "pink_noise": np.random.normal(0, 0.1, 2048).astype(np.float32), # Simplified
    }
    
    # Save for Rust test to read
    os.makedirs("experiments/stage_a/test_pcm", exist_ok=True)
    for name, data in signals.items():
        data.tofile(f"experiments/stage_a/test_pcm/{name}.raw")
        
    print("Signals generated.")

if __name__ == "__main__":
    generate_signals()
