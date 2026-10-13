import { type SoundFeedback } from "./learningService";

export interface PerceptualFeedbackEvent {
  schemaVersion: "1.0.0";
  timestamp: number;
  feedbackType: SoundFeedback;
  headphoneProfileId: string;
  outputDeviceId: string | null;
  genre: string | null;
  subgenre: { name: string; weight: number } | null;
  baselineEq: [number, ...number[]];
  learnedEqBefore: [number, ...number[]];
  learnedEqAfter: [number, ...number[]];
  feedbackDelta: [number, ...number[]];
  trackIdentifier: string | null;
  artistIdentifier: string | null;
  featureContextStatus: "missing";
  featureSchemaVersion: string;
  provenance: string;
  appVersion: string;
}
