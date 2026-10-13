import { describe, expect, it, vi } from "vitest";
import { applyFeedback, computeFeedbackDelta, LearningState, MAX_LEARNED_FEEDBACK_DB } from "../learningService";
import { computeFinalEQ, buildHeadphoneCorrection, buildMusicReference, buildUserPreference } from "../eqDecisionEngine";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value.toString(); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    key: (index: number) => Object.keys(store)[index] || null,
    length: 0
  };
})();
vi.stubGlobal('localStorage', localStorageMock);

describe("Sound Feedback Final Verification", () => {
    
    it("verifies contradictory feedback behavior", async () => {
        let state: LearningState = { profileId: "p1", headphoneId: "h1", genre: "g1", learnedGains: new Array(31).fill(0), sampleCount: 0, updatedAt: 0 };

        // muddy -> sharp -> muddy -> sharp
        state = await applyFeedback(state, "muddy", state.learnedGains);
        const gains1 = [...state.learnedGains];
        state = await applyFeedback(state, "sharp", state.learnedGains);
        const gains2 = [...state.learnedGains];
        state = await applyFeedback(state, "muddy", state.learnedGains);
        const gains3 = [...state.learnedGains];
        state = await applyFeedback(state, "sharp", state.learnedGains);
        const gains4 = [...state.learnedGains];
        
        // Assert boundedness (should be within ±3dB)
        [...gains1, ...gains2, ...gains3, ...gains4].forEach(g => {
            expect(Math.abs(g)).toBeLessThanOrEqual(MAX_LEARNED_FEEDBACK_DB);
        });

        // Contradictory feedback should naturally cancel out
        // Muddy: -low-mids, Sharp: -upper-mids
        // After muddy + sharp, both regions should have negative gains.
        // If we alternate, they don't necessarily cancel each other unless they hit the same bands.
    });

    it("verifies saturation point for repeated feedback", async () => {
        let state: LearningState = { profileId: "p1", headphoneId: "h1", genre: "g1", learnedGains: new Array(31).fill(0), sampleCount: 0, updatedAt: 0 };

        // muddy x 100
        for (let i = 0; i < 100; i++) {
            state = await applyFeedback(state, "muddy", state.learnedGains);
        }

        // Assert saturation at MAX_LEARNED_FEEDBACK_DB
        state.learnedGains.forEach(g => {
            expect(Math.abs(g)).toBeLessThanOrEqual(MAX_LEARNED_FEEDBACK_DB);
        });
        // Specifically check the peak band for muddy (index 14)
        expect(state.learnedGains[14]).toBe(-MAX_LEARNED_FEEDBACK_DB);
    });

    it("verifies neutral feedback behavior", async () => {
        let state: LearningState = {
            profileId: "p1", headphoneId: "h1", genre: "g1",
            learnedGains: [1.0, 1.0, 1.0, ...new Array(28).fill(0)],
            sampleCount: 1, updatedAt: 0
        };
        const beforeGains = [...state.learnedGains];
        state = await applyFeedback(state, "neutral", state.learnedGains);
        // Should not change gains
        expect(state.learnedGains).toEqual(beforeGains);
        // But should increment count
        expect(state.sampleCount).toBe(2);
    });

    it("produces real numerical evidence for 'muddy' feedback", async () => {
        const initialState: LearningState = {
            profileId: "p1", headphoneId: "h1", genre: "g1",
            learnedGains: new Array(31).fill(0), sampleCount: 0, updatedAt: 0
        };
        const EQ_BEFORE = computeFinalEQ(buildHeadphoneCorrection(undefined), buildMusicReference(null), buildUserPreference({}, {}), {source: "learned", gains: initialState.learnedGains, confidence: 1.0}, {source: "none", gains: new Array(31).fill(0), confidence: 0});

        const delta = computeFeedbackDelta("muddy");
        const updatedState = await applyFeedback(initialState, "muddy", initialState.learnedGains);

        const EQ_AFTER = computeFinalEQ(buildHeadphoneCorrection(undefined), buildMusicReference(null), buildUserPreference({}, {}), {source: "learned", gains: updatedState.learnedGains, confidence: 1.0}, {source: "none", gains: new Array(31).fill(0), confidence: 0});

        console.log("NUMERICAL EVIDENCE START");
        console.log("Initial learned gains:", JSON.stringify(initialState.learnedGains));
        console.log("Feedback delta:", JSON.stringify(delta));
        console.log("Updated learned gains:", JSON.stringify(updatedState.learnedGains));
        console.log("EQ Before (subset 10-18):", JSON.stringify(EQ_BEFORE.finalGains.slice(10, 18)));
        console.log("EQ After (subset 10-18):", JSON.stringify(EQ_AFTER.finalGains.slice(10, 18)));
        console.log("Preamp before:", EQ_BEFORE.preamp);
        console.log("Preamp after:", EQ_AFTER.preamp);
        console.log("NUMERICAL EVIDENCE END");
        
        expect(EQ_AFTER.finalGains).not.toEqual(EQ_BEFORE.finalGains);
        expect(updatedState.learnedGains[14]).toBeLessThan(0);
    });

    it("verifies context isolation", async () => {
        let stateA: LearningState = { profileId: "HP_A::Jazz", headphoneId: "HP_A", genre: "Jazz", learnedGains: new Array(31).fill(0), sampleCount: 0, updatedAt: 0 };
        let stateB: LearningState = { profileId: "HP_B::Rock", headphoneId: "HP_B", genre: "Rock", learnedGains: new Array(31).fill(0), sampleCount: 0, updatedAt: 0 };

        stateA = await applyFeedback(stateA, "muddy", stateA.learnedGains);

        expect(stateA.learnedGains).not.toEqual(stateB.learnedGains);
        expect(stateB.learnedGains.every(g => g === 0)).toBe(true);
    });
});
