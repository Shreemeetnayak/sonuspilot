/**
 * AutoEq measurement ingestion.
 *
 * AutoEq (MIT, Copyright (c) 2018-2022 Jaakko Pasanen) aggregates public
 * headphone measurements. SonusPilot imports the *measurement curves* and
 * *target curves* from that repository at the user's request — nothing is
 * bundled into the app, so attribution travels with every imported record.
 *
 * Upstream rig measurements (oratory1990, crinacle, Innerfidelity, Rtings,
 * headphone.com) each carry their own terms; SonusPilot stores the source on
 * every record so a user can audit or delete it.
 */

import {
  computeSignature,
  resampleToIsoBands,
  round1,
  splitMakeModel,
  TARGETS,
  type FormFactor,
  type HeadphoneMeasurement,
  type MeasurementSource,
  type TargetId,
} from "./headphoneDb";

const AUTOEQ_RAW = "https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master";
const AUTOEQ_API = "https://api.github.com/repos/jaakkopasanen/AutoEq/contents";
const GITHUB_UA = "SonusPilot";

export const AUTOEQ_ATTRIBUTION = {
  project: "AutoEq",
  author: "Jaakko Pasanen",
  license: "MIT",
  url: "https://github.com/jaakkopasanen/AutoEq",
  licenseUrl: `${AUTOEQ_RAW}/LICENSE`,
} as const;

export const SOURCES: ReadonlyArray<{ id: MeasurementSource; path: string }> = [
  { id: "oratory1990", path: "oratory1990" },
  { id: "crinacle", path: "crinacle" },
  { id: "innerfidelity", path: "innerfidelity" },
  { id: "rtings", path: "rtings" },
  { id: "headphone-com", path: "headphone-com" },
];

const FORM_FACTORS: readonly FormFactor[] = ["over-ear", "in-ear", "earbud"];

/** Repo filenames for SonusPilot's target ids. */
const TARGET_FILES: Record<TargetId, string> = {
  "harman-over-ear-2018": "Harman over-ear 2018.csv",
  "harman-over-ear-2018-no-bass": "Harman over-ear 2018 without bass.csv",
  "harman-in-ear-2019": "Harman in-ear 2019.csv",
  "harman-in-ear-2019-no-bass": "Harman in-ear 2019 without bass.csv",
  "diffuse-field-5128": "Diffuse field 5128.csv",
  "diffuse-field-iso-11904-1": "Diffuse field ISO 11904-1.csv",
};

export const AVAILABLE_FORM_FACTORS = FORM_FACTORS;

// ── HTTP ────────────────────────────────────────────────────────────────

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal, headers: { Accept: "text/plain" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.text();
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    signal,
    headers: { Accept: "application/vnd.github+json", "User-Agent": GITHUB_UA },
  });
  if (res.status === 403 || res.status === 429) {
    throw new Error(
      "GitHub rate limit reached. Wait a few minutes, then retry — or add measurements manually."
    );
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

// ── CSV ─────────────────────────────────────────────────────────────────

/** AutoEq ships `frequency,raw` two-column CSVs; rows may be quoted. */
export function parseAutoEqCsv(csv: string): { freq: number[]; db: number[] } | null {
  const freq: number[] = [];
  const db: number[] = [];

  for (const line of csv.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(",").map((p) => p.trim().replace(/^"|"$/g, ""));
    if (parts.length < 2) continue;

    const f = Number(parts[0]);
    const d = Number(parts[1]);
    if (!Number.isFinite(f) || !Number.isFinite(d)) continue; // header row

    freq.push(f);
    db.push(d);
  }

  return freq.length >= 2 ? { freq, db } : null;
}

// ── Index discovery ─────────────────────────────────────────────────────

export interface RemoteFile {
  name: string;
  path: string;
  downloadUrl: string;
  htmlUrl: string;
}

interface GithubContent {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
  html_url: string | null;
}

export async function listMeasurements(
  source: MeasurementSource,
  formFactor: FormFactor,
  signal?: AbortSignal
): Promise<RemoteFile[]> {
  const path = `measurements/${source}/data/${formFactor}`;
  const items = await fetchJson<GithubContent[]>(`${AUTOEQ_API}/${path}`, signal);
  return items
    .filter((i) => i.type === "file" && i.name.toLowerCase().endsWith(".csv"))
    .map((i) => ({
      name: i.name,
      path: i.path,
      downloadUrl: i.download_url ?? `${AUTOEQ_RAW}/${i.path}`,
      htmlUrl: i.html_url ?? `${AUTOEQ_RAW}/${i.path}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listSourcesPresent(signal?: AbortSignal): Promise<MeasurementSource[]> {
  const items = await fetchJson<GithubContent[]>(`${AUTOEQ_API}/measurements`, signal);
  const present = new Set(items.filter((i) => i.type === "dir").map((i) => i.name));
  return SOURCES.filter((s) => present.has(s.path)).map((s) => s.id);
}

// ── Targets ─────────────────────────────────────────────────────────────

export function defaultTargetFor(formFactor: FormFactor): TargetId {
  return formFactor === "over-ear" ? "harman-over-ear-2018" : "harman-in-ear-2019";
}

export function targetsFor(formFactor: FormFactor): (typeof TARGETS)[number][] {
  return TARGETS.filter((t) => t.formFactor === "all" || t.formFactor === formFactor);
}

export async function fetchTargetSignature(
  target: TargetId,
  signal?: AbortSignal
): Promise<number[] | null> {
  const csv = await fetchText(
    `${AUTOEQ_RAW}/targets/${encodeURIComponent(TARGET_FILES[target])}`,
    signal
  );
  const parsed = parseAutoEqCsv(csv);
  if (!parsed) return null;
  const bands = resampleToIsoBands(parsed.freq, parsed.db);
  return bands ? bands.map(round1) : null;
}

// ── Ingest ──────────────────────────────────────────────────────────────

export interface IngestOptions {
  source: MeasurementSource;
  formFactor: FormFactor;
  target: TargetId;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface IngestResult {
  imported: HeadphoneMeasurement[];
  failed: Array<{ name: string; reason: string }>;
}

/**
 * Download every measurement for a source/form-factor, difference it against
 * the target, and return SonusPilot records. Returns what succeeded even if
 * some files fail, so a partial import is still useful.
 */
export async function ingestMeasurements(opts: IngestOptions): Promise<IngestResult> {
  const { source, formFactor, target, onProgress, signal } = opts;

  const targetSignature = await fetchTargetSignature(target, signal);
  if (!targetSignature) throw new Error(`Could not read target curve "${target}"`);

  const files = await listMeasurements(source, formFactor, signal);
  const imported: HeadphoneMeasurement[] = [];
  const failed: Array<{ name: string; reason: string }> = [];

  let done = 0;
  // Sequential on purpose: a parallel burst trips GitHub's unauthenticated
  // rate limit, which costs the user more time than concurrency saves.
  for (const file of files) {
    done += 1;
    onProgress?.(done, files.length);
    try {
      const csv = await fetchText(file.downloadUrl, signal);
      const parsed = parseAutoEqCsv(csv);
      if (!parsed) throw new Error("unparseable CSV");

      const measured = resampleToIsoBands(parsed.freq, parsed.db);
      if (!measured) throw new Error("resample failed");

      const signature = computeSignature(measured, targetSignature);
      if (!signature) throw new Error("band count mismatch");

      const display = file.name.replace(/\.csv$/i, "");
      const { manufacturer, model } = splitMakeModel(display);

      imported.push({
        id: `${source}:${formFactor}:${display}`,
        manufacturer,
        model,
        variant: null,
        formFactor,
        specs: { impedanceOhms: null, sensitivityDbPerMw: null, driverMm: null, enclosure: null },
        source,
        sourcePath: file.path,
        sourceUrl: file.htmlUrl,
        signatureDb: signature,
        ingestedAt: Date.now(),
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      failed.push({ name: file.name, reason: e instanceof Error ? e.message : "unknown" });
    }
  }

  return { imported, failed };
}

/** Fetch and difference one named measurement — used by manual import. */
export async function ingestOne(
  url: string,
  source: MeasurementSource,
  formFactor: FormFactor,
  target: TargetId,
  displayName: string,
  signal?: AbortSignal
): Promise<HeadphoneMeasurement | null> {
  const [csv, targetSignature] = await Promise.all([
    fetchText(url, signal),
    fetchTargetSignature(target, signal),
  ]);
  if (!targetSignature) return null;

  const parsed = parseAutoEqCsv(csv);
  if (!parsed) return null;

  const measured = resampleToIsoBands(parsed.freq, parsed.db);
  if (!measured) return null;

  const signature = computeSignature(measured, targetSignature);
  if (!signature) return null;

  const { manufacturer, model } = splitMakeModel(displayName);
  return {
    id: `${source}:${formFactor}:${displayName}`,
    manufacturer,
    model,
    variant: null,
    formFactor,
    specs: { impedanceOhms: null, sensitivityDbPerMw: null, driverMm: null, enclosure: null },
    source,
    sourcePath: url,
    sourceUrl: url,
    signatureDb: signature,
    ingestedAt: Date.now(),
  };
}
