import { describe, expect, it, beforeEach, vi } from "vitest";
import { applyFeedback, getLearnedProfiles, saveLearnedProfile, LearningState } from "../learningService";
import { computeFinalEQ, buildHeadphoneCorrection, buildMusicReference, buildUserPreference } from "../eqDecisionEngine";

const HP = "test-headphone";
const GENRE = "Rock";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value.toString(); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; }
  };
})();
vi.stubGlobal('localStorage', localStorageMock);

function runDecision(learnedGains: number[]) {
    return computeFinalEQ(
        buildHeadphoneCorrection(undefined),
        buildMusicReference(null),
        buildUserPreference({}, {}),
        { source: "learned", gains: learnedGains, confidence: 1.0 },
        { source: "none", gains: new Array(31).fill(0), confidence: 0 }
    );
}

describe("Sound Feedback Regression Test", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("satisfies the initialState -> submitFeedback -> decide() lifecycle", async () => {
        // Initial state
        let state: LearningState = {
            profileId: `${HP}::${GENRE}`,
            headphoneId: HP,
            genre: GENRE,
            learnedGains: new Array(31).fill(0),
            sampleCount: 0,
            updatedAt: 0
        };
        saveLearnedProfile(state);

        const decisionA = runDecision(state.learnedGains);

        // Submit "muddy" feedback
        state = await applyFeedback(state, "muddy", state.learnedGains);
        saveLearnedProfile(state);

        // Decide again
        const decisionB = runDecision(state.learnedGains);

        // Assert EQ changed
        expect(decisionB.finalGains).not.toEqual(decisionA.finalGains);

        // Assert difference is in the expected region (low-mids: 12-16)
        // Muddy: delta is negative
        for (let i = 12; i <= 16; i++) {
            expect(decisionB.finalGains[i]).toBeLessThan(decisionA.finalGains[i]);
        }

        // Reload state and ensure it produces the exact same decisionB
        const reloaded = getLearnedProfiles()[state.profileId];
        const decisionReloaded = runDecision(reloaded.learnedGains);
        expect(decisionReloaded.finalGains).toEqual(decisionB.finalGains);
    });
});
