# SonusPilot ML Foundation Specification

## 1. Feature Representation Contract
- **FFT Size**: 2048
- **Hop Size**: 1024
- **Sample Rate**: 44,100 Hz
- **Bands**: 31 (ISO 266 center frequencies)
- **Features**:
  - `rms`: f32
  - `peak`: f32
  - `crest_factor`: f32
  - `spectral_bands`: Vec<f32> (31 elements)
  - `band_ratios`: Vec<f32> (31 elements)
  - `spectral_centroid_hz`: f32
  - `spectral_rolloff_hz`: f32
  - `spectral_flux`: f32
  - `transient_density`: f32
  - `low_energy`: f32
  - `mid_energy`: f32
  - `high_energy`: f32
  - `effective_bandwidth_hz`: f32

## 2. Model Input/Output Schema
- **Input**: `SongAudioFeatures` + `headphone_id` (String) + `confidence` (f32)
- **Output**: `residual_gains` ([f32; 31]) + `confidence` (f32)

## 3. Data Integrity Invariants
- **Normalization**: Standardized per-band before inference.
- **Normalization Strategy**: TBD (to be finalized during Stage 2).
- **Missing Value Handling**: Rejected during pipeline processing, not imputed.
