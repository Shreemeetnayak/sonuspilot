import { ISO_BANDS } from "../components/Equalizer31Band";

export type TargetCurve = "harman-over-ear" | "harman-in-ear" | "diffuse-field" | "free-field" | "custom";

export interface HeadphoneCorrectionSettings {
  targetCurve: TargetCurve;
  correctionStrength: number;
  bassAdjustmentDb: number;
  trebleAdjustmentDb: number;
  smoothingOctaves: number;
  maximumCorrectionDb: number;
}

export interface HeadphoneProfileData {
  id: string;
  brand: string;
  model: string;
  // Measured response relative to selected reference. Positive = measured energy above reference.
  referenceSignature: number[];
  headroomDb: number;
  targetHeadroom: number;
  compensatedGains?: number[];
  correction: HeadphoneCorrectionSettings;
  measurementSource?: string;
  measurementConfidence: "unknown" | "estimated" | "measured";
}

export interface OutputDeviceHeadphoneMapping {
  outputDeviceId: string;
  headphoneProfileId: string;
  updatedAt: number;
}

const PROFILE_STORAGE_KEY = "sonuspilot_headphone_profiles";
const MAPPING_STORAGE_KEY = "sonuspilot_output_headphone_mappings";

const DEFAULT_CORRECTION: HeadphoneCorrectionSettings = {
  targetCurve: "harman-over-ear",
  correctionStrength: 1,
  bassAdjustmentDb: 0,
  trebleAdjustmentDb: 0,
  smoothingOctaves: 0.33,
  maximumCorrectionDb: 8,
};

export function getProfiles(): HeadphoneProfileData[] {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as HeadphoneProfileData[]) : [];
  } catch {
    return [];
  }
}

export function saveProfile(profile: HeadphoneProfileData): boolean {
  if (profile.referenceSignature.length !== ISO_BANDS.length) return false;
  try {
    const profiles = getProfiles();
    const index = profiles.findIndex((item) => item.id === profile.id);
    const next = index >= 0
      ? profiles.map((item) => item.id === profile.id ? profile : item)
      : [...profiles, profile];
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export function getProfile(profileId: string): HeadphoneProfileData | undefined {
  return getProfiles().find((profile) => profile.id === profileId);
}

export function getProfileByName(brand: string, model: string): HeadphoneProfileData | undefined {
  return getProfiles().find(
    (profile) => profile.brand.toLowerCase() === brand.toLowerCase() && profile.model.toLowerCase() === model.toLowerCase(),
  );
}

export function getDeviceMappings(): OutputDeviceHeadphoneMapping[] {
  try {
    const raw = localStorage.getItem(MAPPING_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OutputDeviceHeadphoneMapping[]) : [];
  } catch {
    return [];
  }
}

export function mapOutputDeviceToHeadphone(outputDeviceId: string, headphoneProfileId: string): boolean {
  if (!getProfile(headphoneProfileId)) return false;
  try {
    const mapping: OutputDeviceHeadphoneMapping = {
      outputDeviceId,
      headphoneProfileId,
      updatedAt: Date.now(),
    };
    const existing = getDeviceMappings();
    const next = existing.some((item) => item.outputDeviceId === outputDeviceId)
      ? existing.map((item) => item.outputDeviceId === outputDeviceId ? mapping : item)
      : [...existing, mapping];
    localStorage.setItem(MAPPING_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export function getMappedProfile(outputDeviceId: string): HeadphoneProfileData | undefined {
  const mapping = getDeviceMappings().find((item) => item.outputDeviceId === outputDeviceId);
  return mapping ? getProfile(mapping.headphoneProfileId) : undefined;
}

export function createUnmeasuredProfile(brand: string, model: string): HeadphoneProfileData {
  return {
    id: crypto.randomUUID(),
    brand: brand.trim(),
    model: model.trim(),
    referenceSignature: new Array(ISO_BANDS.length).fill(0),
    headroomDb: 0,
    targetHeadroom: -3,
    correction: { ...DEFAULT_CORRECTION },
    measurementConfidence: "unknown",
  };
}

export function removeProfile(profileId: string): boolean {
  try {
    const nextProfiles = getProfiles().filter((profile) => profile.id !== profileId);
    const nextMappings = getDeviceMappings().filter((mapping) => mapping.headphoneProfileId !== profileId);
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(nextProfiles));
    localStorage.setItem(MAPPING_STORAGE_KEY, JSON.stringify(nextMappings));
    return true;
  } catch {
    return false;
  }
}
