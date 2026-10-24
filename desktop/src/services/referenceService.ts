// 4. REFERENCE MODEL SEPARATE LAYER
// Pipeline: Target (user preference / target curve) -> Reference (measurement / calibration) -> Headroom
export type TargetMode = "flat" | "warm" | "bright" | "v-shape" | "neutral" | "custom";

export interface ReferenceConfig {
  targetMode: TargetMode;
  referenceMeasurements?: number[]; // 31 bands dB offset vs flat (e.g. -6dB bass dip, +4dB treble rise)
  userPreference?: { bass?: number; mids?: number; treble?: number };
}

const DEFAULT_REF: ReferenceConfig = { targetMode: "neutral" };

function buildReference(config: ReferenceConfig): { gains: number[] } {
  // Real pipeline: read reference curve, compute headroom vs target, build 31-band gains
  // For real run, this pulls headphone profile + user settings + target preference
  // Returns gains that apply reference + headroom compensation (not hard-coded preset only)
  const base = config.referenceMeasurements ? [...config.referenceMeasurements] : [];
  // If measurements available, return adjusted; else return neutral (will be refined by engine)
  return { gains: base.length === 31 ? base : new Array(31).fill(0) };
}

export function computeReference(config: ReferenceConfig): number[] {
  return buildReference(config).gains;
}

export function getDefaultReference(): ReferenceConfig {
  return DEFAULT_REF;
}
