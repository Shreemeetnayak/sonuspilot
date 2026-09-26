// Shared EQ types and constants.
// Kept in its own module so services and components can both depend on it
// without creating a circular import.

/** ISO 266 31-band center frequencies (Hz) */
export const ISO_BANDS: readonly number[] = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
];

/** Compact labels for the 31 bands. */
export const BAND_LABELS: readonly string[] = [
  "20", "25", "31", "40", "50", "63", "80", "100", "125", "160",
  "200", "250", "315", "400", "500", "630", "800", "1k", "1.25k", "1.6k",
  "2k", "2.5k", "3.15k", "4k", "5k", "6.3k", "8k", "10k", "12.5k", "16k", "20k",
];

export type EQMode = "auto" | "manual" | "preset";

/** Qualitative listener preferences applied on top of the generated curve. */
export interface TastePreferences {
  bassBoost: boolean;
  vocalClarity: boolean;
  trebleAir: boolean;
  warmth: boolean;
  presence: boolean;
  subBass: boolean;
}

export const DEFAULT_TASTE: TastePreferences = {
  bassBoost: false,
  vocalClarity: false,
  trebleAir: false,
  warmth: false,
  presence: false,
  subBass: false,
};

export const TASTE_LABELS: Record<keyof TastePreferences, string> = {
  bassBoost: "Bass Boost (+2dB @ 40–160 Hz)",
  vocalClarity: "Vocal Clarity (+1.5dB @ 1–4 kHz)",
  trebleAir: "Treble Air (+1.5dB @ 8–16 kHz)",
  warmth: "Warmth (+1dB @ 200–500 Hz)",
  presence: "Presence (+1dB @ 3–6 kHz)",
  subBass: "Sub-Bass (+2dB @ 20–40 Hz)",
};

/** Per-band offset contributed by each taste toggle, in dB. */
export const TASTE_OFFSETS: Record<keyof TastePreferences, number[]> = {
  bassBoost:    [0, 0, 2, 2, 2, 1.5, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  vocalClarity: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 1, 1.5, 1.5, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  trebleAir:    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 1, 1.5, 1.5, 1, 0.5, 0, 0],
  warmth:       [0, 0, 0, 0, 0, 0, 0.5, 1, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  presence:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 1, 1, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  subBass:      [2, 2, 1.5, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

/** All-zero 31-band curve. */
export function neutralGains(): number[] {
  return new Array(31).fill(0);
}

export const NEUTRAL_GAINS: readonly number[] = neutralGains();
