import { describe, it, expect } from "vitest";
import {
  computeSignature,
  resampleToIsoBands,
  round1,
  splitMakeModel,
} from "../headphoneDb";
import { parseAutoEqCsv } from "../autoeqIngest";
import { ISO_BANDS } from "../../audio/isoBands";

describe("parseAutoEqCsv", () => {
  it("reads the real frequency,raw format and skips the header", () => {
    const csv = "frequency,raw\n20.00,-6.91\n20.20,-6.87\n25.00,-5.50\n";
    const parsed = parseAutoEqCsv(csv);
    expect(parsed).not.toBeNull();
    expect(parsed!.freq).toEqual([20, 20.2, 25]);
    expect(parsed!.db).toEqual([-6.91, -6.87, -5.5]);
  });

  it("tolerates quoted values and blank lines", () => {
    const csv = 'frequency,raw\n\n"20.00","-6.91"\n40.00,"-2.58"\n';
    expect(parseAutoEqCsv(csv)!.freq).toEqual([20, 40]);
  });

  it("returns null when there is no usable data", () => {
    expect(parseAutoEqCsv("frequency,raw\n")).toBeNull();
    expect(parseAutoEqCsv("")).toBeNull();
  });
});

describe("resampleToIsoBands", () => {
  it("returns exactly one value per ISO band", () => {
    const freq = Array.from({ length: 200 }, (_, i) => 20 * Math.pow(1000, i / 199));
    const out = resampleToIsoBands(freq, freq.map(() => 0))!;
    expect(out).toHaveLength(31);
  });

  it("is exact at frequencies that exist in the source", () => {
    const freq = Array.from({ length: 500 }, (_, i) => 20 * Math.pow(1000, i / 499));
    const out = resampleToIsoBands(freq, freq.map(() => 3))!;
    out.forEach((v) => expect(v).toBeCloseTo(3, 6));
  });

  it("interpolates between known points in log-frequency", () => {
    // 100 Hz -> 0 dB, 1000 Hz -> 20 dB. ~316 Hz is the log midpoint.
    const out = resampleToIsoBands([100, 1000], [0, 20])!;
    expect(out[ISO_BANDS.indexOf(100)]).toBeCloseTo(0, 6);
    expect(out[ISO_BANDS.indexOf(1000)]).toBeCloseTo(20, 6);
    const near316 = out[ISO_BANDS.indexOf(315)];
    expect(near316).toBeGreaterThan(9);
    expect(near316).toBeLessThan(11);
  });

  it("holds edge values instead of extrapolating outside the measured range", () => {
    // Measured only from 100 Hz to 1 kHz: the 20 Hz and 20 kHz bands must clamp
    // to the nearest measured value rather than inventing a slope.
    const out = resampleToIsoBands([100, 200, 500, 1000], [1, 2, 3, 4])!;
    expect(out[ISO_BANDS.indexOf(20)]).toBe(1);
    expect(out[ISO_BANDS.indexOf(20000)]).toBe(4);
  });

  it("rejects malformed input", () => {
    expect(resampleToIsoBands([], [])).toBeNull();
    expect(resampleToIsoBands([100], [1, 2])).toBeNull();
    expect(resampleToIsoBands([NaN, 200], [1, 2])).toBeNull();
  });

  it("handles an unsorted source series", () => {
    const sorted = resampleToIsoBands([100, 1000], [0, 10])!;
    const shuffled = resampleToIsoBands([1000, 100], [10, 0])!;
    expect(shuffled).toEqual(sorted);
  });
});

describe("computeSignature", () => {
  it("is positive where the headphone is hotter than target", () => {
    const sig = computeSignature(new Array(31).fill(5), new Array(31).fill(0))!;
    sig.forEach((v) => expect(v).toBeCloseTo(5, 6));
  });

  it("is zero when the headphone already matches the target", () => {
    const curve = ISO_BANDS.map((_, i) => i * 0.5);
    const sig = computeSignature(curve, curve)!;
    sig.forEach((v) => expect(v).toBe(0));
  });

  it("rejects length mismatches rather than padding", () => {
    expect(computeSignature(new Array(10).fill(0), new Array(31).fill(0))).toBeNull();
  });
});

describe("splitMakeModel", () => {
  it("splits at the first space", () => {
    expect(splitMakeModel("Sennheiser HD 650")).toEqual({
      manufacturer: "Sennheiser",
      model: "HD 650",
    });
  });

  it("keeps a single token as the model", () => {
    expect(splitMakeModel("HE1000")).toEqual({ manufacturer: "", model: "HE1000" });
  });
});

describe("round1", () => {
  it("rounds to one decimal", () => {
    expect(round1(1.24)).toBe(1.2);
    expect(round1(-0.04)).toBe(-0);
  });
});
