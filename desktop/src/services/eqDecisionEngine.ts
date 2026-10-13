import { applyFeedbackCorrections, getUserFeedback, type CloudEQProfile } from "./cloudEqService";
import { ISO_BANDS } from "../components/Equalizer31Band";
import { type HeadphoneProfileData } from "./headphoneProfileService";
import { invoke } from "@tauri-apps/api/core";

export interface EQLayer {
  source: string;
  gains: number[];
  confidence: number;
}

export interface EQDecision {
  headphoneCorrection: EQLayer;
  musicReference: EQLayer;
  userPreference: EQLayer;
  learnedPreference: EQLayer;
  modelResidual: EQLayer;
  finalGains: number[];
  preamp: number;
  confidence: number;
}

const MAX_CORRECTION_DB = 6;
const MIN_CORRECTION_DB = -12;
const SAFETY_HEADROOM_DB = -3;

function clampGains(gains: number[], maxDb: number = MAX_CORRECTION_DB, minDb: number = MIN_CORRECTION_DB): number[] {
  return gains.map(g => Math.max(minDb, Math.min(maxDb, g)));
}

function computePreamp(gains: number[]): number {
  const maxBoost = Math.max(0, ...gains);
  return Math.min(0, SAFETY_HEADROOM_DB - maxBoost);
}

export function buildHeadphoneCorrection(profile?: HeadphoneProfileData): EQLayer {
  const neutral = (): EQLayer => ({ source: "none", gains: new Array(31).fill(0), confidence: 0 });
  if (!profile?.referenceSignature || profile.referenceSignature.length !== 31) return neutral();

  // A zero signature cannot mean both "measured and perfectly flat" and
  // "never measured". Only trust a profile that declares a measurement, and
  // weight how much that measurement can be trusted.
  const confidenceBySource = { measured: 0.8, estimated: 0.4, unknown: 0 } as const;
  const confidence = confidenceBySource[profile.measurementConfidence];
  if (confidence === 0) return neutral();

  const settings = profile.correction;
  const correction = profile.referenceSignature.map((deviation, index) => {
    const frequency = ISO_BANDS[index];
    const bassTilt = frequency < 200 ? settings.bassAdjustmentDb : 0;
    const trebleTilt = frequency >= 5000 ? settings.trebleAdjustmentDb : 0;
    return (-deviation * settings.correctionStrength + bassTilt + trebleTilt);
  });
  return {
    source: `${profile.brand} ${profile.model}`,
    gains: clampGains(correction, settings.maximumCorrectionDb),
    confidence,
  };
}

export function buildMusicReference(cloudProfile?: CloudEQProfile | null): EQLayer {
  if (!cloudProfile?.gains || cloudProfile.gains.length !== 31) {
    return { source: "neutral", gains: new Array(31).fill(0), confidence: 0 };
  }
  return {
    source: cloudProfile.genre || "detected",
    gains: [...cloudProfile.gains],
    confidence: cloudProfile.confidence ?? 0.5,
  };
}

export function buildUserPreference(taste: Record<string, boolean>, tasteOffsets: Record<string, number[]>): EQLayer {
  const gains = new Array(31).fill(0);
  for (const [key, enabled] of Object.entries(taste)) {
    if (enabled && tasteOffsets[key]) {
      for (let i = 0; i < 31; i++) {
        gains[i] += tasteOffsets[key][i] ?? 0;
      }
    }
  }
  return { source: "taste", gains, confidence: 1.0 };
}

export function buildLearnedPreference(headphoneId: string, genre: string, baseGains: number[]): EQLayer {
  const feedback = getUserFeedback().filter(
    f => f.headphoneId === headphoneId && f.genre === genre
  );
  if (feedback.length === 0) {
    return { source: "none", gains: new Array(31).fill(0), confidence: 0 };
  }
  const learned = applyFeedbackCorrections(baseGains, feedback);
  const delta = learned.map((g, i) => g - baseGains[i]);
  return {
    source: `learned (${feedback.length} samples)`,
    gains: delta,
    confidence: Math.min(feedback.length / 20, 1),
  };
}

export function computeFinalEQ(
  headphoneCorrection: EQLayer,
  musicReference: EQLayer,
  userPreference: EQLayer,
  learnedPreference: EQLayer,
  modelResidual: EQLayer = { source: "none", gains: new Array(31).fill(0), confidence: 0 },
): EQDecision {
  const layers = [headphoneCorrection, musicReference, userPreference, learnedPreference, modelResidual];
  const finalGains = new Array(31).fill(0).map((_, i) =>
    layers.reduce((sum, layer) => sum + (layer?.gains?.[i] || 0), 0)
  );

  const clamped = clampGains(finalGains);
  return {
    headphoneCorrection,
    musicReference,
    userPreference,
    learnedPreference,
    modelResidual,
    finalGains: clamped,
    preamp: computePreamp(clamped),
    confidence: Math.max(...layers.map((l) => l?.confidence || 0)),
  };
}

export async function applyToEqualizerAPO(decision: EQDecision): Promise<boolean> {
  try {
    await invoke("apply_eq_profile", {
      payload: {
        name: "SonusPilot Auto-EQ",
        gains_db: decision.finalGains,
        preamp_db: decision.preamp,
      },
    });
    return true;
  } catch {
    // Engine unavailable or rejected the profile: caller keeps the previous EQ.
    return false;
  }
}

export async function setNeutralEQ(): Promise<boolean> {
  try {
    await invoke("set_neutral_eq");
    return true;
  } catch {
    return false;
  }
}

export async function getEQEngineStatus(): Promise<boolean> {
  try {
    const status = await invoke<{ available: boolean }>("get_eq_engine_status");
    return Boolean(status?.available);
  } catch {
    return false;
  }
}
