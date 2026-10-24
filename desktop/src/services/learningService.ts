import { invoke } from "@tauri-apps/api/core";
import { PerceptualFeedbackEvent } from "./eventSchema";

export type SoundFeedback = "flat" | "muddy" | "sharp" | "warm" | "neutral";

export interface LearningState {
  profileId: string;
  headphoneId: string;
  genre: string;
  learnedGains: number[];
  sampleCount: number;
  updatedAt: number;
}

// Independent conservative bound (±3dB per band)
export const MAX_LEARNED_FEEDBACK_DB = 3.0;
const LEARNING_RATE = 0.2; // Small update step

/**
 * Computes a smooth 31-band delta based on perceptual hypothesis.
 * Mappings are conservative perceptual hypotheses, not universal truths.
 * Contradictory feedback is naturally handled by adding deltas (cancellation).
 */
export function computeFeedbackDelta(feedback: SoundFeedback): number[] {
  const delta = new Array(31).fill(0);

  switch (feedback) {
    case "muddy":
      // "Too much low-mid masking": Reduce 315Hz-800Hz (indices 12-16)
      delta[12] = -0.3; delta[13] = -0.5; delta[14] = -0.6; delta[15] = -0.5; delta[16] = -0.3;
      break;
    case "sharp":
      // "Too much presence/harshness": Reduce 3.15kHz-8kHz (indices 22-26)
      delta[22] = -0.3; delta[23] = -0.5; delta[24] = -0.6; delta[25] = -0.5; delta[26] = -0.3;
      break;
    case "warm":
      // "Lacks body": Gently boost lower-mids/bass (80Hz-400Hz, indices 6-13)
      delta[9] = 0.2; delta[10] = 0.4; delta[11] = 0.5; delta[12] = 0.4; delta[13] = 0.2;
      break;
    case "flat":
      // "Lacks character/depth": Gentle wide lift
      delta[0] = 0.2; delta[1] = 0.3; delta[26] = 0.2; delta[27] = 0.3;
      break;
    case "neutral":
      // "Acceptable presentation": Reinforce current state (no change)
      return new Array(31).fill(0);
  }
  return delta.map(v => v * LEARNING_RATE);
}

export async function applyFeedback(state: LearningState, feedback: SoundFeedback, baselineEq: number[]): Promise<LearningState> {
  const delta = computeFeedbackDelta(feedback);
  const updatedGains = state.learnedGains.map((g, i) => {
    // Add delta, then apply independent learned-feedback clamp
    const nextGain = g + delta[i];
    return Math.max(-MAX_LEARNED_FEEDBACK_DB, Math.min(MAX_LEARNED_FEEDBACK_DB, nextGain));
  });

  // Emit canonical event asynchronously
  const event: PerceptualFeedbackEvent = {
    schemaVersion: "1.0.0",
    timestamp: Date.now(),
    feedbackType: feedback,
    headphoneProfileId: state.headphoneId,
    outputDeviceId: null,
    genre: state.genre,
    subgenre: null,
    baselineEq: baselineEq as [number, ...number[]],
    learnedEqBefore: state.learnedGains as [number, ...number[]],
    learnedEqAfter: updatedGains as [number, ...number[]],
    feedbackDelta: delta as [number, ...number[]],
    trackIdentifier: null,
    artistIdentifier: null,
    featureContextStatus: "missing",
    featureSchemaVersion: "n/a",
    provenance: "sonuspilot-desktop-v0.1",
    appVersion: "0.1.0",
  };
  try {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      await invoke("append_feedback_event", { event });
    }
  } catch (e) {
    console.error("Failed to persist feedback event", e);
  }

  return {
    ...state,
    learnedGains: updatedGains,
    sampleCount: state.sampleCount + 1,
    updatedAt: Date.now()
  };
}

export function getLearnedProfiles(): Record<string, LearningState> {
  try {
    const raw = localStorage.getItem("sonuspilot-learned-profiles");
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function getLearnedIndicators(profileId: string): { active: boolean; confidence: number } {
  const profiles = getLearnedProfiles();
  const state = profiles[profileId];
  return {
    active: !!state && state.sampleCount > 0,
    confidence: state ? Math.min(state.sampleCount / 10, 1.0) : 0,
  };
}

export function saveLearnedProfile(state: LearningState) {
  const all = getLearnedProfiles();
  all[state.profileId] = state;
  localStorage.setItem("sonuspilot-learned-profiles", JSON.stringify(all));
}

export function clearLearnedData() {
    localStorage.removeItem("sonuspilot-learned-profiles");
}
