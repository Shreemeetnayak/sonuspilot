import { ISO_BANDS, BuiltinPresetName, BUILTIN_PRESET_GAINS, TastePreferences, type SubgenreWeight } from "../components/Equalizer31Band";
export type { TastePreferences, SubgenreWeight };

// ── Types ──────────────────────────────────────────────────────────────────

export interface CloudEQProfile {
  id: string;
  headphoneId: string;
  headphoneBrand: string;
  headphoneModel: string;
  genre: string;
  subgenres: { name: string; weight: number }[];
  basePreset: BuiltinPresetName;
  tasteOverrides: Partial<TastePreferences>;
  gains: number[];
  confidence: number; // 0-1, how many users validated this
  sampleCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface UserFeedback {
  id: string;
  headphoneId: string;
  trackId: string;
  genre: string;
  subgenres: { name: string; weight: number }[];
  baseGains: number[];
  taste: TastePreferences;
  rating: FeedbackRating;
  timestamp: number;
}

export type FeedbackRating = "flat" | "muddy" | "sharp" | "warm" | "neutral" | "good";

// Correction vectors for each rating (per-band adjustments in dB)
const FEEDBACK_CORRECTIONS: Record<FeedbackRating, number[]> = {
  flat: ISO_BANDS.map((f) => (f >= 200 && f <= 4000 ? 0.5 : f >= 5000 ? -0.5 : 0)),
  muddy: ISO_BANDS.map((f) => (f >= 200 && f <= 500 ? -1.5 : f >= 1000 && f <= 3000 ? 1 : 0)),
  sharp: ISO_BANDS.map((f) => (f >= 4000 && f <= 12000 ? -2 : f >= 14000 ? -1 : 0)),
  warm: ISO_BANDS.map((f) => (f >= 100 && f <= 500 ? -1 : f >= 2000 && f <= 5000 ? 0.5 : 0)),
  neutral: ISO_BANDS.map((f) => (f >= 200 && f <= 4000 ? -0.5 : 0)),
  good: ISO_BANDS.map(() => 0), // No change - reinforces current profile
};

// Everything here is local. There is no remote profile service, so a curve is
// only ever built from what this machine has measured and what the user has said.
const FEEDBACK_KEY = "sonuspilot-user-feedback";
const LEARNED_PROFILE_KEY = "sonuspilot-learned-profiles";

// ── Local Feedback & Learned Profiles ──────────────────────────────────────

export function getUserFeedback(): UserFeedback[] {
  try {
    const stored = localStorage.getItem(FEEDBACK_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveUserFeedback(feedback: UserFeedback[]): void {
  localStorage.setItem(FEEDBACK_KEY, JSON.stringify(feedback));
}

export function addUserFeedback(feedback: Omit<UserFeedback, "id" | "timestamp">): void {
  const all = getUserFeedback();
  all.push({ ...feedback, id: crypto.randomUUID(), timestamp: Date.now() });
  saveUserFeedback(all);
}

export function getLearnedProfiles(): Record<string, CloudEQProfile> {
  try {
    const stored = localStorage.getItem(LEARNED_PROFILE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export function saveLearnedProfiles(all: Record<string, CloudEQProfile>): void {
  localStorage.setItem(LEARNED_PROFILE_KEY, JSON.stringify(all));
}
export function clearLearnedData(): void {
  localStorage.removeItem(FEEDBACK_KEY);
  localStorage.removeItem(LEARNED_PROFILE_KEY);
}

export function saveLearnedProfile(key: string, profile: CloudEQProfile): void {
  const all = getLearnedProfiles();
  all[key] = profile;
  localStorage.setItem(LEARNED_PROFILE_KEY, JSON.stringify(all));
}

// ── Learning Engine ────────────────────────────────────────────────────────

/**
 * Apply feedback corrections to base gains
 */
export function applyFeedbackCorrections(
  baseGains: number[],
  feedbackHistory: UserFeedback[]
): number[] {
  if (!feedbackHistory.length) return baseGains;

  // Weight recent feedback more heavily
  const now = Date.now();
  const weights = feedbackHistory.map((f) => {
    const ageHours = (now - f.timestamp) / (1000 * 60 * 60);
    return Math.exp(-ageHours / 168); // Half-life of 1 week
  });

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) return baseGains;

  // Compute weighted average correction
  const correction = ISO_BANDS.map((_, i) => {
    let weightedSum = 0;
    feedbackHistory.forEach((f, idx) => {
      const corr = FEEDBACK_CORRECTIONS[f.rating][i];
      weightedSum += corr * weights[idx];
    });
    return weightedSum / totalWeight;
  });

  // Apply correction, clamped to reasonable range
  return baseGains.map((gain, i) => Math.max(-12, Math.min(12, gain + correction[i] * 0.5)));
}

/**
 * Learn EQ profile from user feedback for a specific headphone/genre combo
 */
export function learnProfile(
  headphoneId: string,
  genre: string,
  subgenres: { name: string; weight: number }[],
  baseGains: number[],
  baseTaste: TastePreferences,
  feedbackHistory: UserFeedback[]
): CloudEQProfile {
  const learnedGains = applyFeedbackCorrections(baseGains, feedbackHistory);

  // Determine best matching preset
  let bestPreset: BuiltinPresetName = "Dream Pop";
  let minDiff = Infinity;
  for (const preset of Object.keys(BUILTIN_PRESET_GAINS) as BuiltinPresetName[]) {
    const diff = BUILTIN_PRESET_GAINS[preset].reduce((sum, g, i) => sum + Math.abs(g - learnedGains[i]), 0);
    if (diff < minDiff) {
      minDiff = diff;
      bestPreset = preset;
    }
  }

  return {
    id: `learned-${headphoneId}-${genre}-${Date.now()}`,
    headphoneId,
    headphoneBrand: "",
    headphoneModel: "",
    genre,
    subgenres,
    basePreset: bestPreset,
    tasteOverrides: baseTaste,
    gains: learnedGains,
    confidence: Math.min(feedbackHistory.length / 20, 1),
    sampleCount: feedbackHistory.length,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Get the best available EQ for the current context.
 *
 * Local-only: a learned profile this device has enough feedback for, otherwise
 * the built-in preset. There is no third source to wait on, so this is
 * synchronous — callers may still `await` it.
 */
export function getBestEQForContext(
  headphoneId: string,
  genre: string,
  subgenres: { name: string; weight: number }[],
  basePreset: BuiltinPresetName = "Dream Pop",
  baseTaste: TastePreferences = {
    bassBoost: false,
    vocalClarity: false,
    trebleAir: false,
    warmth: false,
    presence: false,
    subBass: false,
  }
): { gains: number[]; source: "learned" | "builtin"; profile?: CloudEQProfile } {
  const learned = getLearnedProfiles();
  const learnedKey = `${headphoneId}:${genre}`;
  if (learned[learnedKey] && learned[learnedKey].sampleCount >= 3) {
    return { gains: learned[learnedKey].gains, source: "learned", profile: learned[learnedKey] };
  }

  // 3. Builtin fallback with subgenres metadata preserved
  const baseGains = BUILTIN_PRESET_GAINS[basePreset] || BUILTIN_PRESET_GAINS["Dream Pop"];
  return {
    gains: baseGains,
    source: "builtin",
    profile: {
      id: `builtin-${headphoneId}-${genre}`,
      headphoneId,
      headphoneBrand: "",
      headphoneModel: "",
      genre,
      subgenres: subgenres || [],
      basePreset,
      tasteOverrides: baseTaste,
      gains: baseGains,
      confidence: 0.5,
      sampleCount: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  };
}