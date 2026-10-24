/**
 * Headphone measurement persistence.
 *
 * A full import is thousands of records, which overflows localStorage's ~5 MB
 * quota, so measurements live in IndexedDB. The small things the UI reads on
 * every render (the index, the import meta) are mirrored into localStorage so
 * startup does not wait on an async store.
 */

import type { HeadphoneMeasurement, MeasurementIndexEntry } from "./headphoneDb";
import { toIndexEntry } from "./headphoneDb";

const DB_NAME = "sonuspilot-headphones";
const DB_VERSION = 1;
const STORE = "measurements";

const INDEX_KEY = "sonuspilot_measurement_index";
const META_KEY = "sonuspilot_headphone_meta";

export interface HeadphoneDbMeta {
  count: number;
  lastImportAt: number | null;
  lastSource: string | null;
  lastFailed: number;
}

const EMPTY_META: HeadphoneDbMeta = {
  count: 0,
  lastImportAt: null,
  lastSource: null,
  lastFailed: 0,
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

// ── Index (mirrored to localStorage for synchronous reads) ───────────────

export function getIndex(): MeasurementIndexEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as MeasurementIndexEntry[]) : [];
  } catch {
    return [];
  }
}

function setIndex(entries: MeasurementIndexEntry[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded on a pathological import: the measurements are still in
    // IndexedDB, so the app keeps working, just without the sync mirror.
  }
}

// ── Meta ────────────────────────────────────────────────────────────────

export function getMeta(): HeadphoneDbMeta {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? { ...EMPTY_META, ...(JSON.parse(raw) as HeadphoneDbMeta) } : EMPTY_META;
  } catch {
    return EMPTY_META;
  }
}

function setMeta(meta: HeadphoneDbMeta): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    /* non-fatal */
  }
}

// ── Reads ───────────────────────────────────────────────────────────────

export async function getMeasurement(id: string): Promise<HeadphoneMeasurement | null> {
  try {
    const db = await openDb();
    return await new Promise<HeadphoneMeasurement | null>((resolve, reject) => {
      const t = db.transaction(STORE, "readonly");
      const req = t.objectStore(STORE).get(id);
      req.onsuccess = () => resolve((req.result as HeadphoneMeasurement) ?? null);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
      t.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

/**
 * Full records for a set of ids. The index deliberately does not carry
 * signatureDb — duplicating it for thousands of headphones would blow the
 * localStorage mirror.
 */
export async function getMeasurements(ids: string[]): Promise<HeadphoneMeasurement[]> {
  if (ids.length === 0) return [];
  try {
    const db = await openDb();
    return await new Promise<HeadphoneMeasurement[]>((resolve, reject) => {
      const t = db.transaction(STORE, "readonly");
      const store = t.objectStore(STORE);
      const out: HeadphoneMeasurement[] = [];
      for (const id of ids) {
        const req = store.get(id);
        req.onsuccess = () => {
          if (req.result) out.push(req.result as HeadphoneMeasurement);
        };
      }
      t.oncomplete = () => {
        db.close();
        resolve(out);
      };
      t.onerror = () => {
        db.close();
        reject(t.error ?? new Error("IndexedDB read failed"));
      };
    });
  } catch {
    return [];
  }
}

// ── Writes ──────────────────────────────────────────────────────────────

export async function putMeasurements(records: HeadphoneMeasurement[]): Promise<number> {
  if (records.length === 0) return getIndex().length;

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    const store = t.objectStore(STORE);
    for (const r of records) store.put(r);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error("IndexedDB write failed"));
  });
  db.close();

  // Re-derive the index from the union of what was there and what arrived, so
  // re-importing one source never drops another source's profiles.
  const byId = new Map(getIndex().map((e) => [e.id, e]));
  for (const r of records) byId.set(r.id, toIndexEntry(r));
  const merged = [...byId.values()];
  setIndex(merged);

  setMeta({ ...getMeta(), count: merged.length });
  return merged.length;
}

export async function deleteAll(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE, "readwrite");
      t.objectStore(STORE).clear();
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error ?? new Error("IndexedDB clear failed"));
    });
    db.close();
  } catch {
    // The mirrors below are cleared regardless, so a failed clear cannot
    // leave the UI showing profiles it can no longer read.
  }
  setIndex([]);
  setMeta(EMPTY_META);
}

export function recordImport(sourceLabel: string, failed: number): void {
  setMeta({ ...getMeta(), lastImportAt: Date.now(), lastSource: sourceLabel, lastFailed: failed });
}

// ── Lookup ──────────────────────────────────────────────────────────────

/** Case-insensitive match over make + model, best matches first. */
export function searchIndex(
  index: MeasurementIndexEntry[],
  query: string,
  limit = 50
): MeasurementIndexEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return index.slice(0, limit);

  const scored: Array<{ entry: MeasurementIndexEntry; score: number }> = [];
  for (const entry of index) {
    const name = `${entry.manufacturer} ${entry.model}`.toLowerCase();
    const modelLc = entry.model.toLowerCase();
    let score = -1;
    if (name === q) score = 0;
    else if (modelLc.startsWith(q)) score = 1;
    else if (name.startsWith(q)) score = 2;
    else if (modelLc.includes(q)) score = 3;
    else if (name.includes(q)) score = 4;
    if (score >= 0) scored.push({ entry, score });
  }

  scored.sort((a, b) => a.score - b.score || a.entry.model.localeCompare(b.entry.model));
  return scored.slice(0, limit).map((s) => s.entry);
}

/** Distinct manufacturers, for filter dropdowns. */
export function manufacturers(index: MeasurementIndexEntry[]): string[] {
  return [...new Set(index.map((e) => e.manufacturer).filter(Boolean))].sort();
}