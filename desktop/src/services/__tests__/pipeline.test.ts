import { describe, expect, it, beforeEach } from "vitest";
import { computeFinalEQ, buildHeadphoneCorrection, buildLearnedPreference, buildMusicReference, buildUserPreference, type EQDecision } from "../eqDecisionEngine";
import { addUserFeedback, getBestEQForContext, getUserFeedback, clearLearnedData } from "../cloudEqService";
import { classifyTrack } from "../musicClassifierService";
import { createUnmeasuredProfile, mapOutputDeviceToHeadphone, getMappedProfile, saveProfile } from "../headphoneProfileService";
import { getAppSettings, saveAppSettings, DEFAULT_SETTINGS } from "../appSettingsService";
import { ISO_BANDS } from "../../components/Equalizer31Band";

const HP = "test-headphone";
const GENRE = "Jazz";

function baseGains() {
  return new Array(31).fill(0).map((_, i) => (i % 5) - 2);
}

function taste(overrides: Partial<Record<string, boolean>> = {}) {
  return { bassBoost: false, vocalClarity: false, trebleAir: false, warmth: false, presence: false, subBass: false, ...overrides };
}

describe("headphone profile persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    clearLearnedData();
  });

  it("persists an output-device to headphone mapping and restores it", () => {
    const profile = createUnmeasuredProfile("Sennheiser", "HD 600");
    expect(saveProfile(profile)).toBe(true);
    expect(mapOutputDeviceToHeadphone("endpoint-A", profile.id)).toBe(true);

    const restored = getMappedProfile("endpoint-A");
    expect(restored?.brand).toBe("Sennheiser");
    expect(restored?.model).toBe("HD 600");
  });

  it("returns undefined for an unmapped output device", () => {
    expect(getMappedProfile("endpoint-unknown")).toBeUndefined();
  });

  it("marks an unmeasured profile so no correction is invented", () => {
    const layer = buildHeadphoneCorrection(createUnmeasuredProfile("Generic", "Anker"));
    expect(layer.gains.every((g) => g === 0)).toBe(true);
    expect(layer.confidence).toBe(0);
  });
});

describe("music classification from metadata only", () => {
  it("produces a weighted mixture rather than one label", () => {
    const mixture = classifyTrack({ title: "Master of Puppets", artist: "Metallica", album: "Ride the Lightning" });
    expect(mixture.length).toBeGreaterThan(0);
    expect(mixture[0].name).toContain("Metal");
    const total = mixture.reduce((sum, item) => sum + item.weight, 0);
    expect(total).toBeCloseTo(1, 2);
  });

  it("returns an empty mixture instead of guessing", () => {
    expect(classifyTrack({ title: "asdfgh", artist: "qwerty", album: "zxcvbn" })).toEqual([]);
  });

  it("returns an empty mixture for empty metadata", () => {
    expect(classifyTrack({ title: "", artist: "", album: "" })).toEqual([]);
  });
});

describe("decision pipeline", () => {
  beforeEach(() => {
    localStorage.clear();
    clearLearnedData();
  });

  it("produces 31 bands and a headroom-derived preamp", () => {
    const decision = computeFinalEQ(
      buildHeadphoneCorrection(undefined),
      buildMusicReference(null),
      buildUserPreference({}, {}),
      buildLearnedPreference(HP, GENRE, baseGains()),
      { source: "none", gains: new Array(31).fill(0), confidence: 0 }
    );
    expect(decision.finalGains).toHaveLength(31);
    const maxBoost = Math.max(...decision.finalGains);
    expect(decision.preamp).toBeLessThanOrEqual(0);
    if (maxBoost > 0) expect(decision.preamp).toBeLessThanOrEqual(-3);
  });

  it("clamps every band to the configured maximum correction", () => {
    const decision: EQDecision = computeFinalEQ(
      buildHeadphoneCorrection(undefined),
      { source: "test", gains: new Array(31).fill(40), confidence: 1 },
      buildUserPreference({}, {}),
      buildLearnedPreference(HP, GENRE, baseGains()),
      { source: "none", gains: new Array(31).fill(0), confidence: 0 }
    );
    expect(Math.max(...decision.finalGains)).toBeLessThanOrEqual(10);
    expect(Math.min(...decision.finalGains)).toBeGreaterThanOrEqual(-10);
  });

  it("keeps every layer separate in the decision record", () => {
    const decision = computeFinalEQ(
      buildHeadphoneCorrection(undefined),
      buildMusicReference(null),
      buildUserPreference({}, {}),
      buildLearnedPreference(HP, GENRE, baseGains()),
      { source: "none", gains: new Array(31).fill(0), confidence: 0 }
    );
    for (const layer of [decision.headphoneCorrection, decision.musicReference, decision.userPreference, decision.learnedPreference, decision.modelResidual]) {
      expect(layer.gains).toHaveLength(31);
      expect(typeof layer.source).toBe("string");
    }
  });
});

describe("learning affects the calculation", () => {
  beforeEach(() => {
    localStorage.clear();
    clearLearnedData();
  });

  it("produces identical output with no feedback", () => {
    const a = computeFinalEQ(
      buildHeadphoneCorrection(undefined),
      buildMusicReference(null),
      buildUserPreference({}, {}),
      buildLearnedPreference(HP, GENRE, baseGains()),
    );
    const b = computeFinalEQ(
      buildHeadphoneCorrection(undefined),
      buildMusicReference(null),
      buildUserPreference({}, {}),
      buildLearnedPreference(HP, GENRE, baseGains()),
    );
    expect(a.finalGains).toEqual(b.finalGains);
  });

  it("changes output measurably after the user says it is too sharp", async () => {
    const before = computeFinalEQ(
      buildHeadphoneCorrection(undefined),
      buildMusicReference(null),
      buildUserPreference({}, {}),
      buildLearnedPreference(HP, GENRE, baseGains()),
    );

    addUserFeedback({
      headphoneId: HP,
      trackId: "artist::title",
      genre: GENRE,
      subgenres: [{ name: GENRE, weight: 1 }],
      baseGains: baseGains(),
      taste: taste(),
      rating: "sharp",
    });
    expect(getUserFeedback().length).toBe(1);

    const after = computeFinalEQ(
      buildHeadphoneCorrection(undefined),
      buildMusicReference(null),
      buildUserPreference({}, {}),
      buildLearnedPreference(HP, GENRE, baseGains()),
    );

    expect(after.learnedPreference.confidence).toBeGreaterThan(0);
    expect(after.learnedPreference.gains.some((g) => g !== 0)).toBe(true);
    expect(after.finalGains).not.toEqual(before.finalGains);

    // "Sharp" must pull the upper bands down, not push them up.
    const upper = after.finalGains.slice(23, 31).reduce((s, g) => s + g, 0);
    const upperBefore = before.finalGains.slice(23, 31).reduce((s, g) => s + g, 0);
    expect(upper).toBeLessThan(upperBefore);
  });

  it("does not leak feedback between genres", () => {
    addUserFeedback({
      headphoneId: HP,
      trackId: "artist::title",
      genre: "Jazz",
      subgenres: [],
      baseGains: baseGains(),
      taste: taste(),
      rating: "sharp",
    });
    const other = buildLearnedPreference(HP, "EDM", baseGains());
    expect(other.gains.every((g) => g === 0)).toBe(true);
    expect(other.confidence).toBe(0);
  });
});

describe("context resolution falls back safely", () => {
  beforeEach(() => {
    localStorage.clear();
    clearLearnedData();
  });

  it("returns a usable profile when nothing is known", async () => {
    const result = await getBestEQForContext("unmapped", "unknown", []);
    expect(result.gains).toHaveLength(ISO_BANDS.length);
    expect(result.source).toBe("builtin");
  });
});

describe("settings are readable and writable", () => {
  beforeEach(() => localStorage.clear());

  it("returns defaults when nothing is stored", () => {
    expect(getAppSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips a changed value", () => {
    saveAppSettings({ ...DEFAULT_SETTINGS, autoEqEnabled: false });
    expect(getAppSettings().autoEqEnabled).toBe(false);
  });
});
