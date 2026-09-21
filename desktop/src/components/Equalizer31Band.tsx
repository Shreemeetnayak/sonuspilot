import { useState, useCallback, useRef, useEffect } from "react";
import "./Equalizer31Band.css";

// ── ISO 266 31-band center frequencies (Hz) ───────────────────────────
export const ISO_BANDS: number[] = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
];

// Human-readable labels (abbreviated for space)
const BAND_LABELS: string[] = [
  "20", "25", "31", "40", "50", "63", "80", "100", "125", "160",
  "200", "250", "315", "400", "500", "630", "800", "1k", "1.25k", "1.6k",
  "2k", "2.5k", "3.15k", "4k", "5k", "6.3k", "8k", "10k", "12.5k", "16k", "20k",
];

export type EQMode = "auto" | "manual" | "preset";

const BUILTIN_PRESETS = [
  "Dream Pop", "EDM", "Thrash Metal", "Jazz", "Classical",
  "Hip-Hop", "Acoustic", "Podcast",
] as const;

export type BuiltinPresetName = (typeof BUILTIN_PRESETS)[number];

// User-created presets (stored in localStorage)
export interface UserPreset {
  name: string;
  gains: number[];
  createdAt: number;
}

const USER_PRESETS_KEY = "sonuspilot-user-presets";

function loadUserPresets(): UserPreset[] {
  try {
    const stored = localStorage.getItem(USER_PRESETS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveUserPresets(presets: UserPreset[]): void {
  localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(presets));
}

// ── Taste Preference Offsets (user-clickable checkboxes) ───────────────
export interface TastePreferences {
  bassBoost: boolean;      // +2dB @ 40-160Hz
  vocalClarity: boolean;   // +1.5dB @ 1k-4kHz
  trebleAir: boolean;      // +1.5dB @ 8k-16kHz
  warmth: boolean;         // +1dB @ 200-500Hz
  presence: boolean;       // +1dB @ 3k-6kHz
  subBass: boolean;        // +2dB @ 20-40Hz
}

const DEFAULT_TASTE: TastePreferences = {
  bassBoost: false,
  vocalClarity: false,
  trebleAir: false,
  warmth: false,
  presence: false,
  subBass: false,
};

// Gain offsets applied per band when taste is enabled
const TASTE_OFFSETS: Record<keyof TastePreferences, number[]> = {
  bassBoost:      [0, 0, 2, 2, 2, 1.5, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  vocalClarity:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 1, 1.5, 1.5, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  trebleAir:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 1, 1.5, 1.5, 1, 0.5, 0, 0],
  warmth:         [0, 0, 0, 0, 0, 0, 0.5, 1, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  presence:       [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 1, 1, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  subBass:        [2, 2, 1.5, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

// Human-readable labels for taste checkboxes
export const TASTE_LABELS: Record<keyof TastePreferences, string> = {
  bassBoost: "Bass Boost (+2dB @ 40–160 Hz)",
  vocalClarity: "Vocal Clarity (+1.5dB @ 1–4 kHz)",
  trebleAir: "Treble Air (+1.5dB @ 8–16 kHz)",
  warmth: "Warmth (+1dB @ 200–500 Hz)",
  presence: "Presence (+1dB @ 3–6 kHz)",
  subBass: "Sub-Bass (+2dB @ 20–40 Hz)",
};

// ── Neutral (flat) gains ──────────────────────────────────────────────
const NEUTRAL_GAINS: number[] = new Array(31).fill(0);

// ── Demo preset shapes (illustrative, not authoritative) ──────────────
const BUILTIN_PRESET_GAINS: Record<BuiltinPresetName, number[]> = {
  "Dream Pop": [
    0, 0, 0.5, 0.5, 0.5, 0.5, 0, -0.5, -0.5, -0.5,
    -1, -1, -0.5, 0, 0, 0.5, 1, 1, 1.5, 1.5,
    2, 2, 2, 2.5, 2.5, 3, 3, 3, 2.5, 2, 1.5,
  ],
  "EDM": [
    4, 4, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5,
    0, -0.5, -1, -1, -0.5, 0, 0, 0, 0.5, 1,
    1.5, 1.5, 2, 2, 2, 2.5, 2.5, 2, 1.5, 1, 0.5,
  ],
  "Thrash Metal": [
    1, 1, 1, 1.5, 2, 2, 1.5, 1, 0.5, 0,
    0, -0.5, -1, -1.5, -1.5, -1, -0.5, 0, 0.5, 1,
    1.5, 2, 2, 1.5, 1, 0.5, 1, 1.5, 1, 0.5, 0,
  ],
  "Jazz": [
    0, 0, 0, 0.5, 0.5, 1, 1, 0.5, 0, -0.5,
    -0.5, -0.5, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0.5, 0.5, 0.5, 0, -0.5, -0.5, -1, -1, -0.5, 0,
  ],
  "Classical": [
    0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0, 0,
    0, -0.5, -0.5, -0.5, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0.5, 0.5, 1, 1, 1, 0.5, 0.5, 0,
  ],
  "Hip-Hop": [
    3, 3, 3, 2.5, 2, 1.5, 1, 0.5, 0, 0,
    0, -0.5, -1, -1, -0.5, 0, 0, 0, 0.5, 0.5,
    0, 0, 0, 0, 0.5, 1, 1, 1, 0.5, 0, 0,
  ],
  "Acoustic": [
    0, 0, 0, 0, 0, 0, 0.5, 1, 1.5, 1,
    0.5, 0, 0, 0, 0.5, 1, 1.5, 1.5, 1, 0.5,
    0, 0, 0, 0.5, 0.5, 1, 1, 0.5, 0, -0.5, -1,
  ],
  "Podcast": [
    -3, -3, -3, -2.5, -2, -1.5, -1, 0, 0.5, 1,
    1.5, 2, 2, 1.5, 1, 0.5, 0, 0, 0, -0.5,
    -0.5, -1, -1, -1.5, -2, -2, -2, -2.5, -2.5, -3, -3,
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────
function formatGain(g: number): string {
  if (g === 0) return "0";
  return (g > 0 ? "+" : "") + g.toFixed(1);
}

function gainClass(g: number): string {
  if (g > 0.1) return "eq-band__gain--boosted";
  if (g < -0.1) return "eq-band__gain--cut";
  return "";
}

// ── Frequency response SVG curve ─────────────────────────────────────
function EQCurve({ gains }: { gains: number[] }) {
  const W = 800;
  const H = 80;
  const PAD = 4;
  const MAX_DB = 12;

  // Map each band index to an x position
  const xs = gains.map((_, i) =>
    PAD + ((i / (gains.length - 1)) * (W - PAD * 2))
  );

  // Map dB gain to y position (centre = 0 dB)
  const yOf = (db: number) =>
    H / 2 - (db / MAX_DB) * (H / 2 - PAD);

  // Build a smooth SVG path through all band positions
  const pts = gains.map((g, i) => ({ x: xs[i], y: yOf(g) }));

  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const cpx = (prev.x + curr.x) / 2;
    d += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`;
  }

  // Fill path down to centre line
  const fillD =
    d +
    ` L ${pts[pts.length - 1].x} ${H / 2}` +
    ` L ${pts[0].x} ${H / 2} Z`;

  return (
    <svg
      className="eq-curve"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {/* 0 dB centre line */}
      <line
        x1={0} y1={H / 2} x2={W} y2={H / 2}
        stroke="var(--border)" strokeWidth="0.8"
        strokeDasharray="4 4"
      />
      {/* Fill */}
      <path
        d={fillD}
        fill="var(--accent-glow)"
        strokeWidth="0"
      />
      {/* Curve line */}
      <path
        d={d}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────
interface Equalizer31BandProps {
  /** Externally-set gains (e.g., from cloud profile). Overrides internal
   *  state while mode === 'auto'. */
  externalGains?: number[];
  mode: EQMode;
  onModeChange: (mode: EQMode) => void;
  onGainsChange?: (gains: number[]) => void;
  activeProfile?: string;
}

export default function Equalizer31Band({
  externalGains,
  mode,
  onModeChange,
  onGainsChange,
  activeProfile = "—",
}: Equalizer31BandProps) {
  const [gains, setGains] = useState<number[]>(NEUTRAL_GAINS);
  const [activePreset, setActivePreset] = useState<PresetName | null>(null);
  const [taste, setTaste] = useState<TastePreferences>(DEFAULT_TASTE);

  // Compute gains with taste offsets applied
  const computeGainsWithTaste = useCallback((baseGains: number[]): number[] => {
    return baseGains.map((gain, i) => {
      let offset = 0;
      (Object.keys(taste) as Array<keyof TastePreferences>).forEach((key) => {
        if (taste[key]) {
          offset += TASTE_OFFSETS[key][i];
        }
      });
      return Math.max(-12, Math.min(12, gain + offset)); // clamp to ±12dB
    });
  }, [taste]);

  // Effective gains shown to user (base + taste)
  const effectiveGains = computeGainsWithTaste(gains);

  // Sync external gains (from auto-mode cloud profile)
  const prevExternal = useRef<number[] | undefined>(undefined);
  useEffect(() => {
    if (
      mode === "auto" &&
      externalGains &&
      externalGains !== prevExternal.current
    ) {
      prevExternal.current = externalGains;
      setGains(externalGains);
    }
  }, [mode, externalGains]);

  // When mode switches to neutral, flatten everything
  useEffect(() => {
    if (mode === "neutral") {
      setGains(NEUTRAL_GAINS);
      setActivePreset(null);
    }
  }, [mode]);

  const handleTasteToggle = useCallback((key: keyof TastePreferences) => {
    setTaste((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleBandChange = useCallback(
    (index: number, value: number) => {
      if (mode === "auto" || mode === "neutral") return; // read-only in those modes
      // Convert effective value back to base value by removing taste offset
      let baseValue = value;
      (Object.keys(taste) as Array<keyof TastePreferences>).forEach((key) => {
        if (taste[key]) {
          baseValue -= TASTE_OFFSETS[key][index];
        }
      });
      baseValue = Math.max(-12, Math.min(12, baseValue));
      setGains((prev) => {
        const next = [...prev];
        next[index] = baseValue;
        onGainsChange?.(next);
        return next;
      });
      setActivePreset(null);
    },
    [mode, onGainsChange, taste]
  );

  const handlePresetClick = useCallback(
    (preset: PresetName) => {
      if (mode === "neutral") return;
      const newGains = PRESET_GAINS[preset];
      setGains(newGains);
      setActivePreset(preset);
      onModeChange("preset");
      onGainsChange?.(newGains);
    },
    [mode, onModeChange, onGainsChange]
  );

  const isReadOnly = mode === "auto" || mode === "neutral";

  return (
    <div className="eq-panel">
      {/* Header */}
      <div className="eq-panel__header">
        <div className="eq-panel__title-row">
          <div>
            <div className="eq-panel__profile-name">
              {mode === "neutral"
                ? "Flat / Neutral"
                : mode === "preset" && activePreset
                ? activePreset
                : activeProfile}
            </div>
            <div className="eq-panel__profile-sub">31-band parametric EQ</div>
          </div>
        </div>

        {/* Mode selector */}
        <div className="mode-pills" role="group" aria-label="EQ mode">
          {(["auto", "manual", "preset", "neutral"] as EQMode[]).map((m) => (
            <button
              key={m}
              className={`mode-pill${mode === m ? " mode-pill--active" : ""}`}
              onClick={() => onModeChange(m)}
              aria-pressed={mode === m}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {/* Taste preference checkboxes */}
        <div className="taste-preferences" role="group" aria-label="Personal taste preferences">
          {(Object.entries(taste) as Array<[keyof TastePreferences, boolean]>).map(([key, enabled]) => (
            <label key={key} className="taste-checkbox">
              <input
                type="checkbox"
                checked={enabled}
                onChange={() => handleTasteToggle(key)}
              />
              <span className="taste-checkbox__label">
                {TASTE_LABELS[key]}
              </span>
              {enabled && <span className="taste-checkbox__active-indicator" />}
            </label>
          ))}
        </div>
      </div>

      {/* EQ body */}
      <div className="eq-body">
        {/* Frequency response curve */}
        <EQCurve gains={effectiveGains} />

        {/* Band sliders */}
        <div className="eq-bands" role="group" aria-label="EQ bands">
          {gains.map((baseGain, i) => {
            const effectiveGain = effectiveGains[i];
            return (
              <div className="eq-band" key={ISO_BANDS[i]}>
                {/* Gain readout (shows effective = base + taste) */}
                <div className={`eq-band__gain ${gainClass(effectiveGain)}`}>
                  {formatGain(effectiveGain)}
                </div>

                {/* Slider */}
                <div className="eq-band__slider-wrap">
                  <div className="eq-center-line" />
                  <input
                    className="eq-band__slider"
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    value={baseGain}
                    disabled={isReadOnly}
                    onChange={(e) =>
                      handleBandChange(i, parseFloat(e.target.value))
                    }
                    aria-label={`${BAND_LABELS[i]} Hz, ${formatGain(effectiveGain)} dB`}
                  />
                </div>

                {/* Frequency label */}
                <div className="eq-band__freq">{BAND_LABELS[i]}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Preset strip */}
      <div className="preset-strip" role="list" aria-label="EQ presets">
        {PRESETS.map((p) => (
          <button
            key={p}
            role="listitem"
            className={`preset-chip${activePreset === p ? " preset-chip--active" : ""}`}
            onClick={() => handlePresetClick(p)}
            aria-pressed={activePreset === p}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
