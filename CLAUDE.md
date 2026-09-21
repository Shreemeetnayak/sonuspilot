# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language Rule (CRITICAL)
- **ALWAYS** communicate, explain, and write all responses in **English** at all times.

## Project Overview

**SonusPilot** is a Windows desktop application that dynamically adapts audio EQ based on the currently playing music's genre/subgenre and the user's headphones/output device. Built with Tauri 2.x (Rust + React 19 + TypeScript).

**Current Phase:** Phase 1 — Foundation & Scaffolding (Tauri shell, React UI layout, Windows GSMTC stub)

## Commands

### Frontend (React/TypeScript)
```bash
cd desktop
npm run dev          # Start Vite dev server (port 1420)
npm run build        # Type-check + Vite build
npm run preview      # Preview production build
```

### Tauri (Rust)
```bash
cd desktop
npm run tauri dev    # Run Tauri dev (builds Rust, starts Vite)
npm run tauri build  # Build production app
cargo check          # Quick type-check (in desktop/src-tauri)
```

### Combined
```bash
# From project root
cd desktop && npm run tauri dev  # Full dev loop
```

## Architecture

### Directory Structure
```
SonusPilot/
├── desktop/                          # Tauri app
│   ├── src/                          # React 19 + TypeScript frontend
│   │   ├── components/
│   │   │   ├── NowPlaying.tsx        # Track info + subgenre chips
│   │   │   ├── DeviceSelector.tsx    # Output device + headphone mapping
│   │   │   ├── Equalizer31Band.tsx   # 31-band parametric EQ visualizer
│   │   │   └── StatusBar.tsx         # Cloud/EQ/device status
│   │   ├── App.tsx                   # Main app layout
│   │   └── main.tsx                  # React entry
│   ├── src-tauri/                    # Rust backend
│   │   ├── src/
│   │   │   ├── lib.rs                # App init, Tauri commands
│   │   │   ├── main.rs               # Entry point
│   │   │   └── services/
│   │   │       ├── mod.rs
│   │   │       ├── media_session.rs  # Windows GSMTC watcher (stub)
│   │   │       └── audio_device.rs   # WASAPI endpoint enum (stub)
│   │   ├── Cargo.toml
│   │   └── tauri.conf.json
│   ├── package.json
│   └── vite.config.ts
├── docs/
│   ├── ARCHITECTURE.md               # Full system design (read this)
│   └── CRITICAL_TECHNICAL_RISKS.md
└── .claude/                          # Project-specific Claude config
```

### Key Technologies
- **Frontend:** React 19, TypeScript, Vite 7
- **Backend:** Rust 2021, Tauri 2, Tokio, Windows crate (Win32 APIs)
- **Audio Engine:** Equalizer APO + Peace CLI (planned, Phase 2)
- **Metadata:** MusicBrainz, Last.fm, Discogs via cloud backend (Phase 3)

### Audio Processing Pipeline (Planned)
1. GSMTC provides `{title, artist, album}` from Windows media session
2. Cloud backend resolves to subgenre weights + Sound DNA
3. Blend subgenre reference EQs (31-band) with headphone compensation
4. 20ms equal-power crossfade between profiles
5. Push to Equalizer APO via Peace CLI or config file watch

## Development Notes

### Phase 1 (Current) — Mock Data Only
- `App.tsx` uses hardcoded `MOCK_TRACK`, `MOCK_DEVICE`, `MOCK_HEADPHONE`
- No real Tauri commands connected yet
- EQ modes: `auto` (cloud-driven), `manual`, `preset`, `neutral`

### Phase 2 — Audio Engine & Device Detection
- Implement `media_session.rs`: Windows GSMTC via `windows::Media::Control`
- Implement `audio_device.rs`: WASAPI `IMMDeviceEnumerator` for default endpoint
- Add Tauri commands for track events, device list, headphone mapping
- Integrate Equalizer APO / Peace CLI control

### Cloud Backend (Phase 3+)
- Separate repository/service (not in this workspace)
- PostgreSQL + Redis for profiles, Sound DNA vectors, song cache
- MusicBrainz/Last.fm/Discogs consensus engine

## Important Files to Know

| File | Purpose |
|------|---------|
| `docs/ARCHITECTURE.md` | Complete system design — read first |
| `desktop/src-tauri/Cargo.toml` | Rust dependencies (tauri, windows crate) |
| `desktop/src-tauri/tauri.conf.json` | Tauri config (devUrl: 1420) |
| `desktop/src/App.tsx` | Main layout, mock data, state |
| `desktop/src/components/Equalizer31Band.tsx` | 31-band ISO frequencies, presets, SVG curve |
| `desktop/src/components/NowPlaying.tsx` | Track display, subgenre chips |
| `desktop/src/components/DeviceSelector.tsx` | Output device + headphone mapping UI |

## TypeScript Conventions
- Strict mode enabled (`noUnusedLocals`, `noUnusedParameters`)
- Component props use explicit interfaces
- Inline SVG icons (no icon library deps)
- CSS modules per component (`ComponentName.css`)

## Rust Conventions
- `tauri::command` for frontend-callable functions
- `windows` crate for Win32/GSMTC/WASAPI
- Services in `src/services/` with `mod.rs` re-exports
- `anyhow` for error handling, `tracing` for logging

## Testing
No test infrastructure configured yet. When adding tests:
- Rust: `cargo test` in `src-tauri/`
- Frontend: Vitest (to be added)

## Debugging
- Rust logs: `tracing` output to console
- Frontend: Vite HMR + browser DevTools
- Tauri devtools: Ctrl+Shift+I in dev window

## Environment Variables
- `TAURI_DEV_HOST` — optional, for remote Vite dev server
- No `.env` files in repo; cloud API keys will be in backend (Phase 3)