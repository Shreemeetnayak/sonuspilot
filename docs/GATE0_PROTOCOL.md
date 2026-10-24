# Gate 0: Audio Tap Position Measurement Protocol

## Overview

Gate 0 establishes whether the WASAPI loopback tap observes audio **before** or **after** Equalizer APO processing. This is critical because:

- **Pre-EQ tap**: Loopback sees unprocessed audio → Safe to implement adaptive analysis
- **Post-EQ tap**: Loopback sees already-processed audio → Adaptive analysis would measure its own output, causing potential oscillation

## Measurement Method

### Equipment
- Windows default render endpoint (speaker/headphone output)
- WASAPI SharedMode loopback capture
- Test signal generation (system audio output)

### Test Procedure

1. **Baseline Measurement**
   ```
   1. Start loopback capture on default render endpoint
   2. Play neutral audio (e.g., pink noise at -20 dBFS)
   3. Record peak amplitude: P_baseline
   ```

2. **Test Gain Application**
   ```
   1. Apply known preamp gain G_test (e.g., +6 dB)
   2. Wait for EQ to settle (100ms minimum)
   3. Play same neutral audio
   4. Record peak amplitude: P_test
   ```

3. **Analysis**
   ```
   actual_gain_db = 20 * log10(P_test / P_baseline)
   
   if actual_gain_db > threshold (e.g., +1.0 dB):
       result = PRE_EQ  // Loopback sees the gain change
   else:
       result = POST_EQ // Loopback does NOT see the gain change
   ```

4. **Confidence Calculation**
   ```
   confidence = min(1.0, (1.0 - |actual_gain_db - G_test| / G_test) * 0.7 + (SNR / 60) * 0.3)
   
   where SNR = 20 * log10(max(P_baseline, P_test)) - noise_floor_db
   ```

### Expected Outcomes

| Scenario | Loopback Sees | Tap Position | Adaptive EQ | Notes |
|----------|--------------|--------------|-------------|-------|
| Pre-EQ | Gain change | Before APO | ✓ Enabled | Analysis sees raw signal |
| Post-EQ | No gain change | After APO | ✗ Blocked | Would measure own output |

## Implementation Reference

The measurement is implemented in `src-tauri/src/services/audio_path.rs`:

- `run_measurement(controller, test_preamp_db)` - Execute the measurement protocol
- `diagnose(measurement, eq_available, eq_config_present)` - Build path report
- `loopback_capture_available()` - Check WASAPI loopback support

## Usage

### Via Tauri Command (TypeScript)
```typescript
import { invoke } from '@tauri-apps/api/tauri';

// Run the audio measurement
const result = await invoke('run_audio_test', {
  testPreampDb: 6.0,  // +6dB test gain
});
// result: { baseline_peak, test_peak, actual_gain_db, is_pre_eq, confidence }

// Get full audio path report
const report = await invoke('get_audio_path_report');
// report: { status, gate_0_result, tap_position, recommendation }
```

### Via Tauri Command (Rust)
```rust
// From Tauri command handler
#[tauri::command]
async fn run_audio_test(
    controller: tauri::State<'_, Arc<EqController>>,
    last: tauri::State<'_, LastMeasurement>,
    test_preamp_db: Option<f32>,
) -> Result<AudioPathReport, String> {
    let db = test_preamp_db.unwrap_or(6.0);
    let result = services::audio_path::run_measurement(&controller, db).await?;
    Ok(services::audio_path::diagnose(
        Some(&result),
        controller.status().available,
        controller.status().config_present,
    ).await)
}
```

## Safety Considerations

1. **Test Gain Limit**: Use ≤ +6 dB to avoid clipping or speaker damage
2. **Fallback Behavior**: If Gate 0 fails, fall back to metadata-only EQ
3. **Re-measurement**: Allow re-running if environment changes (new device, APO reconfiguration)

## Troubleshooting

| Symptom | Likely Cause | Solution |
|---------|-------------|----------|
| Always post-EQ | APO bound to different endpoint | Configure APO on active endpoint |
| No signal captured | Loopback not supported | Use exclusive mode fallback |
| Low confidence | Background noise too high | Run in quiet environment, increase test gain |
| Inconsistent results | Device power saving | Disable audio device power management |
