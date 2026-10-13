/**
 * ISO 266 third-octave centre frequencies used by the 31-band EQ.
 *
 * These live outside the EQ component so the audio layers can depend on the
 * band grid without importing a React component.
 */

export const ISO_BANDS: readonly number[] = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
];

/** Short labels that fit a narrow band column without wrapping. */
export const BAND_LABELS: readonly string[] = [
  "20", "25", "31", "40", "50", "63", "80", "100", "125", "160",
  "200", "250", "315", "400", "500", "630", "800", "1k", "1.25k", "1.6k",
  "2k", "2.5k", "3.15k", "4k", "5k", "6.3k", "8k", "10k", "12.5k", "16k", "20k",
];

export const BAND_COUNT = 31;

/** Hz → normalised x position on a log-frequency axis (0..1). */
export function freqToX(hz: number, min = 20, max = 20000): number {
  return Math.log(hz / min) / Math.log(max / min);
}

export const MIN_FREQ = 20;
export const MAX_FREQ = 20000;

export const MAX_GAIN_DB = 12;
