import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

import NowPlaying, { type NowPlayingData } from "./components/NowPlaying";
import DeviceSelector, {
  type OutputDevice,
  type HeadphoneProfile,
} from "./components/DeviceSelector";
import Equalizer31Band, { type EQMode } from "./components/Equalizer31Band";
import StatusBar, { type ServiceStatus } from "./components/StatusBar";

// ── Type for Rust TrackInfo ─────────────────────────────────────────────
interface RustTrackInfo {
  title: string;
  artist: string;
  album: string;
  status: string;
}

// ── TitleBar ──────────────────────────────────────────────────────────
function TitleBar() {
  return (
    <header className="titlebar" role="banner">
      <div className="titlebar__brand">
        {/* Waveform icon */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        SonusPilot
      </div>
      <div className="titlebar__controls">
        {/* Window controls placeholder — Tauri custom decorations in Phase 2 */}
      </div>
    </header>
  );
}

// ── App ───────────────────────────────────────────────────────────────
export default function App() {
  // EQ mode
  const [eqMode, setEqMode] = useState<EQMode>("auto");

  // Current track from GSMTC
  const [currentTrack, setCurrentTrack] = useState<NowPlayingData | null>(null);

  // Output device + headphone
  const [outputDevice, setOutputDevice] = useState<OutputDevice | null>(null);
  const [headphone, setHeadphone] = useState<HeadphoneProfile | null>(null);

  // Service statuses
  const [cloudStatus] = useState<ServiceStatus>("loading");
  const [eqStatus] = useState<ServiceStatus>("online");

  // Active profile name shown in EQ header
  const activeProfile =
    currentTrack && currentTrack.subgenres.length > 0
      ? currentTrack.subgenres.map((s) => s.name).join(" / ")
      : "No profile";

  // Initialize: get current track and device on mount
  useEffect(() => {
    async function init() {
      try {
        // Get current track from GSMTC
        const track = await invoke<OptionRustTrackInfo>("get_current_track");
        if (track) {
          setCurrentTrack(convertRustTrack(track));
        }

        // Get default output device
        const deviceId = await invoke<string>("get_default_output_device");
        setOutputDevice({ id: deviceId, name: deviceId });
      } catch (e) {
        console.error("Init error:", e);
      }
    }
    init();

    // Listen for track-changed events from Rust
    const unlisten = listen<RustTrackInfo>("track-changed", (event) => {
      setCurrentTrack(convertRustTrack(event.payload));
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  function handleChangeHeadphone() {
    // Phase 2: open a headphone-picker modal / Tauri dialog
    // For now, toggle between mapped and unmapped to demonstrate the UI states
    setHeadphone((prev) => (prev ? null : { id: "mock-hp-001", brand: "Simgot", model: "EW300" }));
  }

  return (
    <div className="app">
      {/* ── Title bar ── */}
      <TitleBar />

      {/* ── Main content ── */}
      <main className="app__main">
        {/* Left: now-playing + device info */}
        <aside className="left-panel">
          <div className="card">
            <div className="card__label">Now Playing</div>
            <NowPlaying data={currentTrack} mode={eqMode} />
          </div>
          <DeviceSelector
            outputDevice={outputDevice}
            headphone={headphone}
            onChangeHeadphone={handleChangeHeadphone}
          />
        </aside>

        {/* Right: 31-band EQ */}
        <section className="right-panel">
          <Equalizer31Band
            mode={eqMode}
            onModeChange={setEqMode}
            activeProfile={activeProfile}
          />
        </section>
      </main>

      {/* ── Status bar ── */}
      <StatusBar
        cloudStatus={cloudStatus}
        eqStatus={eqStatus}
        outputDeviceName={outputDevice?.name}
      />
    </div>
  );
}

// Helper to convert Rust TrackInfo to NowPlayingData
function convertRustTrack(track: RustTrackInfo): NowPlayingData {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    artworkUrl: undefined,
    status: track.status as "playing" | "paused" | "stopped",
    subgenres: [], // Will be populated from cloud in Phase 3
  };
}

// Tauri invoke return type for optional
interface OptionRustTrackInfo {
  title: string;
  artist: string;
  album: string;
  status: string;
}