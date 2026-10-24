import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./Diagnostics.css";

// ── Types (mirrored from src-tauri/src/services/audio_path.rs) ───────────

export type Stage = "ok" | "detected" | "blocked";

export interface PathCheck {
  id: string;
  label: string;
  stage: Stage;
  detail: string;
  remedy: string | null;
}

export interface AudioPathReport {
  checks: PathCheck[];
  processing_verified: boolean;
}

export interface MeasurementResult {
  audible: boolean;
  test_preamp_db: number;
  peak_before: number;
  peak_after: number;
}

// ── Pipeline labels, in the order audio travels ──────────────────────────

const PIPELINE = [
  { id: "source", hop: "Audio app" },
  { id: "output", hop: "Windows audio" },
  { id: "apo", hop: "Equalizer APO" },
  { id: "config", hop: "SonusPilot EQ" },
  { id: "competing", hop: "Device chain" },
  { id: "verified", hop: "Your ears" },
];

const STAGE_META: Record<Stage, { cls: string; text: string; title: string }> = {
  ok: { cls: "ok", text: "Verified", title: "Verified by measurement" },
  detected: { cls: "detected", text: "Detected", title: "Detected, but not proven to be doing anything" },
  blocked: { cls: "blocked", text: "Blocked", title: "Missing, or blocking the path" },
};

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function QuestionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

// ── Component ────────────────────────────────────────────────────────────

interface DiagnosticsProps {
  onClose?: () => void;
}

export default function Diagnostics({ onClose }: DiagnosticsProps) {
  const [report, setReport] = useState<AudioPathReport | null>(null);
  const [measurement, setMeasurement] = useState<MeasurementResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setReport(await invoke<AudioPathReport>("get_audio_path_report"));
    } catch (e) {
      setTestError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runTest = async () => {
    setTesting(true);
    setTestError(null);
    try {
      const result = await invoke<MeasurementResult>("run_audio_test", { testPreampDb: 6.0 });
      setMeasurement(result);
      await refresh();
    } catch (e) {
      setTestError(String(e));
    } finally {
      setTesting(false);
    }
  };

  const byId = new Map(report?.checks.map((c) => [c.id, c]) ?? []);

  return (
    <section className="diagnostics" aria-label="Audio path diagnostics">
      <header className="diagnostics__head">
        <div>
          <h2 className="diagnostics__title">Audio path</h2>
          <p className="diagnostics__subtitle">
            Every stage below is measured. A stage is only green when something
            confirmed it.
          </p>
        </div>
        {onClose && (
          <button className="diagnostics__close" onClick={onClose} aria-label="Close diagnostics">
            <CrossIcon />
          </button>
        )}
      </header>

      <div
        className={`diagnostics__verdict${report?.processing_verified ? " diagnostics__verdict--ok" : ""}`}
        role="status"
        aria-live="polite"
      >
        {report?.processing_verified
          ? "SonusPilot EQ is verified as being processed at the output."
          : "SonusPilot EQ is not yet verified as reaching your ears."}
      </div>

      <ol className="diagnostics__list">
        {PIPELINE.map(({ id, hop }, i) => {
          const check = byId.get(id);
          const stage = check?.stage ?? "detected";
          const meta = STAGE_META[stage];
          return (
            <li key={id} className={`diagnostics__item diagnostics__item--${meta.cls}`}>
              <div className="diagnostics__rail" aria-hidden="true">
                <span className={`diagnostics__dot diagnostics__dot--${meta.cls}`} title={meta.title}>
                  {stage === "ok" ? <CheckIcon /> : stage === "blocked" ? <CrossIcon /> : <QuestionIcon />}
                </span>
                {i < PIPELINE.length - 1 && <span className="diagnostics__line" />}
              </div>
              <div className="diagnostics__body">
                <div className="diagnostics__row">
                  <span className="diagnostics__hop">{hop}</span>
                  <span className={`diagnostics__state diagnostics__state--${meta.cls}`}>{meta.text}</span>
                </div>
                <p className="diagnostics__detail">{check?.detail ?? "Not checked."}</p>
                {check?.remedy && <p className="diagnostics__remedy">{check.remedy}</p>}
              </div>
            </li>
          );
        })}
      </ol>

      <footer className="diagnostics__foot">
        <button
          className="diagnostics__test"
          onClick={runTest}
          disabled={testing}
          title="Applies a temporary 6 dB gain, measures the output, then restores your curve. Play music first."
        >
          <PlayIcon />
          {testing ? "Measuring…" : "Run audio test"}
        </button>
        {measurement && (
          <span className="diagnostics__reading">
            {measurement.audible
              ? "Output moved when the test gain was applied."
              : `No measurable change (${measurement.peak_before.toFixed(4)} → ${measurement.peak_after.toFixed(4)}).`}
          </span>
        )}
        {testError && <span className="diagnostics__error">{testError}</span>}
      </footer>
    </section>
  );
}
