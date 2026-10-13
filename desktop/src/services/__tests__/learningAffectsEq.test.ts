import { describe, expect, it, beforeEach } from "vitest";
import { addUserFeedback, getBestEQForContext, clearLearnedData, getLearnedProfiles } from "../cloudEqService";
import { computeFinalEQ, buildHeadphoneCorrection, buildLearnedPreference, buildMusicReference, buildUserPreference } from "../eqDecisionEngine";

const HP = "real-path-hp";
const GENRE = "Thrash Metal";

async function decide() {
  const music = await getBestEQForContext(HP, GENRE, [{ name: GENRE, weight: 1 }]);
  return computeFinalEQ(
    buildHeadphoneCorrection(undefined),
    buildMusicReference(music.profile ?? null),
    buildUserPreference({}, {}),
    buildLearnedPreference(HP, GENRE, music.gains),
    { source: "none", gains: new Array(31).fill(0), confidence: 0 }
  );
}

describe("feedback flows through the real service path", () => {
  beforeEach(() => {
    localStorage.clear();
    clearLearnedData();
  });

  it("changes the final curve after feedback, via getBestEQForContext", async () => {
    const before = await decide();
    expect(before.learnedPreference.gains.every((g) => g === 0)).toBe(true);

    addUserFeedback({
      headphoneId: HP,
      trackId: "Metallica::Enter Sandman",
      genre: GENRE,
      subgenres: [{ name: GENRE, weight: 1 }],
      baseGains: before.finalGains,
      taste: { bassBoost: false, vocalClarity: false, trebleAir: false, warmth: false, presence: false, subBass: false },
      rating: "muddy",
    });

    const after = await decide();
    expect(after.finalGains).not.toEqual(before.finalGains);
    // "Muddy" means the user wants less boom in the low mids.
    const lowMid = (g: number[]) => g.slice(10, 15).reduce((s, v) => s + v, 0);
    expect(lowMid(after.finalGains)).toBeLessThan(lowMid(before.finalGains));
  });

  it("keeps the stored feedback as the record of what was learned", () => {
    addUserFeedback({
      headphoneId: HP,
      trackId: "t",
      genre: GENRE,
      subgenres: [],
      baseGains: new Array(31).fill(0),
      taste: { bassBoost: false, vocalClarity: false, trebleAir: false, warmth: false, presence: false, subBass: false },
      rating: "flat",
    });
    expect(getLearnedProfiles()).toEqual({});
  });
});
