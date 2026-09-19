import { useState } from "react";
import "./App.css";

import NowPlaying, { type NowPlayingData } from "./components/NowPlaying";
import DeviceSelector, {
  type OutputDevice,
  type HeadphoneProfile,
} from "./components/DeviceSelector";
import Equalizer31Band, { type EQMode } from "./components/Equalizer31Band";
import StatusBar, { type ServiceStatus } from "./components/StatusBar";

// ── Mock data for Phase 1 UI shell ────────────────────────────────────
// In Phase 2 this will be replaced by real Tauri command invocations
// from the Rust GSMTC watcher and WASAPI device enumerator.

const MOCK_TRACK: NowPlayingData = {
  title: "Raining Blood",
  artist: "Slayer",
  album: "Reign in Blood",
  artworkUrl: undefined,
  status: "playing",
  subgenres: [
    { name: "Thrash Metal", weight: 0.70 },
    { name: "Speed Metal",  weight: 0.20 },
    { name: "Heavy Metal",  weight: 0.10 },
  ],
};

const MOCK_DEVICE: OutputDevice = {
  id: "mock-device-001",
  name: "Realtek USB Audio",
};

const MOCK_HEADPHONE: HeadphoneProfile = {
  id: "mock-hp-001",
  brand: "Simgot",
  model: "EW300",
};

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

  // Simulate a playing track (Phase 2: replaced by GSMTC Tauri event)
  const [currentTrack] = useState<NowPlayingData | null>(MOCK_TRACK);

  // Output device + headphone (Phase 2: replaced by WASAPI enumeration)
  const [outputDevice] = useState<OutputDevice | null>(MOCK_DEVICE);
  const [headphone, setHeadphone] = useState<HeadphoneProfile | null>(
    MOCK_HEADPHONE
  );

  // Service statuses (Phase 3: driven by API client health checks)
  const [cloudStatus] = useState<ServiceStatus>("loading");
  const [eqStatus]    = useState<ServiceStatus>("online");

  // Active profile name shown in EQ header
  const activeProfile =
    currentTrack && currentTrack.subgenres.length > 0
      ? currentTrack.subgenres.map((s) => s.name).join(" / ")
      : "No profile";

  function handleChangeHeadphone() {
    // Phase 2: open a headphone-picker modal / Tauri dialog
    // For now, toggle between mapped and unmapped to demonstrate the UI states
    setHeadphone((prev) => (prev ? null : MOCK_HEADPHONE));
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
