import { describe, it, expect } from "vitest";
import {
  buildDiagnostics,
  boundEndpointName,
  endpointNames,
  detectCompetingDrivers,
  worstSeverity,
  type ApoBinding,
  type EqEngineStatus,
} from "../eqDiagnostics";

// Shapes captured from the live registry on the machine where this was
// written: APO registered on one Bluetooth headphone endpoint, while Windows
// played through INTELAUDIO.
const BINDING: ApoBinding = {
  apo_installed: true,
  bound_endpoints: [{ id: "{04b3884f-…}", name: "Headphones", has_apo: true }],
  all_endpoints: [
    { id: "{04b3884f-…}", name: "Headphones", has_apo: true },
    { id: "{889bc812-…}", name: "Speakers (Realtek(R) Audio)", has_apo: false },
  ],
  error: null,
};

const ENGINE_OK: EqEngineStatus = {
  available: true,
  reason: "ok",
  configPath: "C:\\Program Files\\EqualizerAPO\\config\\config.txt",
  configPresent: true,
};

describe("boundEndpointName", () => {
  it("returns the endpoint APO is registered on", () => {
    expect(boundEndpointName(BINDING)).toBe("Headphones");
  });

  it("returns null when the probe errored, so the UI says unknown not unbound", () => {
    expect(boundEndpointName({ ...BINDING, error: "registry locked" })).toBeNull();
    expect(boundEndpointName(null)).toBeNull();
  });

  it("returns null when APO is on no endpoint at all", () => {
    expect(
      boundEndpointName({ ...BINDING, apo_installed: false, bound_endpoints: [] }),
    ).toBeNull();
  });

  it("falls back to the endpoint id when the friendly name is missing", () => {
    const unnamed: ApoBinding = {
      ...BINDING,
      bound_endpoints: [{ id: "{04b3884f-…}", name: "", has_apo: true }],
    };
    expect(boundEndpointName(unnamed)).toBe("{04b3884f-…}");
  });
});

describe("buildDiagnostics for the misbound-endpoint case", () => {
  const checks = buildDiagnostics({
    engine: ENGINE_OK,
    endpointNames: endpointNames(BINDING),
    boundEndpointName: boundEndpointName(BINDING),
    defaultEndpointName: "Speakers (Realtek(R) Audio)",
    hasHeadphoneProfile: true,
  });

  it("warns that APO is bound elsewhere even though the engine reports available", () => {
    const binding = checks.find((c) => c.id === "binding");
    expect(binding?.severity).toBe("warn");
    expect(binding?.detail).toContain("Headphones");
    expect(binding?.detail).toContain("Speakers");
    expect(binding?.remedy).toBeTruthy();
  });

  it("does not report the engine as broken — it is installed and writable", () => {
    expect(checks.find((c) => c.id === "engine")?.severity).toBe("ok");
  });

  it("surfaces the misbinding as the overall severity", () => {
    expect(worstSeverity(checks)).toBe("warn");
  });
});

describe("buildDiagnostics when APO is correctly bound", () => {
  it("reports ok and drops the remedy", () => {
    const checks = buildDiagnostics({
      engine: ENGINE_OK,
      endpointNames: endpointNames(BINDING),
      boundEndpointName: boundEndpointName(BINDING),
      defaultEndpointName: "Headphones",
      hasHeadphoneProfile: true,
    });
    const binding = checks.find((c) => c.id === "binding");
    expect(binding?.severity).toBe("ok");
    expect(binding?.remedy).toBeUndefined();
    expect(worstSeverity(checks)).toBe("ok");
  });
});

describe("buildDiagnostics when the binding cannot be read", () => {
  it("reports unknown rather than claiming APO is unbound", () => {
    const checks = buildDiagnostics({
      engine: ENGINE_OK,
      endpointNames: [],
      boundEndpointName: boundEndpointName({ ...BINDING, error: "denied" }),
      defaultEndpointName: "Speakers (Realtek(R) Audio)",
      hasHeadphoneProfile: true,
    });
    expect(checks.find((c) => c.id === "binding")?.severity).toBe("unknown");
  });
});

describe("detectCompetingDrivers", () => {
  it("flags the multi-driver setup seen on this machine", () => {
    const found = detectCompetingDrivers([
      "Headphones",
      "Speakers (Realtek(R) Audio)",
      "Realtek(R) Audio - Dolby Atmos Headphone Virtualization",
    ]);
    expect(found.map((f) => f.label)).toContain("Dolby");
  });

  it("does not flag a clean endpoint", () => {
    expect(detectCompetingDrivers(["Speakers (Realtek(R) Audio)"])).toEqual([]);
  });
});
