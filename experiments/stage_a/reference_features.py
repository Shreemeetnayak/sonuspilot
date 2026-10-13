"""
Reference feature extractor — Python/NumPy implementation of the exact same
algorithm as src/services/features.rs, for cross-language parity testing.

All constants MUST match shared_spec.md and features.rs.
"""
import numpy as np
import json, sys, struct

ISO_BANDS_HZ = np.array([
    20.0, 25.0, 31.5, 40.0, 50.0, 63.0, 80.0, 100.0, 125.0, 160.0,
    200.0, 250.0, 315.0, 400.0, 500.0, 630.0, 800.0, 1000.0, 1250.0, 1600.0,
    2000.0, 2500.0, 3150.0, 4000.0, 5000.0, 6300.0, 8000.0, 10000.0, 12500.0,
    16000.0, 20000.0,
])

SAMPLE_RATE = 44100.0
FFT_SIZE = 2048
HOP_SIZE = 1024
ROLLOFF_FRACTION = 0.85

def hann_window():
    return 0.5 - 0.5 * np.cos(2.0 * np.pi * np.arange(FFT_SIZE) / FFT_SIZE)

def spectral_frames(samples):
    window = hann_window()
    if len(samples) < FFT_SIZE:
        padded = np.zeros(FFT_SIZE, dtype=np.float32)
        padded[:len(samples)] = samples
    else:
        padded = np.array(samples, dtype=np.float32)
    if len(padded) == FFT_SIZE:
        starts = [0]
    else:
        starts = list(range(0, len(padded) - FFT_SIZE + 1, HOP_SIZE))
    frames = []
    for s in starts:
        windowed = padded[s:s+FFT_SIZE] * window
        spectrum = np.fft.rfft(windowed)
        power = np.abs(spectrum)**2 / FFT_SIZE
        frames.append(power)
    return frames

def average_spectrum(frames):
    if not frames:
        return np.zeros(FFT_SIZE // 2 + 1)
    return np.mean(frames, axis=0)

def band_edges(idx):
    center = ISO_BANDS_HZ[idx]
    if idx == 0:
        lower = center / np.sqrt(2.0)
    else:
        lower = np.sqrt(ISO_BANDS_HZ[idx-1] * center)
    if idx + 1 == len(ISO_BANDS_HZ):
        upper = center * np.sqrt(2.0)
    else:
        upper = np.sqrt(center * ISO_BANDS_HZ[idx+1])
    return lower, upper

def band_energy(spectrum, lower_hz, upper_hz):
    bin_width = SAMPLE_RATE / FFT_SIZE
    total = 0.0
    for i, power in enumerate(spectrum):
        freq = i * bin_width
        if freq >= lower_hz and freq < upper_hz:
            total += power
    return total

def average_band_energies(frames):
    spectrum = average_spectrum(frames)
    energies = []
    for idx in range(len(ISO_BANDS_HZ)):
        lo, hi = band_edges(idx)
        energies.append(band_energy(spectrum, lo, hi))
    return np.array(energies)

def spectral_centroid(spectrum):
    bin_width = SAMPLE_RATE / FFT_SIZE
    total = np.sum(spectrum)
    if total == 0:
        return 0.0
    return float(np.sum(np.arange(len(spectrum)) * bin_width * spectrum) / total)

def spectral_rolloff(spectrum):
    total = np.sum(spectrum)
    if total == 0:
        return 0.0
    threshold = total * ROLLOFF_FRACTION
    bin_width = SAMPLE_RATE / FFT_SIZE
    cumulative = 0.0
    for i, power in enumerate(spectrum):
        cumulative += power
        if cumulative >= threshold:
            return float(i * bin_width)
    return float(SAMPLE_RATE / 2.0)

def spectral_flux(frames):
    if len(frames) < 2:
        return 0.0
    flux_sum = 0.0
    for i in range(1, len(frames)):
        diff = np.sqrt(frames[i]) - np.sqrt(frames[i-1])
        flux_sum += float(np.sum(np.maximum(diff, 0.0)))
    return flux_sum / (len(frames) - 1)

def transient_density(frames):
    if len(frames) < 2:
        return 0.0
    frame_energy = [float(np.sum(f)) for f in frames]
    avg = np.mean(frame_energy)
    threshold = avg * 1.5
    count = 0
    for i in range(1, len(frame_energy)):
        if frame_energy[i] > threshold and frame_energy[i-1] <= threshold:
            count += 1
    return count / (len(frame_energy) - 1)

def summed_band_energy(band_energies, lower_hz, upper_hz):
    total = 0.0
    for freq, energy in zip(ISO_BANDS_HZ, band_energies):
        if freq >= lower_hz and freq < upper_hz:
            total += energy
    return total

def extract(samples):
    samples = np.array(samples, dtype=np.float32)
    rms = float(np.sqrt(np.mean(samples**2))) if len(samples) > 0 else 0.0
    peak = float(np.max(np.abs(samples))) if len(samples) > 0 else 0.0
    crest = peak / rms if rms > 0 else 0.0
    frames = spectral_frames(samples)
    bands = average_band_energies(frames)
    total_be = float(np.sum(bands))
    band_ratios = (bands / total_be).tolist() if total_be > 0 else [0.0]*31
    spectrum = average_spectrum(frames)
    centroid = spectral_centroid(spectrum)
    rolloff = spectral_rolloff(spectrum)
    flux = spectral_flux(frames)
    tdensity = transient_density(frames)
    ebw = rolloff
    low = summed_band_energy(bands, 20.0, 250.0)
    mid = summed_band_energy(bands, 250.0, 4000.0)
    high = summed_band_energy(bands, 4000.0, ebw)
    return {
        "rms": rms, "peak": peak, "crest_factor": crest,
        "spectral_bands": bands.tolist(), "band_ratios": band_ratios,
        "spectral_centroid_hz": centroid, "spectral_rolloff_hz": rolloff,
        "spectral_flux": flux, "transient_density": tdensity,
        "low_energy": low, "mid_energy": mid, "high_energy": high,
        "effective_bandwidth_hz": ebw
    }

def generate_sine(freq, amplitude, n_samples):
    t = np.arange(n_samples, dtype=np.float32) / SAMPLE_RATE
    return (amplitude * np.sin(2.0 * np.pi * freq * t)).tolist()

def generate_silence(n_samples):
    return [0.0] * n_samples

def generate_impulse(n_samples, pos):
    s = [0.0] * n_samples
    s[pos] = 1.0
    return s

def generate_broadband_noise(n_samples, amplitude, seed):
    rng = np.random.RandomState(seed)
    return (amplitude * (rng.rand(n_samples).astype(np.float32) * 2.0 - 1.0)).tolist()

if __name__ == "__main__":
    signals = {
        "silence":          generate_silence(FFT_SIZE),
        "sine_100hz_0.1":   generate_sine(100.0, 0.1, FFT_SIZE * 4),
        "sine_100hz_0.5":   generate_sine(100.0, 0.5, FFT_SIZE * 4),
        "sine_1khz_0.1":    generate_sine(1000.0, 0.1, FFT_SIZE * 4),
        "sine_1khz_0.5":    generate_sine(1000.0, 0.5, FFT_SIZE * 4),
        "sine_10khz_0.1":   generate_sine(10000.0, 0.1, FFT_SIZE * 4),
        "sine_10khz_0.5":   generate_sine(10000.0, 0.5, FFT_SIZE * 4),
        "noise_0.1":        generate_broadband_noise(FFT_SIZE * 4, 0.1, 42),
        "noise_0.5":        generate_broadband_noise(FFT_SIZE * 4, 0.5, 42),
        "impulse":          generate_impulse(FFT_SIZE * 3, FFT_SIZE),
    }
    results = {}
    for name, pcm in signals.items():
        results[name] = {"pcm": pcm, "features": extract(pcm)}
    with open("parity_reference.json", "w") as f:
        json.dump(results, f)
    print(f"Wrote parity_reference.json with {len(results)} signals")

def summed_band_energy(band_energies, lower_hz, upper_hz):
    total = 0.0
    for idx, center in enumerate(ISO_BANDS_HZ):
        if center >= lower_hz and center <= upper_hz:
            total += band_energies[idx]
    return float(total)

class FeatureExtractor:
    @staticmethod
    def extract(samples):
        rms = np.sqrt(np.mean(np.square(samples)))
        peak = np.max(np.abs(samples))
        crest = float(peak / rms) if rms > 0 else 0.0
        
        frames = spectral_frames(samples)
        band_energies = average_band_energies(frames)
        
        total_energy = np.sum(band_energies)
        band_ratios = (band_energies / total_energy).tolist() if total_energy > 0 else [0.0] * len(ISO_BANDS_HZ)
        
        spectrum = average_spectrum(frames)
        centroid = spectral_centroid(spectrum)
        rolloff = spectral_rolloff(spectrum)
        flux = spectral_flux(frames)
        density = transient_density(frames)
        
        return {
            "rms": float(rms),
            "peak": float(peak),
            "crest_factor": crest,
            "spectral_bands": band_energies.tolist(),
            "band_ratios": band_ratios,
            "spectral_centroid_hz": centroid,
            "spectral_rolloff_hz": rolloff,
            "spectral_flux": flux,
            "transient_density": density,
            "low_energy": summed_band_energy(band_energies, 20.0, 250.0),
            "mid_energy": summed_band_energy(band_energies, 250.0, 4000.0),
            "high_energy": summed_band_energy(band_energies, 4000.0, 20000.0),
            "effective_bandwidth_hz": 20000.0
        }

class FeatureExtractor:
    @staticmethod
    def extract(samples):
        # Implementation mirroring the Rust one
        rms = np.sqrt(np.mean(samples**2))
        peak = np.max(np.abs(samples))
        crest = peak / rms if rms > 0 else 0.0
        frames = spectral_frames(samples)
        energies = average_band_energies(frames)
        return {
            "rms": float(rms),
            "peak": float(peak),
            "crest_factor": float(crest),
            "spectral_bands": energies.tolist(),
            "spectral_centroid_hz": float(spectral_centroid(average_spectrum(frames)))
        }

if __name__ == "__main__":
    import json
    data = json.load(sys.stdin)
    samples = np.array(data["samples"], dtype=np.float32)
    print(json.dumps(FeatureExtractor.extract(samples)))
