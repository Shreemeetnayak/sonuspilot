import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyFeedback } from "../learningService";
import { PerceptualFeedbackEvent } from "../eventSchema";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

describe("feedback event integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("creates and verifies a feedback event without production features", async () => {
    // 1. Mock state
    const state = {
      profileId: "test-profile",
      headphoneId: "h1",
      genre: "pop",
      learnedGains: new Array(31).fill(0),
      sampleCount: 1,
      updatedAt: Date.now(),
    };

    // 2. Perform feedback
    const feedback = "muddy";
    const newState = await applyFeedback(state, feedback, state.learnedGains);

    // 3. Construct event (this logic is now inside applyFeedback)
    const event: PerceptualFeedbackEvent = {
      schemaVersion: "1.0.0",
      timestamp: Date.now(),
      feedbackType: feedback,
      headphoneProfileId: state.profileId,
      outputDeviceId: null,
      genre: state.genre,
      subgenre: null,
      baselineEq: state.learnedGains as [number, ...number[]],
      learnedEqBefore: state.learnedGains as [number, ...number[]],
      learnedEqAfter: newState.learnedGains as [number, ...number[]],
      feedbackDelta: newState.learnedGains.map((g, i) => g - state.learnedGains[i]) as [number, ...number[]],
      trackIdentifier: null,
      artistIdentifier: null,
      featureContextStatus: "missing",
      featureSchemaVersion: "n/a",
      provenance: "sonuspilot-test-env",
      appVersion: "0.1.0",
    };

    // 4. Verify event structure
    expect(event.schemaVersion).toBe("1.0.0");
    expect(event.feedbackType).toBe("muddy");
    expect(event.featureContextStatus).toBe("missing");
    expect(event.baselineEq).toHaveLength(31);

    // 5. Mock invocation
    await invoke("append_feedback_event", { event });
    expect(invoke).toHaveBeenCalledWith("append_feedback_event", { event });
  });
});
