import { describe, expect, it } from "vitest";
import { applyFeedback, LearningState } from "../learningService";

describe("learningService feedback logic", () => {
    const initialState: LearningState = {
        profileId: "test-profile",
        headphoneId: "test-hp",
        genre: "test-genre",
        learnedGains: new Array(31).fill(0),
        sampleCount: 0,
        updatedAt: 0
    };

    it("applies 'muddy' feedback correctly (low-mid reduction)", async () => {
        const after = await applyFeedback(initialState, "muddy", initialState.learnedGains);
        // Verify low-mid (12-16) are reduced
        for (let i = 12; i <= 16; i++) {
            expect(after.learnedGains[i]).toBeLessThan(0);
        }
        // Verify others are 0
        expect(after.learnedGains[0]).toBe(0);
        expect(after.learnedGains[30]).toBe(0);
    });

    it("applies 'sharp' feedback correctly (upper-mid reduction)", async () => {
        const after = await applyFeedback(initialState, "sharp", initialState.learnedGains);
        // Verify upper-mid/presence (22-26) are reduced
        for (let i = 22; i <= 26; i++) {
            expect(after.learnedGains[i]).toBeLessThan(0);
        }
    });

    it("reinforces state with 'neutral'", async () => {
        const after = await applyFeedback(initialState, "neutral", initialState.learnedGains);
        expect(after.learnedGains).toEqual(initialState.learnedGains);
        expect(after.sampleCount).toBe(initialState.sampleCount + 1);
    });
});
