# SonusPilot — System Architecture

**Version:** 0.2 (draft) · **Last updated:** 2026-10-13 · **Supersedes:** ARCHITECTURE v0.1

---

## Summary

SonusPilot is a Windows desktop application (Tauri + Rust + React/TypeScript) that produces one 31-band gain vector per track and per headphone and applies it system-wide through Equalizer APO. The vector is composed from three sources: deterministic headphone correction, a genre prior, and a track-adaptive layer. The track-adaptive layer is a rule-based baseline first (V1) and an optional neural residual later (V2).

The design rests on four rules. Raw audio never leaves the machine. Any failure falls back to a simpler, safe EQ. A safety clamp is applied to every vector regardless of its source. No adaptive behaviour is built until the audio tap has been shown to be safe (Gate 0).

> **Status.** The architecture is specified, not built. The Tauri shell is scaffolded; audio capture and the EQ controller are stubs. Latency budgets are provisional. Two decisions are open: where neural inference runs (D-01) and the tap position relative to Equalizer APO (Gate 0).

| Concern | Decision | Claim status |
| :--- | :--- | :--- |
| **Where EQ is applied** | Equalizer APO, system-wide, shared-mode audio only | Established (vendor behaviour) |
| **How audio is analysed** | Local WASAPI loopback tap, features extracted in Rust | Proposed; depends on Gate 0 |
| **How the EQ vector is built** | Headphone correction + genre prior + track adaptation, then clamp | Proposed |
| **Where neural inference runs** | Open | Open (C-01) |
| **Failure behaviour** | Confidence-gated fallback chain | Specified |

---

## 1. System Context

```
 ┌────────────┐   ┌─────────────────────┐   ┌────────────────┐   ┌────────────┐
 │ Media apps │──▶│ Windows audio engine │──▶│ Equalizer APO  │──▶│ Headphones │
 └────────────┘   └──────────┬──────────┘   └────────▲───────┘   └────────────┘
                             │ WASAPI loopback tap     │ config file written by SonusPilot
                             │ (position vs APO = GATE 0)
                             ▼                         │
   ┌─────────────────────────────────────────────────────────────────────┐
   │ SonusPilot (Tauri)                                                   │
   │  Rust services:  capture → rolling features → eqDecisionEngine ──────┘
   │                  GSMTC metadata ─┘   headphone detection ─┘          │
   │  React UI:       auto / manual / describe, 31-band display, status   │
   └───────────────────────────────┬─────────────────────────────────────┘
                                   │ metadata strings, derived features, consented feedback
                                   ▼
                    ┌───────────────────────────────┐
                    │ Backend (Python / FastAPI)     │
                    │ modular monolith: metadata,    │
                    │ ML inference, RAG, feedback    │
                    └───────────────────────────────┘
```

The loopback tap and Equalizer APO act on the same audio endpoint. If the tap sees audio *after* the EQ, the analyser measures its own correction and the system can oscillate. This hazard is why Gate 0 is a hard stop.

---

## 2. Design Principles

| Principle | What it means in practice |
| :--- | :--- |
| **Baseline first** | Every adaptive stage must beat a named simpler baseline. The simpler system ships if it does not. |
| **Deterministic fallback** | High neural confidence uses baseline + residual; low confidence or no connection uses the baseline; model failure uses headphone correction only. |
| **Bounded intent** | Natural-language input is mapped to strict EQ constraints, never to unbounded gains. |
| **Privacy first** | No raw audio leaves the machine. |
| **Offline reliability** | Baseline and cached EQ work without a connection. Cloud-only features degrade gracefully. |
| **Replaceable modules** | A modular monolith, not microservices. Every module sits behind an interface and can be swapped. |
| **Train/serve parity** | The feature extractor used in training and the one in the Rust runtime share one contract, and a parity test enforces it. |

---

## 3. Runtime Pipeline

| # | Stage | Where | Operation | Fails to |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Track identity** | Local (Rust) | GSMTC supplies title, artist, album. These are normalised and hashed for cache lookup. | Previous track's EQ held until identity resolves |
| **2** | **Device identity** | Local (Rust) | Detect the output device; resolve a headphone profile. | Neutral correction with a visible notice |
| **3** | **Audio capture** | Local (Rust) | WASAPI loopback PCM, as established by Gate 0. | Stage 5 is skipped; correction and prior only |
| **4** | **Feature extraction** | Local (Rust) | Rolling spectral features (for example with RustFFT). | Same as stage 3 |
| **5** | **Context estimate** | Local or backend | Genre/subgenre distribution from metadata and features. | Generic genre EQ |
| **6** | **Baseline enhancement** | Local | Percentile-based enhancement relative to the genre distribution, using multi-band relationships (sub-bass/bass, bass/mid, mid/treble), not per-band percentiles alone. | Headphone correction only |
| **7** | **Neural residual** | Open (D-01) | Bounded residual on top of the baseline. V2 only. | Baseline only |
| **8** | **Composition** | Local | `eqDecisionEngine` composes the final vector (section 4). | Last known safe vector |
| **9** | **Safety clamp** | Local | Gain limit, smoothness, headroom. | Neutral vector |
| **10** | **Application** | Local | Write the APO config; crossfade to the new vector. | Previous vector retained |

---

## 4. EQ Composition

For band *b* of the 31 bands, the final gain is composed as follows.

```
g_final[b] = clamp( g_hp[b] + g_prior[b] + g_enh[b] + c · r[b] )

  g_hp     deterministic headphone correction toward the configured target
  g_prior  genre/context prior (a soft prior, not a fixed preset)
  g_enh    baseline track-adaptive enhancement (V1 percentile rules)
  r        neural residual (V2; zero in V1)
  c        confidence gate in [0, 1]; 0 forces baseline only
  clamp    safety clamp: |g| ≤ MAX_GAIN_DB (PV-01), smoothness limit, headroom offset
```

> **Claim status: Proposed.** An additive composition is an implementation choice. It is kept only if it behaves well in evaluation; a multiplicative or learned composition may replace it.

### Intended behaviour of each layer

| Layer | Behaviour | Does not |
| :--- | :--- | :--- |
| **Headphone correction** | Brings the headphone's measured response toward a configurable target. | Depend on the track. |
| **Genre prior** | Shifts the starting point toward what that genre typically sounds like. | Force one preset per genre. Genre is never chosen by the user in Auto mode. |
| **Track adaptation** | Decides how much enhancement the actual recording needs. | Try to make all tracks sound alike. |
| **Safety clamp** | Limits gain, adjacent-band difference and total headroom. | Know or care which layer produced the vector. |

### Band layout

The 31 bands are assumed to be ISO one-third-octave centres from 20 Hz to 20 kHz. The exact bands, interpolation and filter semantics that Equalizer APO applies must be documented from experiment (task T2.0) before the training simulator is built, because the training simulator must match them.

---

## 5. Fallback Chain

| Condition | Behaviour | User-visible indicator |
| :--- | :--- | :--- |
| High neural confidence | Baseline + c · residual | "Adaptive EQ" |
| Low neural confidence | Baseline only | "Adaptive EQ (baseline)" |
| Neural model fails or is unavailable | Headphone correction + genre prior | "Correction only" |
| Track cannot be identified | Headphone correction + generic genre EQ | "Track not recognised" |
| Headphone unknown | Neutral correction | "Headphone not recognised" |
| Everything unavailable | Neutral (0 dB) | "Neutral (no data)" |

The user is always shown which layer is active and why. Failure is never silent.

---

## 6. Gate 0: Audio Tap Placement

The WASAPI loopback tap may observe the audio before or after Equalizer APO. The documentation is not relied on; the position is established by experiment (`GATE0_PROTOCOL.md`).

| Outcome | Consequence |
| :--- | :--- |
| **Tap is pre-EQ** | Analysis sees the unmodified signal. No compensation is needed. |
| **Tap is post-EQ** | Either find a pre-EQ tap, or compensate explicitly by subtracting the known applied response before analysis. |
| **Neither is reliable** | Adaptive behaviour is blocked. The product falls back to metadata-only priors. |

No stage after stage 3 of the pipeline is built until Gate 0 has passed with recorded evidence.

---

## 7. Modules

| Module | Technology | Responsibility | Status |
| :--- | :--- | :--- | :--- |
| **Tauri shell** | Tauri, Rust | Window, IPC, OS integration | Scaffolded |
| **Media session service** | Rust `windows` crate (Media_Control, Storage_Streams, Foundation) | GSMTC track metadata | Planned (T1.2) |
| **Device service** | Rust | Output device detection | Planned (T1.3) |
| **Loopback capture** | Rust, WASAPI | PCM tap | Stubbed; gated by Gate 0 |
| **Feature extractor** | Rust | Rolling spectral features | Planned (T2.2) |
| **`eqDecisionEngine`** | Rust (`services/`) | Composition, clamp, fallback | Planned (T2.3, T3.3) |
| **APO writer** | Rust | Writes the Equalizer APO config | Planned (T2.1) |
| **Frontend** | React, TypeScript, Vite | Auto/manual/describe UI, 31-band display, status | MVP demo with mock data |
| **Backend** | Python, FastAPI (modular monolith) | Metadata resolution, ML inference, RAG assistant, feedback intake | Planned |
| **Local cache** | SQLite | EQ per track + headphone + EQ version + model version | Planned (T4.1) |

---

## 8. Data Flow and Privacy

| Data | Leaves the device? | Purpose | Note |
| :--- | :--- | :--- | :--- |
| **Raw audio / PCM** | **Never** | Local analysis only | Core privacy rule |
| **Track metadata strings** | Yes | Genre/subgenre lookup | Title, artist, album |
| **Derived features / embeddings** | Yes, if neural inference runs in the cloud | Prediction | See open risk below |
| **EQ vectors** | Yes, if sync is enabled | Preference sync | Account required |
| **Feedback events** | Only with consent | Model improvement | Manual EQ changes, explicit A/B |

> **Open item.** Derived features are not raw audio, but "features are not audio" should not be assumed to mean "features reveal nothing". How reversible the transmitted features are has not been assessed. This matters if neural inference runs in the cloud (D-01).

---

## 9. Caching

The local cache key is `(track identity, headphone profile, EQ version, model version)`. A change to any element invalidates the entry, so a model upgrade does not serve a stale EQ.

| Property | Provisional value | Source |
| :--- | :--- | :--- |
| **Entries kept** | 1,000 tracks | PV-07 |
| **Expiry** | 90 days | PV-07 |
| **Approximate size** | Under 10 MB at about 2 KB per profile | Estimate |
| **User control** | A "Clear cache" action in settings | Planned |

---

## 10. Failure Modes

| Failure | Likely cause | Detection | Behaviour |
| :--- | :--- | :--- | :--- |
| **EQ oscillation** | Tap sees post-EQ audio | Rising gain drift; analysis correlates with own output | Freeze vector, fall back to correction only |
| **Silence or glitch on switch** | Abrupt coefficient change | Transition test | Crossfade and slew limit (FR-07) |
| **Wrong genre** | Ambiguous metadata match | Confidence score below threshold | Generic genre EQ |
| **APO config rejected** | Syntax error or locked file | Write verification | Retain previous vector, show error |
| **APO not installed or broken by a Windows update** | Third-party dependency | Startup and periodic check | Guided reinstall |
| **Backend unreachable** | Network | Timeout | Offline behaviour (section 5) |
| **Train/serve mismatch** | Feature extractor drift | Parity test in CI | Block the release |
| **Exclusive-mode app** | Application bypasses the audio engine | Detected state or user report | Documented as unsupported |

---

## 11. Technology Decisions

| Decision | Choice | Rationale | Alternatives considered |
| :--- | :--- | :--- | :--- |
| **Desktop shell** | Tauri | Small footprint, Rust core | Electron |
| **Windows audio and media APIs** | Rust `windows` crate | Direct access to Media_Control and WASAPI | `cpal` |
| **`cpal`** | Removed | Caused a `windows-core` dependency conflict | — |
| **Backend** | Python / FastAPI modular monolith | Fits the ML toolchain; no microservices | Node.js, Rust |
| **EQ application** | Equalizer APO | System-wide, free, scriptable | Custom APO (long term), virtual audio device |
| **Local store** | SQLite | Small, embedded | — |
| **Model runtime** | ONNX Runtime if local | Portable export | Cloud inference |

---

## 12. Limitations and Open Work

| Open item | Status | Current state | What closes it |
| :--- | :--- | :--- | :--- |
| **Loopback tap position** | **Gated** | Unknown | Gate 0 evidence |
| **Neural inference placement** | **Open** | Cloud and local both described | Decision D-01 after the restoration experiment |
| **APO 31-band semantics** | **Open** | Assumed ISO third-octave bands | Documented experiment (T2.0) |
| **Latency budgets** | **Planned** | Provisional only | Measurement per stage |
| **Feature reversibility** | **Open** | Not assessed | Privacy review |
| **Installer and APO onboarding** | **Open** | Not designed | Decision D-03 |
| **Describe mode design** | **Open** | Principle only (bounded constraints) | Decision D-02 |
| **Code signing** | **Planned** | Not started | Certificate and signing pipeline |
| **Custom APO** | **Not planned for V1** | Dependency on Equalizer APO accepted | Revisit for V2 |

---

## Appendix A. Decision Log

| ID | Decision | Date | Status |
| :--- | :--- | :--- | :--- |
| **ADR-01** | Use Equalizer APO, not a custom audio path | v0.1 | Accepted |
| **ADR-02** | Cloud-first with a small local cache; baseline works offline | v0.1, refined v0.2 | Accepted |
| **ADR-03** | Modular monolith backend, no microservices | v0.1 | Accepted |
| **ADR-04** | EQ composed from three layers with a final clamp | v0.2 | Accepted, to be tested |
| **ADR-05** | Neural model predicts a residual on the baseline, not 31 gains from scratch | v0.2 | Accepted |
| **ADR-06** | Gate 0 is a hard stop proven by experiment, not documentation | v0.2 | Accepted |
| **ADR-07** | Remove `cpal`; use the Rust `windows` crate | v0.2 | Accepted |
| **ADR-08** | Neural inference placement | — | **Open** |
