# Shared Specification for Stage A AI EQ

## 31-Band Frequencies (ISO 266)
20.0, 25.0, 31.5, 40.0, 50.0, 63.0, 80.0, 100.0, 125.0, 160.0,
200.0, 250.0, 315.0, 400.0, 500.0, 630.0, 800.0, 1000.0, 1250.0, 1600.0,
2000.0, 2500.0, 3150.0, 4000.0, 5000.0, 6300.0, 8000.0, 10000.0, 12500.0, 16000.0, 20000.0 Hz

## Pipeline Parameters
- Sample Rate: 44100 Hz
- FFT Window: 2048 samples (Hann window)
- FFT Hop: 1024 samples
- Bandwidth Masking: Mask all bands above 18kHz for lossy codec handling
- Headroom: 6dB of preamp headroom reserved for neural residual

## Gain Semantics
- Production APO: dB gain per band (graphic)
- Simulator: dB gain per band (differentiable mapping)
- Preamp/Headroom: Linear gain reduction applied before/after EQ

## Clipping Assumptions
- APO: Hard clipping occurs at 0dB FS
- Simulator: Soft clipping/clamping applied at ±6dB gain limits
