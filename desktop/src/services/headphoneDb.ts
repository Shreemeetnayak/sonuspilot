/**
 * Headphone measurement database.
 *
 * SonusPilot does not invent frequency responses. A profile only exists when
 * real measured data has been ingested, and it always records where that data
 * came from. Unsure details are `null`, never a plausible-looking guess.
 *
 * Measurement data originates from the AutoEq project (MIT licensed,
 * Copyright (c) 2018-2022 Jaakko Pasanen), which aggregates measurements from
 * oratory1990, crinacle, Innerfidelity, Rtings and legacy headphone.com.
 * Each measurement carries its upstream source so attribution stays intact.
 */

import { ISO_BANDS } from "../audio/isoBands";

/** Form factors AutoEq publishes measurements under. */
export type FormFactor = "over-ear" | "in-ear" | "earbud";

/** Correction targets published in AutoEq's `targets/` directory. */
export type TargetId =
  | "harman-over-ear-2018"
  | "harman-over-ear-2018-no-bass"
  | "harman-in-ear-2019"
  | "harman-in-ear-2019-no-bass"
  | "diffuse-field-5128"
  | "diffuse-field-iso-11904-1";

export const TARGETS: ReadonlyArray<{
  id: TargetId;
  label: string;
  formFactor: FormFactor | "all";
}> = [
  { id: "harman-over-ear-2018", label: "Harman over-ear 2018", formFactor: "over-ear" },
  { id: "harman-over-ear-2018-no-bass", label: "Harman over-ear 2018 (no bass)", formFactor: "over-ear" },
  { id: "harman-in-ear-2019", label: "Harman in-ear 2019", formFactor: "in-ear" },
  { id: "harman-in-ear-2019-no-bass", label: "Harman in-ear 2019 (no bass)", formFactor: "in-ear" },
  { id: "diffuse-field-5128", label: "Diffuse field 5128", formFactor: "all" },
  { id: "diffuse-field-iso-11904-1", label: "Diffuse field ISO 11904-1", formFactor: "all" },
];

/** Upstream rig that produced a measurement. Never guessed. */
export type MeasurementSource =
  | "oratory1990"
  | "crinacle"
  | "innerfidelity"
  | "rtings"
  | "headphone-com"
  | "custom";

export const SOURCE_LABELS: Record<MeasurementSource, string> = {
  oratory1990: "oratory1990",
  crinacle: "crinacle",
  innerfidelity: "Innerfidelity",
  rtings: "Rtings",
  "headphone-com": "headphone.com (legacy)",
  custom: "Custom measurement",
};

/**
 * Optional hardware facts. All nullable on purpose — a missing impedance is
 * more useful than a fabricated one.
 */
export interface HeadphoneSpecs {
  impedanceOhms: number | null;
  sensitivityDbPerMw: number | null;
  driverMm: number | null;
  enclosure: string | null;
}

export const EMPTY_SPECS: HeadphoneSpecs = {
  impedanceOhms: null,
  sensitivityDbPerMw: null,
  driverMm: null,
  enclosure: null,
};

/**
 * A measured headphone response sampled onto SonusPilot's 31 ISO bands.
 * `signatureDb` is measured-minus-target: positive means the headphone is
 * louder than target at that band, so correcting it means cutting.
 */
export interface HeadphoneMeasurement {
  /** Stable id, e.g. `oratory1990:over-ear:Sennheiser HD 650`. */
  id: string;
  manufacturer: string;
  model: string;
  /** Earpad/cable variant, when the source distinguishes one. */
  variant: string | null;
  formFactor: FormFactor;
  specs: HeadphoneSpecs;
  source: MeasurementSource;
  /** Path within the AutoEq repo the data came from, for attribution. */
  sourcePath: string;
  /** URL a user can open to audit the measurement. */
  sourceUrl: string | null;
  /** Measured-minus-target, dB, sampled at ISO_BANDS. */
  signatureDb: number[];
  /** When SonusPilot ingested it. */
  ingestedAt: number;
}

export interface MeasurementIndexEntry {
  id: string;
  manufacturer: string;
  model: string;
  variant: string | null;
  formFactor: FormFactor;
  source: MeasurementSource;
  sourcePath: string;
  sourceUrl: string | null;
  hasSpecs: boolean;
}

export function toIndexEntry(m: HeadphoneMeasurement): MeasurementIndexEntry {
  return {
    id: m.id,
    manufacturer: m.manufacturer,
    model: m.model,
    variant: m.variant,
    formFactor: m.formFactor,
    source: m.source,
    sourcePath: m.sourcePath,
    sourceUrl: m.sourceUrl,
    hasSpecs: Object.values(m.specs).some((v) => v !== null),
  };
}

// ── Curve maths ─────────────────────────────────────────────────────────

/**
 * Resample a log-spaced frequency/response series onto our fixed ISO bands.
 * AutoEq ships ~700 points per curve; interpolating in log-frequency matches
 * how the data was measured, so band values are not skewed toward 20 Hz.
 */
export function resampleToIsoBands(frequencies: number[], responses: number[]): number[] | null {
  if (frequencies.length < 2 || frequencies.length !== responses.length) return null;

  const sorted = frequencies
    .map((f, i) => ({ f, db: responses[i] }))
    .sort((a, b) => a.f - b.f);

  if (sorted.some((p) => !Number.isFinite(p.f) || !Number.isFinite(p.db))) return null;

  const out: number[] = [];
  let cursor = 0;

  for (const band of ISO_BANDS) {
    if (band < sorted[0].f) {
      // Below the measured range: hold the lowest measured value rather than
      // extrapolating a slope we have no data for.
      out.push(sorted[0].db);
      continue;
    }
    if (band > sorted[sorted.length - 1].f) {
      out.push(sorted[sorted.length - 1].db);
      continue;
    }

    while (cursor < sorted.length - 2 && sorted[cursor + 1].f < band) cursor++;

    const lo = sorted[cursor];
    const hi = sorted[cursor + 1];
    const ratio = (Math.log(band) - Math.log(lo.f)) / (Math.log(hi.f) - Math.log(lo.f));
    out.push(lo.db + (hi.db - lo.db) * ratio);
  }

  return out;
}

/**
 * Difference a measured curve against a target to get the correction SonusPilot
 * needs. Positive = headphone is hot there, so we cut.
 */
export function computeSignature(measuredDb: number[], targetDb: number[]): number[] | null {
  if (measuredDb.length !== ISO_BANDS.length || targetDb.length !== ISO_BANDS.length) {
    return null;
  }
  return measuredDb.map((db, i) => round1(db - targetDb[i]));
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Split "Sennheiser HD 650" into brand and model at the first space. */
export function splitMakeModel(display: string): { manufacturer: string; model: string } {
  const trimmed = display.trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx <= 0) return { manufacturer: "", model: trimmed };
  return { manufacturer: trimmed.slice(0, spaceIdx), model: trimmed.slice(spaceIdx + 1) };
}

export function formatHeadphoneName(entry: {
  manufacturer: string;
  model: string;
  variant?: string | null;
}): string {
  const base = [entry.manufacturer, entry.model].filter(Boolean).join(" ");
  return entry.variant ? `${base} (${entry.variant})` : base;
}
