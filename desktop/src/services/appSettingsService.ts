// Application settings — persisted and read by the runtime, not decoration.
// Every field here is consulted by App.tsx before a decision reaches the engine.

export interface AppSettings {
  autoEqEnabled: boolean;
  learningEnabled: boolean;
  feedbackEnabled: boolean;
  startMinimizedToTray: boolean;
  targetCurve: "harman-over-ear" | "harman-in-ear" | "diffuse-field" | "free-field" | "custom";
  correctionStrength: number;
  maximumCorrectionDb: number;
  autoDetectTracks: boolean;
  bypassOnError: boolean;
}

const STORAGE_KEY = "sonuspilot_app_settings";

export const DEFAULT_SETTINGS: AppSettings = {
  autoEqEnabled: true,
  learningEnabled: true,
  feedbackEnabled: true,
  startMinimizedToTray: false,
  targetCurve: "harman-over-ear",
  correctionStrength: 1,
  maximumCorrectionDb: 8,
  autoDetectTracks: true,
  bypassOnError: true,
};

export function getAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveAppSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked — settings stay in memory for this session.
  }
}

export function resetAppSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
