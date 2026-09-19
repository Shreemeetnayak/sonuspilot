# SonusPilot — System Architecture & Engineering Design

**Version:** 1.0.0  
**Status:** Architecture Design Phase (Pre-Implementation)  
**Target Platform:** Windows 11 (Primary), Tauri 2.x (Rust + React/TypeScript)

---

## 1. Executive Summary & Core Philosophy

**SonusPilot** is a Windows desktop application that dynamically adapts the user's audio EQ according to the music currently playing, the music's genre/subgenre characteristics, and the user's selected headphones/output device.

### The Core Philosophy
> *"Let users experience each genre and subgenre in the way that best represents its characteristic sound."*

* **Not a loudness maximizer:** The goal is not to make every song sound louder or artificially bass-heavy.
* **Sound DNA Preservation:** Compensates for headphone coloration while preserving the characteristic sonic identity of different musical styles (e.g., Dream Pop's airy treble, EDM's sub-bass impact, Thrash Metal's tight attack).
* **No Song-Specific EQs:** We do not map 1-to-1 songs to unique EQ files. Instead, we map songs to **Sound DNA vectors** and **subgenre mixture ratios**, blending reference EQ profiles mathematically.

---

## 2. High-Level System Architecture

SonusPilot uses a **Cloud-First Hybrid Architecture**. The desktop application remains lightweight, low-footprint, and fast, while heavy metadata resolution, tag normalization, genre consensus calculation, and profile storage live in a managed cloud backend.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        WINDOWS 11 DESKTOP (Tauri)                      │
│                                                                        │
│  ┌──────────────────────┐     ┌─────────────────────────────────────┐  │
│  │   Windows GSMTC      │     │       Audio Engine (Equalizer APO)  │  │
│  │   (Media Session)    │     │       31-Band Parametric/Graphic    │  │
│  └──────────┬───────────┘     └─────────────────▲───────────────────┘  │
│             │                                   │                      │
│             ▼                                   │                      │
│  ┌──────────────────────┐     ┌─────────────────┴───────────────────┐  │
│  │  Rust Core Daemon    │────►│   State Manager & Blending Engine   │  │
│  │  (Event Polling)     │     │   (Equal-Power Crossfade, 20ms)     │  │
│  └──────────┬───────────┘     └─────────────────────────────────────┘  │
│             │                                                          │
│             ▼ REST / WebSocket                                         │
└─────────────┼──────────────────────────────────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          CLOUD BACKEND                                 │
│                                                                        │
│  ┌────────────────┐  ┌──────────────────┐  ┌────────────────────────┐  │
│  │  API Gateway   │  │ Metadata Resolver│  │ Tag Normalization &    │  │
│  │  & Rate Limit  │  │ (MusicBrainz/    │  │ Consensus Engine       │  │
│  └───────┬────────┘  │  Last.fm/Discogs)│  └───────────┬────────────┘  │
│          │           └────────┬─────────┘              │               │
│          │                    │                        │               │
│          ▼                    ▼                        ▼               │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │                      Modular Core DB                         │      │
│  │        (PostgreSQL + Redis Cache: Profiles, Sound DNA)       │      │
│  └──────────────────────────────────────────────────────────────┘      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Desktop Architecture (Tauri / Rust / React)

### Directory Structure
```
desktop/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs                 # Tauri entry point
│   │   ├── lib.rs                  # App initialization & plugin setup
│   │   ├── services/
│   │   │   │── mod.rs
│   │   │   ├── media_session.rs    # Windows GSMTC session watcher
│   │   │   ├── audio_device.rs     # WASAPI output device enumeration
│   │   │   ├── eq_controller.rs    # Equalizer APO / Peace CLI bridge
│   │   │   └── api_client.rs       # Backend communication layer
│   │   └── state.rs                # Shared application state (Arc<Mutex<>> )
│   └── Cargo.toml
├── src/                            # React 19 + TypeScript Frontend
│   ├── components/
│   │   │── Equalizer31Band.tsx     # Interactive 31-band visualizer & sliders
│   │   │── DeviceSelector.tsx      # Output device & headphone mapper
│   │   │── NowPlayingCard.tsx      # Current song, artist, subgenre display
│   │   └── StatusIndicator.tsx     # Connection & cloud health status
│   ├── App.tsx
│   └── main.tsx
└── package.json
```

---

## 4. Audio Processing Architecture

### The Engine Selection: Equalizer APO + Peace CLI
For the MVP and production prototype, SonusPilot integrates with **Equalizer APO** and its command-line companion **Peace**.

* **Why Equalizer APO?** It hooks into the Windows audio engine (`audiodg.exe`) via official Audio Processing Objects (APOs). It provides true system-wide 31-band EQ across Spotify, web browsers, media players, and games. It requires no custom kernel driver signing and introduces negligible CPU/memory overhead.
* **Programmatic Control:** The Rust backend controls Equalizer APO by writing parametric filter configurations (`.txt`) and invoking Peace CLI commands (e.g., `peace --profile "SonusPilot_Active"`) or updating the configuration file monitored in real time by Equalizer APO.

### Artifact-Free Profile Switching (20ms Equal-Power Crossfade)
Switching EQ presets instantly can cause digital clicks/pops due to filter coefficient and state discontinuities. SonusPilot implements a **parallel crossfade strategy**:
1. When a song changes, the backend calculates the target 31-band biquad parameters.
2. Instead of an instant hard cut, a **20ms equal-power crossfade** is applied between the outgoing filter state and incoming filter state using raised-cosine weights.
3. This is perceptually transparent (proven in audio research to eliminate clicks in 94%+ of profile transitions) without interrupting the underlying audio stream.

---

## 5. GSMTC Integration Architecture

Windows **Global System Media Transport Controls (GSMTC)** extracts real-time playback metadata without needing direct API integrations with Spotify, Apple Music, or browsers.

### What GSMTC Provides & Limits
* **Provided:** `Title`, `Artist`, `AlbumTitle`, `Thumbnail` (artwork stream), playback status (Playing, Paused, Stopped), timeline position.
* **Not Provided:** Spotify Track IDs, MusicBrainz IDs, or genre tags.
* **Supported Sources:** Spotify Desktop App, Windows Media Player, Apple Music, and modern web browsers (Chrome/Edge/Firefox playing YouTube Music, SoundCloud, or Spotify Web Player).

### Rust Implementation Pattern (`media_session.rs`)
```rust
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSession,
};

pub async fn watch_media_sessions() -> Result<(), windows::core::Error> {
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.await?;
    let session = manager.GetCurrentSession()?;
    let props = session.TryGetMediaPropertiesAsync()?.await?;
    
    let title = props.Title()?;
    let artist = props.Artist()?;
    let album = props.AlbumTitle()?;
    
    // Dispatch normalized metadata to backend resolver
    Ok(())
}
```

---

## 6. Output-Device Detection & Headphone Mapping

Windows identifies physical audio hardware endpoints (e.g., "Realtek USB Audio", "Apple USB-C Headphone Jack") via WASAPI (`IMMDeviceEnumerator`), but it **cannot** automatically know which physical headphone or IEM is plugged into an analog jack.

### The Headphone Mapping Workflow
1. **Device Detection:** Rust enumerates the default audio render endpoint using WASAPI.
2. **Lookup Local Cache:** Check local SQLite/JSON storage for an existing mapping: `OutputDeviceID ──► HeadphoneModelID`.
3. **Unmapped Device:** If unknown, trigger a toast notification or UI modal: *"New audio output detected (Apple USB-C DAC). Please select your connected headphone/IEM."*
4. **Persistence:** Once selected, store the mapping locally so future connections auto-load the correct headphone compensation profile.

---

## 7. Metadata Acquisition & Consensus Pipeline

When a song plays, the desktop app sends `{ title, artist, album }` to the SonusPilot cloud backend.

```
Desktop Track Event
      │
      ▼
┌──────────────┐
│  Redis Cache │ ──(Hit)──► Return Sound DNA & EQ
└──────┬───────┘
   (Miss)
      │
      ▼
┌──────────────────────────────────────────────┐
│             Metadata Resolver                │
│  ┌────────────────┐    ┌──────────────────┐  │
│  │  MusicBrainz   │    │     Last.fm      │  │
│  │ (ID & Genres)  │    │ (Folksonomy Tags)│  │
│  └───────┬────────┘    └────────┬─────────┘  │
│          │                      │            │
│          └──────────┬───────────┘            │
│                     ▼                        │
│         ┌───────────────────────┐            │
│         │   Consensus Engine    │            │
│         │ (Weighting & Scoring) │            │
│         └──────────┬────────────┘            │
└────────────────────┼─────────────────────────┘
                     │
                     ▼
             Normalized Subgenres
```

### Rate-Limit & API Governance
* **MusicBrainz:** Hard limit of 1 request/second. Strict User-Agent header required (`SonusPilot/1.0 (contact@sonuspilot.com)`).
* **Last.fm:** Up to 5 req/sec. Tag normalization map applied (e.g., casing standardization, stripping non-genre tags like `"favourites"` or `"seen live"`).
* **Discogs:** 60 req/min with Personal Access Token. Used for secondary genre/style verification.

---

## 8. Genre/Subgenre Classification & Sound DNA

### Sound DNA Vector Representation
Instead of hardcoding a single binary genre, each subgenre is represented in the database as a normalized **Sound DNA Vector** (values 0.0 to 1.0):

```json
{
  "subgenre": "dream_pop",
  "dna": {
    "warmness": 0.70,
    "bass": 0.40,
    "vocal_presence": 0.80,
    "air": 0.90,
    "stereo_width": 0.95,
    "treble": 0.65,
    "density": 0.45
  }
}
```

### Multi-Subgenre Blending Example
If a song is classified as:
* 70% Thrash Metal
* 20% Speed Metal
* 10% Heavy Metal

The backend calculates the blended reference EQ by weighted summation in the dB domain:
$$\text{EQ}_{\text{base}}(f) = 0.70 \cdot \text{EQ}_{\text{Thrash}}(f) + 0.20 \cdot \text{EQ}_{\text{Speed}}(f) + 0.10 \cdot \text{EQ}_{\text{Heavy}}(f)$$

---

## 9. Headphone Compensation Algorithm

To ensure the output sounds correct on the user's specific hardware, SonusPilot applies headphone compensation aligned with the **Harman Target Curve** (2018 over-ear / IEM standards).

1. **Measurement Source:** Curated parametric EQ profiles derived from trusted measurement standards (e.g., Oratory1990 data or auto-generated target curves).
2. **Compensation Curve ($C(f)$):** Inverts the headphone's measured frequency response deviation from the Harman target.
3. **Combined Signal Chain:**
   $$\text{Final EQ}(f) = \text{HeadphoneCompensation}(f) + \text{BlendedSubgenreEQ}(f) + \text{UserPreference}(f)$$

---

## 10. Database Schema (Modular PostgreSQL)

```sql
-- Users & Preferences
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Headphones & Devices
CREATE TABLE headphones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand VARCHAR(100) NOT NULL,
    model VARCHAR(150) NOT NULL,
    target_curve VARCHAR(50) DEFAULT 'Harman 2018',
    eq_config_text TEXT NOT NULL -- Equalizer APO format
);

CREATE TABLE device_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    windows_device_id VARCHAR(500) NOT NULL,
    headphone_id UUID REFERENCES headphones(id),
    UNIQUE(user_id, windows_device_id)
);

-- Subgenres & Sound DNA
CREATE TABLE subgenres (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    sound_dna JSONB NOT NULL,
    reference_eq_31band NUMERIC[] NOT NULL -- 31 float values in dB
);

-- Songs & Metadata Cache
CREATE TABLE songs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title_hash VARCHAR(64) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    artist VARCHAR(255) NOT NULL,
    album VARCHAR(255),
    subgenre_weights JSONB NOT NULL, -- e.g. {"thrash_metal": 0.7, "speed_metal": 0.3}
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## 11. Failure Cases & Graceful Degradation

| Failure Scenario | System Response & Fallback |
| :--- | :--- |
| **Spotify / Media not running** | UI shows "Waiting for audio playback...". EQ defaults to Neutral (0 dB). |
| **Metadata API unavailable** | Fallback to local cache; if cache miss, apply broad genre fallback (e.g., "Rock" or "Electronic") or Neutral EQ. |
| **Unknown Headphone / Device** | Prompt user once to select model from dropdown. Default to uncompensated profile until selected. |
| **Internet Offline** | Operate in offline mode using local cache of recent tracks and default profiles. Show subtle status indicator. |
| **Rapid Song Skipping** | Debounce track change events by 500ms to prevent thrashing network requests and audio filter resets. |

---

## 12. Staged Implementation Roadmap

* **Phase 1: Foundation & Scaffolding (Current)**
  * Tauri shell, React UI layout (31-band visualizer mockup), Windows GSMTC stub.
* **Phase 2: Audio Engine & Device Detection**
  * Integrate Windows WASAPI default endpoint detection and Equalizer APO / Peace CLI control in Rust.
* **Phase 3: Cloud Backend & Metadata Pipeline**
  * Build Node.js/Rust backend with PostgreSQL, MusicBrainz/Last.fm integration, and tag normalization.
* **Phase 4: Blending & Compensation Engine**
  * Implement the 31-band math blending algorithm, Harman headphone compensation, and 20ms crossfade.
* **Phase 5: Polish & User Testing**
  * Real-world testing across Spotify and web players, refining UI responsiveness and edge-case error handling.
