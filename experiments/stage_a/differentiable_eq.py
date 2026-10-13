import torch
import torch.nn as nn
import torch.nn.functional as F
import math

ISO_BANDS = torch.tensor([
    20.0, 25.0, 31.5, 40.0, 50.0, 63.0, 80.0, 100.0, 125.0, 160.0,
    200.0, 250.0, 315.0, 400.0, 500.0, 630.0, 800.0, 1000.0, 1250.0, 1600.0,
    2000.0, 2500.0, 3150.0, 4000.0, 5000.0, 6300.0, 8000.0, 10000.0, 12500.0, 16000.0, 20000.0
])

class Differentiable31BandEQ(nn.Module):
    def __init__(self, sample_rate=44100, max_gain_db=6.0, min_gain_db=-12.0):
        super().__init__()
        self.sample_rate = sample_rate
        self.max_gain_db = max_gain_db
        self.min_gain_db = min_gain_db

    def forward(self, audio, gains_db):
        """
        Apply differentiable 31-band EQ using frequency-domain interpolation.
        audio: [batch, samples]
        gains_db: [batch, 31]
        """
        batch, samples = audio.shape
        # FFT
        spectrum = torch.fft.rfft(audio, dim=-1)
        freqs = torch.fft.rfftfreq(samples, 1.0 / self.sample_rate).to(audio.device)

        # Clamp gains to safe bounds
        safe_gains = torch.clamp(gains_db, self.min_gain_db, self.max_gain_db)
        band_freqs = ISO_BANDS.to(audio.device)

        # Log-frequency interpolation of gains
        log_freqs = torch.log(torch.clamp(freqs, min=1.0))
        log_bands = torch.log(band_freqs)
        # Use linear interpolation manually across bands
        interp_gains = []
        for i in range(batch):
            g = safe_gains[i]
            indices = torch.searchsorted(log_bands, log_freqs).clamp(1, len(log_bands)-1)
            left_idx = indices - 1
            right_idx = indices
            left_f = log_bands[left_idx]
            right_f = log_bands[right_idx]
            weight = (log_freqs - left_f) / (right_f - left_f + 1e-8)
            interpolated = g[left_idx] * (1 - weight) + g[right_idx] * weight
            # below/above external bands: extrapolate closest band
            interpolated = torch.where(freqs < band_freqs[0], g[0], interpolated)
            interpolated = torch.where(freqs > band_freqs[-1], g[-1], interpolated)
            interp_gains.append(interpolated)
        interp_gains = torch.stack(interp_gains)

        # Apply amplitude gains
        linear_gains = torch.pow(10.0, interp_gains / 20.0)
        result = torch.fft.irfft(spectrum * linear_gains, n=samples, dim=-1)
        return result
