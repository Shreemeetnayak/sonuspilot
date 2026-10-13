# SonusPilot

Adaptive system-wide equalisation for Windows.

SonusPilot reads whatever Windows is playing through **Global System Media
Transport Controls (GSMTC)** — Spotify, a browser, or any other app that
registers a media session — resolves a reference curve for the music's genre,
applies headphone correction where a measurement profile exists, folds in your
stated preferences and past feedback, checks the result against headroom, and
writes the outcome to **Equalizer APO** as a 31-band graphic EQ.

Once installed, it keeps running: track changes are picked up on their own.

## Requirements

- Windows 10 1809 or newer (GSMTC and WASAPI)
- **[Equalizer APO](https://sourceforge.net/projects/equalizerapo/)** — this is
  what actually processes the audio. SonusPilot does not ship it and cannot
  process audio without it; when it is missing SonusPilot says so and runs in
  preview-only mode.
- A C++ redistributable, which Equalizer APO's installer handles.

## Install

Run the installer produced by `npm run tauri build`:

```
src-tauri/target/release/bundle/nsis/SonusPilot_0.2.0_x64-setup.exe
```

An MSI is produced alongside it in `src-tauri/target/release/bundle/msi/`.

## Develop

```bash
npm install
npm run tauri dev      # full app
npm run verify         # typecheck + unit tests
cargo test --manifest-path src-tauri/Cargo.toml   # backend tests
```

## How a decision is made

Every layer stays separate until the final clamp, so the 31 bands that reach
Equalizer APO can always be explained:

| Layer | Source | Weight |
|---|---|---|
| Headphone correction | A measurement profile you stored for the current output device | 0.8 measured, 0.4 estimated, 0 unknown |
| Music reference | Weighted genre mixture from track metadata | Profile confidence |
| User preference | The taste toggles in the EQ panel | 1.0 |
| Learned preference | Your past feedback for this headphone and genre | `min(samples / 20, 1)` |
| Safety | Clamp to the configured maximum, then a preamp of `-3 dB - maxBoost` | always applied |

A profile with no measurement is never corrected against — the layer reports
zero confidence rather than guessing at a headphone it knows nothing about.

## What the app does not do

- **It does not analyse the audio.** GSMTC reports the track's title, artist and
  album, not its samples. Genre detection works from metadata text, and every
  dimension it cannot infer is left out rather than invented.
- **It does not identify a headphone from the Windows device.** Windows knows
  the output endpoint, not what is plugged into it. You map an endpoint to a
  headphone once in Settings, and SonusPilot restores that mapping whenever the
  endpoint comes back.
- **It is not a trained model.** Feedback adjusts a bounded, rule-based
  correction per headphone and genre. A handful of ratings is a preference, not
  a model, and nothing here claims otherwise.

## Settings

Auto-EQ on/off (writing a real neutral curve when off), automatic track
detection, feedback capture, maximum correction, headphone profiles, the
output-device to headphone mapping, and clearing learned data. Every control
changes runtime behaviour — none of them are display-only.
