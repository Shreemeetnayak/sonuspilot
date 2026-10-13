import numpy as np
import json, sys

# Constants matching Rust implementation
ISO_BANDS_HZ = np.array([
    20.0, 25.0, 31.5, 40.0, 50.0, 63.0, 80.0, 100.0, 125.0, 160.0,
    200.0, 250.0, 315.0, 400.0, 500.0, 630.0, 800.0, 1000.0, 1250.0, 1600.0,
    2000.0, 2500.0, 3150.0, 4000.0, 5000.0, 6300.0, 8000.0, 10000.0, 12500.0,
    16000.0, 20000.0,
], dtype=np.float32)

FFT_SIZE = 2048
SAMPLE_RATE = 44100.0

def hann_window():
    return (0.5 - 0.5 * np.cos(2.0 * np.pi * np.arange(FFT_SIZE) / FFT_SIZE)).astype(np.float32)

def extract_features(samples):
    # Ensure samples are padded to FFT_SIZE for this simple parity check
    if len(samples) < FFT_SIZE:
        padded = np.pad(samples, (0, FFT_SIZE - len(samples)), 'constant')
    else:
        padded = samples[:FFT_SIZE]
        
    window = hann_window()
    windowed = padded * window
    spectrum = np.abs(np.fft.rfft(windowed))**2 / FFT_SIZE
    
    rms = np.sqrt(np.mean(samples**2))
    peak = np.max(np.abs(samples))
    
    return {
        "rms": float(rms),
        "peak": float(peak)
    }

if __name__ == "__main__":
    # Read raw PCM bytes from file argument
    path = sys.argv[1]
    samples = np.fromfile(path, dtype=np.float32)
    print(json.dumps(extract_features(samples)))
