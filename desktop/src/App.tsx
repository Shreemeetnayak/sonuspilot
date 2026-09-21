import { useState, useEffect, useCallback } from "react";
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
import EQChatAssistant from "./components/EQChatAssistant";
import { getBestEQForContext, addUserFeedback, type CloudEQProfile, type FeedbackRating } from "./services/cloudEqService";

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

  // Cloud EQ profile (fetched/learned)
  const [cloudProfile, setCloudProfile] = useState<CloudEQProfile | null>(null);

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

  // Fetch cloud EQ profile when track or headphone changes
  useEffect(() => {
    if (headphone?.id && currentTrack) {
      const genre = currentTrack.subgenres?.[0] || "unknown";
      const subgenres = currentTrack.subgenres || [];
      getBestEQForContext(
        headphone.id,
        genre,
        subgenres,
        "Dream Pop",
        {
          bassBoost: false,
          vocalClarity: false,
          trebleAir: false,
          warmth: false,
          presence: false,
          subBass: false,
        }
      ).then((result) => setCloudProfile(result.profile || null));
    } else {
      setCloudProfile(null);
    }
  }, [headphone?.id, currentTrack]);

  // Handle natural language feedback from user (ChatGPT-like)
  const handleFeedback = useCallback(
    async (rating: FeedbackRating) => {
      if (!headphone?.id || !currentTrack) return;

      const genre = currentTrack.subgenres?.[0] || "unknown";
      const subgenres = currentTrack.subgenres || [];

      // Send feedback to cloud service (this updates the learned profile)
      await addUserFeedback({
        headphoneId: headphone.id,
        trackId: `${currentTrack.title}-${currentTrack.artist}`,
        genre,
        subgenres,
        baseGains: cloudProfile?.gains || [],
        taste: cloudProfile?.tasteOverrides || {
          bassBoost: false,
          vocalClarity: false,
          trebleAir: false,
          warmth: false,
          presence: false,
          subBass: false,
        },
        rating,
      });

      // Re-fetch updated profile
      getBestEQForContext(headphone.id, genre, subgenres).then(setCloudProfile);
    },
    [headphone?.id, currentTrack, cloudProfile?.gains, cloudProfile?.tasteOverrides]
  );

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
            headphoneId={headphone?.id}
            genre={currentTrack?.subgenres?.[0] || "unknown"}
            subgenres={currentTrack?.subgenres || []}
            onFeedback={handleFeedback}
            externalGains={cloudProfile?.gains}
          />
        </section>
      </main>

      {/* ── Status bar ── */}
      <StatusBar
        cloudStatus={cloudStatus}
        eqStatus={eqStatus}
        outputDeviceName={outputDevice?.name}
      />

      {/* ── EQ Chat Assistant (ChatGPT-like) ── */}
      <section className="eq-chat-assistant">
        <EQChatAssistant
          headphoneId={headphone?.id || "unknown"}
          genre={currentTrack?.subgenres?.[0] || "unknown"}
          baseGains={cloudProfile?.gains || []}
          onGainsChange={(gains) => {
            // Update the Equalizer31Band with learned gains
            // This is handled automatically through the cloudProfile update
          }}
        />
      </section>
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