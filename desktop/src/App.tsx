import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

import NowPlaying, { type NowPlayingData } from "./components/NowPlaying";
import DeviceSelector from "./components/DeviceSelector";
import Equalizer31Band, {
  type EQMode,
  type SubgenreWeight,
  type TastePreferences,
  TASTE_OFFSETS,
  DEFAULT_TASTE,
} from "./components/Equalizer31Band";
import StatusBar, { type ServiceStatus } from "./components/StatusBar";
import Diagnostics from "./components/Diagnostics";
import EQChatAssistant from "./components/EQChatAssistant";
import SettingsPage from "./pages/Settings";

import {
  computeFinalEQ,
  buildHeadphoneCorrection,
  buildLearnedPreference,
  buildMusicReference,
  buildUserPreference,
  applyToEqualizerAPO,
  setNeutralEQ,
  type EQDecision,
  type EQLayer,
} from "./services/eqDecisionEngine";
import {
  getEngineStatus,
  getApoBinding,
  boundEndpointName,
} from "./services/eqDiagnostics";
import { addUserFeedback, getBestEQForContext, type FeedbackRating } from "./services/cloudEqService";
import { getMappedProfile, type HeadphoneProfileData } from "./services/headphoneProfileService";
import { getCurrentTrack, getDefaultOutputDevice } from "./services/tauriEvents";
import { getAppSettings, saveAppSettings, type AppSettings } from "./services/appSettingsService";
import { classifyTrack } from "./services/musicClassifierService";

type View = "equalizer" | "settings";

interface RustTrackInfo {
  title: string;
  artist: string;
  album: string;
  status: string;
}

function TitleBar({ onOpenAssistant }: { onOpenAssistant: () => void }) {
  return (
    <header className="titlebar" role="banner">
      <div className="titlebar__brand">
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
        <button
          type="button"
          className="titlebar__assistant-toggle"
          onClick={onOpenAssistant}
          aria-label="Toggle EQ Assistant"
          title="EQ Assistant"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      </div>
    </header>
  );
}

// ── Adaptive EQ breakdown ──────────────────────────────────────────────
// Explains the curve without forcing the user into a chat window.
const LAYER_LABELS: { key: keyof Omit<EQDecision, "finalGains" | "preamp" | "confidence">; label: string }[] = [
  { key: "headphoneCorrection", label: "Headphone correction" },
  { key: "musicReference", label: "Music context" },
  { key: "userPreference", label: "Your preference" },
  { key: "learnedPreference", label: "Learned preference" },
];

function layerPeakDb(layer: EQLayer | undefined): number {
  if (!layer) return 0;
  return layer.gains.reduce((peak, g) => Math.max(peak, Math.abs(g)), 0);
}

function WhyThisEq({ decision }: { decision: EQDecision | null }) {
  const [open, setOpen] = useState(false);

  if (!decision) {
    return (
      <div className="card why-card why-card--empty">
        <div className="card__label">Adaptive EQ</div>
        <p className="why-card__hint">Play something to see how the curve is built.</p>
      </div>
    );
  }

  return (
    <div className={`card why-card${open ? " why-card--open" : ""}`}>
      <button
        type="button"
        className="why-card__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="why-eq-layers"
      >
        <span className="card__label">Adaptive EQ</span>
        <span className="why-card__chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <ul className="why-card__layers" id="why-eq-layers">
          {LAYER_LABELS.map(({ key, label }) => (
            <li key={key} className="why-card__layer">
              <span className="why-card__layer-label">{label}</span>
              <span className="why-card__layer-value">
                {layerPeakDb(decision[key]).toFixed(1)} dB
              </span>
            </li>
          ))}
          <li className="why-card__layer why-card__layer--headroom">
            <span className="why-card__layer-label">Headroom</span>
            <span className="why-card__layer-value">{decision.preamp.toFixed(1)} dB</span>
          </li>
          <li className="why-card__layer why-card__layer--confidence">
            <span className="why-card__layer-label">Confidence</span>
            <span className="why-card__layer-value">
              {Math.round(decision.confidence * 100)}%
            </span>
          </li>
        </ul>
      )}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>("equalizer");
  const [settings, setSettings] = useState<AppSettings>(() => getAppSettings());
  const [eqMode, setEqMode] = useState<EQMode>("auto");
  // The assistant is a secondary power tool: closed unless the user asks for it.
  const [assistantOpen, setAssistantOpen] = useState(false);
  // The audio path is a troubleshooting tool: same, closed by default.
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [lastDecision, setLastDecision] = useState<EQDecision | null>(null);
  const [taste, setTaste] = useState<TastePreferences>(DEFAULT_TASTE);

  const [currentTrack, setCurrentTrack] = useState<NowPlayingData | null>(null);
  const [outputDevice, setOutputDevice] = useState<{ id: string; name: string } | null>(null);
  const [headphone, setHeadphone] = useState<HeadphoneProfileData | null>(null);
  const [appliedGains, setAppliedGains] = useState<number[]>([]);

  const [cloudStatus, setCloudStatus] = useState<ServiceStatus>("loading");
  const [eqStatus, setEqStatus] = useState<ServiceStatus>("loading");
  const [engineAvailable, setEngineAvailable] = useState(false);
  const [statusNote, setStatusNote] = useState<string>("Starting SonusPilot…");

  // A fast song skip must not let an older decision overwrite a newer one.
  const applyGeneration = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const [engine, binding] = await Promise.all([getEngineStatus(), getApoBinding()]);
      if (cancelled) return;
      setEngineAvailable(engine.available);
      setEqStatus(engine.available ? "online" : "offline");

      const device = await getDefaultOutputDevice();
      if (cancelled) return;
      if (device) setOutputDevice(device);

      // An installed engine is not the same as an audible one. APO processes
      // only the endpoint it was installed on, so when that is not the active
      // output the correction is silently discarded — say so instead of
      // reporting a healthy "ready".
      const bound = boundEndpointName(binding);
      const active = device?.name ?? null;
      const misbound =
        engine.available && bound !== null && active !== null && bound !== active;

      if (!engine.available) {
        setStatusNote("Equalizer APO not detected — system audio untouched, EQ is preview only.");
      } else if (misbound) {
        setStatusNote(
          `Equalizer APO is installed on "${bound}" but audio plays through ` +
            `"${active}" — the correction is not reaching your output.`,
        );
      } else {
        setStatusNote("Equalizer APO ready.");
      }

      if (device) {
        setHeadphone(getMappedProfile(device.id) ?? null);
      } else {
        setStatusNote("No Windows output device detected.");
      }

      if (getAppSettings().autoDetectTracks) {
        const track = await getCurrentTrack();
        if (!cancelled && track) setCurrentTrack(track);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unlistenDevice = listen<{ id: string; name: string; is_default: boolean }>(
      "output-device-changed",
      (event) => {
        setOutputDevice({ id: event.payload.id, name: event.payload.name });
        // Re-resolve the mapping so a newly selected endpoint restores its
        // headphone profile automatically.
        setHeadphone(getMappedProfile(event.payload.id) ?? null);
        setStatusNote(`Output device changed to ${event.payload.name}.`);
      },
    );
    return () => {
      void unlistenDevice.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<RustTrackInfo>("track-changed", (event) => {
      const payload = event.payload;
      setCurrentTrack({
        title: payload.title,
        artist: payload.artist,
        album: payload.album,
        status: payload.status as NowPlayingData["status"],
        subgenres: [],
      });
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const classify = useCallback(
    (track: NowPlayingData): SubgenreWeight[] =>
      classifyTrack({ title: track.title, artist: track.artist, album: track.album }),
    [],
  );

  useEffect(() => {
    const generation = ++applyGeneration.current;
    let cancelled = false;

    async function decide() {
      if (eqMode !== "auto" || !settings.autoEqEnabled) return;
      if (cancelled || generation !== applyGeneration.current) return;

      const subgenres = currentTrack ? classify(currentTrack) : [];
      const dominantGenre = subgenres[0]?.name ?? "unknown";

      const music = await getBestEQForContext(
        headphone?.id ?? "unmapped",
        dominantGenre,
        subgenres,
      );
      if (cancelled || generation !== applyGeneration.current) return;

      setCloudStatus(music.source === "builtin" ? "loading" : "online");

      const decision = computeFinalEQ(
        buildHeadphoneCorrection(headphone ?? undefined),
        buildMusicReference(music.profile ?? null),
        buildUserPreference(
          taste as unknown as Record<string, boolean>,
          TASTE_OFFSETS as unknown as Record<string, number[]>,
        ),
        buildLearnedPreference(headphone?.id ?? "unmapped", dominantGenre, music.gains),
      );

      if (cancelled || generation !== applyGeneration.current) return;

      setAppliedGains(decision.finalGains);
      setLastDecision(decision);
      setStatusNote(
        `${dominantGenre} · preamp ${decision.preamp.toFixed(1)} dB · confidence ${(decision.confidence * 100).toFixed(0)}%`,
      );

      const ok = await applyToEqualizerAPO(decision);
      if (cancelled || generation !== applyGeneration.current) return;
      if (ok) {
        setEqStatus("online");
        setEngineAvailable(true);
      } else if (!engineAvailable) {
        setEqStatus("offline");
        setStatusNote("Equalizer APO did not accept the profile — the previous EQ is still in effect.");
      }
    }

    void decide();
    return () => {
      cancelled = true;
    };
  }, [currentTrack, headphone, taste, eqMode, settings.autoEqEnabled, classify]);

  const handleTasteChange = useCallback((next: TastePreferences) => {
    setTaste(next);
  }, []);

  const handleFeedback = useCallback(
    async (rating: FeedbackRating) => {
      if (!currentTrack || !settings.feedbackEnabled) return;
      const subgenres = classify(currentTrack);
      const dominantGenre = subgenres[0]?.name ?? "unknown";
      addUserFeedback({
        headphoneId: headphone?.id ?? "unmapped",
        trackId: `${currentTrack.artist}::${currentTrack.title}`,
        genre: dominantGenre,
        subgenres,
        baseGains: appliedGains.slice(),
        taste,
        rating,
      });
      setStatusNote(`Feedback stored — the next ${dominantGenre} decision will include it.`);
    },
    [currentTrack, headphone?.id, appliedGains, taste, classify, settings.feedbackEnabled],
  );

  const handleSettingsChange = useCallback((next: AppSettings) => {
    saveAppSettings(next);
    setSettings(next);
  }, []);

  // The assistant must never be stranded open: Escape and a view switch both
  // close it, so returning to the EQ always gives the main controls the space.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAssistantOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setAssistantOpen(false);
  }, [view]);

  // Disabling Auto-EQ is a real engine write, not a display toggle.
  useEffect(() => {
    if (settings.autoEqEnabled) return;
    void setNeutralEQ().then((ok) => {
      if (ok) setStatusNote("Auto-EQ disabled — system EQ set to neutral.");
    });
  }, [settings.autoEqEnabled]);

  const activeProfile =
    currentTrack && currentTrack.subgenres.length > 0
      ? currentTrack.subgenres.map((s) => `${s.name} ${Math.round(s.weight * 100)}%`).join(" / ")
      : headphone
        ? `${headphone.brand} ${headphone.model}`
        : "No profile";

  if (view === "settings") {
    return (
      <div className="app">
        <TitleBar onOpenAssistant={() => setAssistantOpen((v) => !v)} />
        <SettingsPage
          settings={settings}
          onChange={handleSettingsChange}
          outputDevice={outputDevice}
          onClose={() => setView("equalizer")}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <TitleBar onOpenAssistant={() => setAssistantOpen((v) => !v)} />

      <main className={`app__main${assistantOpen ? " app__main--assistant-open" : ""}`}>
        <aside className="left-panel">
          <div className="card">
            <div className="card__label">Now Playing</div>
            <NowPlaying data={currentTrack} mode={eqMode} />
          </div>
          <DeviceSelector
            outputDevice={outputDevice}
            headphone={headphone ? { id: headphone.id, brand: headphone.brand, model: headphone.model } : null}
            onChangeHeadphone={() => setView("settings")}
          />
          <WhyThisEq decision={lastDecision} />
          <button className="settings-link" onClick={() => setDiagnosticsOpen((v) => !v)}>
            {diagnosticsOpen ? "Hide" : "Show"} audio path
          </button>
          {diagnosticsOpen && <Diagnostics onClose={() => setDiagnosticsOpen(false)} />}
          <button className="assistant-launch" onClick={() => setAssistantOpen(true)}>
            <span aria-hidden="true">💬</span> EQ Assistant
          </button>
          <button className="settings-link" onClick={() => setView("settings")}>
            Open Settings
          </button>
        </aside>

        <section className="right-panel">
          <Equalizer31Band
            mode={eqMode}
            onModeChange={setEqMode}
            activeProfile={activeProfile}
            headphoneId={headphone?.id}
            genre={currentTrack?.subgenres?.[0]?.name ?? "unknown"}
            onTasteChange={handleTasteChange}
            onFeedback={settings.feedbackEnabled ? handleFeedback : undefined}
            externalGains={appliedGains.length > 0 ? appliedGains : undefined}
          />
        </section>

        {/* Assistant is an optional drawer, never a layout column */}
        <aside
          className={`assistant-drawer${assistantOpen ? " assistant-drawer--open" : ""}`}
          aria-label="EQ Assistant"
          aria-hidden={!assistantOpen}
        >
          <EQChatAssistant
            headphoneId={headphone?.id ?? "unmapped"}
            genre={currentTrack?.subgenres?.[0]?.name ?? "unknown"}
            subgenres={currentTrack?.subgenres ?? []}
            baseGains={appliedGains}
            baseTaste={taste}
            onGainsChange={() => undefined}
            onClose={() => setAssistantOpen(false)}
          />
        </aside>
      </main>

      <StatusBar cloudStatus={cloudStatus} eqStatus={eqStatus} outputDeviceName={outputDevice?.name} />

      <p className="app__status-note" role="status">
        {statusNote}
      </p>
    </div>
  );
}
