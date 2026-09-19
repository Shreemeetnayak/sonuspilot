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

export type EQMode = "auto" | "manual" | "preset" | "neutral";

const PRESETS = [
  "Dream Pop", "EDM", "Thrash Metal", "Jazz", "Classical",
  "Hip-Hop", "Acoustic", "Podcast",
] as const;

export type PresetName = (typeof PRESETS)[number];

// ── Neutral (flat) gains ──────────────────────────────────────────────
const NEUTRAL_GAINS: number[] = new Array(31).fill(0);

// ── Demo preset shapes (illustrative, not authoritative) ──────────────
const PRESET_GAINS: Record<PresetName, number[]> = {
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

  const handleBandChange = useCallback(
    (index: number, value: number) => {
      if (mode === "auto" || mode === "neutral") return; // read-only in those modes
      setGains((prev) => {
        const next = [...prev];
        next[index] = value;
        onGainsChange?.(next);
        return next;
      });
      setActivePreset(null);
    },
    [mode, onGainsChange]
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
      </div>

      {/* EQ body */}
      <div className="eq-body">
        {/* Frequency response curve */}
        <EQCurve gains={gains} />

        {/* Band sliders */}
        <div className="eq-bands" role="group" aria-label="EQ bands">
          {gains.map((gain, i) => (
            <div className="eq-band" key={ISO_BANDS[i]}>
              {/* Gain readout */}
              <div className={`eq-band__gain ${gainClass(gain)}`}>
                {formatGain(gain)}
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
                  value={gain}
                  disabled={isReadOnly}
                  onChange={(e) =>
                    handleBandChange(i, parseFloat(e.target.value))
                  }
                  aria-label={`${BAND_LABELS[i]} Hz, ${formatGain(gain)} dB`}
                />
              </div>

              {/* Frequency label */}
              <div className="eq-band__freq">{BAND_LABELS[i]}</div>
            </div>
          ))}
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
