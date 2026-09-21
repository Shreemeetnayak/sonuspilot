import { ISO_BANDS, BuiltinPresetName, BUILTIN_PRESET_GAINS, TastePreferences } from "../components/Equalizer31Band";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CloudEQProfile {
  id: string;
  headphoneId: string;
  headphoneBrand: string;
  headphoneModel: string;
  genre: string;
  subgenres: string[];
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
  subgenres: string[];
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

const CLOUD_API_BASE = import.meta.env.VITE_CLOUD_API_URL || "https://api.sonuspilot.dev";
const CACHE_KEY = "sonuspilot-cloud-eq-cache";
const FEEDBACK_KEY = "sonuspilot-user-feedback";
const LEARNED_PROFILE_KEY = "sonuspilot-learned-profiles";

// ── Cloud API ──────────────────────────────────────────────────────────────

async function fetchFromCloud<T>(endpoint: string, options?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${CLOUD_API_BASE}${endpoint}`, {
      headers: { "Content-Type": "application/json", ...options?.headers },
      ...options,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchHeadphoneProfiles(
  headphoneId: string,
  genre?: string
): Promise<CloudEQProfile[]> {
  const params = new URLSearchParams({ headphoneId });
  if (genre) params.set("genre", genre);
  return (await fetchFromCloud<CloudEQProfile[]>(`/eq/profiles?${params}`)) || [];
}

export async function fetchBestProfile(
  headphoneId: string,
  genre: string,
  subgenres: string[]
): Promise<CloudEQProfile | null> {
  const profiles = await fetchHeadphoneProfiles(headphoneId, genre);
  if (!profiles.length) return null;

  // Score profiles by subgenre match + confidence + sample count
  return profiles.reduce((best, p) => {
    const subgenreMatch = subgenres.filter((s) => p.subgenres.includes(s)).length / Math.max(1, subgenres.length);
    const score = p.confidence * 0.5 + subgenreMatch * 0.3 + Math.min(p.sampleCount / 100, 1) * 0.2;
    const bestScore = best.confidence * 0.5 +
      (subgenres.filter((s) => best.subgenres.includes(s)).length / Math.max(1, subgenres.length)) * 0.3 +
      Math.min(best.sampleCount / 100, 1) * 0.2;
    return score > bestScore ? p : best;
  });
}

export async function submitFeedback(feedback: Omit<UserFeedback, "id" | "timestamp">): Promise<boolean> {
  const payload = { ...feedback, id: crypto.randomUUID(), timestamp: Date.now() };
  const res = await fetch(`${CLOUD_API_BASE}/eq/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

// ── Local Cache & Learning ────────────────────────────────────────────────

export function getCachedProfiles(): CloudEQProfile[] {
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function cacheProfiles(profiles: CloudEQProfile[]): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(profiles));
}

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
  subgenres: string[],
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
 * Get the best available EQ for current context (cloud + learned + builtin fallback)
 */
export async function getBestEQForContext(
  headphoneId: string,
  genre: string,
  subgenres: string[],
  basePreset: BuiltinPresetName,
  baseTaste: TastePreferences
): Promise<{ gains: number[]; source: "cloud" | "learned" | "builtin"; profile?: CloudEQProfile }> {
  // 1. Try cloud
  const cloudProfile = await fetchBestProfile(headphoneId, genre, subgenres);
  if (cloudProfile && cloudProfile.confidence > 0.3) {
    return { gains: cloudProfile.gains, source: "cloud", profile: cloudProfile };
  }

  // 2. Try learned local profile
  const learned = getLearnedProfiles();
  const learnedKey = `${headphoneId}:${genre}`;
  if (learned[learnedKey] && learned[learnedKey].sampleCount >= 3) {
    return { gains: learned[learnedKey].gains, source: "learned", profile: learned[learnedKey] };
  }

  // 3. Fall back to builtin preset
  return { gains: BUILTIN_PRESET_GAINS[basePreset], source: "builtin" };
}