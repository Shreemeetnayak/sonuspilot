# SonusPilot — Product Requirements Document (PRD)

**Version:** 0.2 (draft) · **Last updated:** 2026-10-13 · **Supersedes:** PRD v0.1

---

## Summary

SonusPilot is a Windows desktop application (Tauri + Rust + React/TypeScript) that provides per-song, per-headphone 31-band EQ adjustment. The EQ is applied system-wide through Equalizer APO, so it works for Spotify, browsers and any other shared-mode audio source.

The product combines three layers: deterministic headphone correction, a genre prior, and a track-adaptive layer driven by the audio itself. The adaptive layer ships first as a rule-based baseline. A neural model replaces it only if it beats that baseline in controlled evaluation.

| Mode | What the user gets | Target release |
| :--- | :--- | :--- |
| **Auto** | EQ chosen per track and per headphone with no input | V1 (baseline), V2 (neural) |
| **Manual** | 31-band graphic EQ with saved presets | V1 |
| **Describe** | Plain-English problems ("muddy", "too harsh") turned into bounded EQ changes | V1 or V2, to be fixed |
| **Headphone awareness** | Output device detected and the matching correction applied | V1 |
| **Sync** | Optional account that restores preferences on a fresh install | V2 |

> **Status.** This PRD describes intended behaviour. Nothing here has been built to its acceptance criteria. Numeric targets are provisional and are listed in the Provisional Values Register in `README.md`.

---

## 1. Problem

| Problem | Why it matters | Product response |
| :--- | :--- | :--- |
| **Users rarely touch EQ.** | Graphic and parametric EQs are hard to use well. | Auto mode needs no input; Describe mode needs no EQ vocabulary. |
| **Genre presets are crude.** | A preset treats a whole genre alike, but tracks within a genre differ widely in mastering and balance. | Genre is a soft prior; the track's own audio sets how much enhancement is applied. |
| **Headphones colour the sound.** | Each model has its own frequency response, so the same track sounds different on each. | Deterministic per-headphone correction toward a configurable target. |
| **Correction can destroy intent.** | Flattening everything removes what makes a bass-heavy hip-hop track or a bright synth track what it is. | The goal is to restore the intended character on the user's headphone, not to make tracks uniform. |

---

## 2. Competitive Position

Static tools such as Equalizer APO and Peace apply one fixed curve until the user changes it. SonusPilot differs in three ways: it adapts per track, it corrects per headphone, and it aims to preserve each recording's character ("Sound DNA").

> **Claim status: Proposed.** That per-track adaptation sounds better than a good static EQ or a genre preset is the central hypothesis of the project. It is tested by success criterion SC-1, not assumed.

---

## 3. Definition of Success

The product is not successful because it contains AI, classifies genre accurately, achieves low spectral error, makes large EQ changes, or sounds louder. Those are proxies.

1. Every adaptive stage must be compared with a named baseline.
2. If the more complex system does not beat the simpler one, the simpler one ships.
3. "Better sounding" is claimed only from human listening tests, never from spectral error alone.
4. Loudness is matched in every comparison, because louder is routinely heard as better.

---

## 4. Users and Scenarios

The personas below are assumptions used to shape requirements. They have not been validated with user research.

| User | Description | Needs |
| :--- | :--- | :--- |
| **Casual listener** | Streams music on a laptop with earbuds or headphones; never opens an EQ. | A sound that is better with no setup. |
| **Enthusiast** | Owns specific headphones or IEMs and cares about tonal balance. | Accurate correction, manual control, trust that the system is bounded. |
| **Non-expert tweaker** | Hears a problem but lacks EQ vocabulary. | Describe-the-problem input. |

### Primary journeys

| Journey | Steps | Expected behaviour |
| :--- | :--- | :--- |
| **First run** | Install → APO check → headphone detected → Auto EQ active | Guided APO install if missing; first Auto EQ within the onboarding target (SC-3). |
| **Track change, cached** | New track starts → cache hit → EQ crossfades | EQ applied within the cached-latency target. |
| **Track change, uncached** | New track starts → headphone correction applied first → track analysis → EQ refined | User sees which layer is active; no silence, no jump. |
| **Headphone switch** | Output device changes → profile resolved | Correction switches; if the device is unknown, a neutral correction and a visible notice. |
| **Describe a problem** | User types "vocals sound buried" | Bounded EQ change, shown on the 31-band display, undoable. |
| **No connection** | Cloud unreachable | Baseline and cached EQ continue; cloud-only features report their status. |

---

## 5. Functional Requirements

Priority: **P0** required for V1, **P1** expected for V1 or V2, **P2** later. "Origin" shows whether a requirement came from the original PRD or is a v0.2 derivation.

| ID | Requirement | Priority | Origin | Build task |
| :--- | :--- | :--- | :--- | :--- |
| **FR-01** | Detect the current track (title, artist, album) through Windows GSMTC. | P0 | Original | T1.2 |
| **FR-02** | Detect the active output device and resolve it to a headphone profile, with user override. | P0 | Original goal 4 | T1.3 |
| **FR-03** | Capture real-time PCM through WASAPI loopback for analysis. | P0 | Derived | T0.x, T2.2 |
| **FR-04** | Extract rolling audio features locally. Raw audio never leaves the machine. | P0 | Original | T2.2 |
| **FR-05** | Compose one 31-band gain vector from headphone correction, genre prior and track adaptation. | P0 | Original | T2.3 |
| **FR-06** | Apply the vector system-wide through Equalizer APO. | P0 | Original | T2.1, T2.3 |
| **FR-07** | Transition between EQ vectors without audible artefacts (crossfade, slew limit). | P0 | Original criterion | T2.3 |
| **FR-08** | Manual mode: 31-band graphic EQ, preset save, load and delete. | P0 | Original goal 2 | T1.4, T4.1 |
| **FR-09** | Describe mode: map natural language to strict, bounded EQ constraints. | P1 | Original goal 3 | Not scheduled |
| **FR-10** | Ship a curated headphone profile library and select it automatically. | P0 | Original | T1.3 |
| **FR-11** | Cache EQ locally, keyed by track, headphone profile, EQ version and model version. | P0 | Derived | T4.1 |
| **FR-12** | Follow a defined fallback chain, and always show which profile is active and why. | P0 | Derived | T3.3 |
| **FR-13** | Optional account sync of preferences. | P1 | Original goal 5 | Not scheduled |
| **FR-14** | Log passive feedback (manual EQ changes, explicit A/B) with consent. Track skips are not treated as a strong preference signal. | P1 | Derived | T5.1 |
| **FR-15** | Detect Equalizer APO and guide installation when it is missing. | P0 | Derived (risk R-04) | Not scheduled |
| **FR-16** | Enforce a global safety clamp on gain, smoothness and headroom for every EQ vector, whatever its source. | P0 | Derived | T2.3 |
| **FR-17** | Provide a loudness-matched EQ on/off comparison. | P1 | Derived | Not scheduled |

---

## 6. Non-Functional Requirements

| ID | Area | Requirement (provisional) | Status |
| :--- | :--- | :--- | :--- |
| **NFR-01** | **Latency** | Track change to EQ applied: under 100 ms for cached tracks, under 500 ms for uncached tracks. The PCM-analysis path needs its own target once Gate 0 passes and warm-up time is measured. | Proposed (PV-05) |
| **NFR-02** | **Audio quality** | No clipping attributable to EQ (positive gains are offset by headroom); transitions use an equal-power crossfade; per-band slew is limited. | Proposed (PV-06) |
| **NFR-03** | **Privacy** | No raw audio leaves the device. Metadata strings, derived features, EQ vectors and consented feedback events may be transmitted; each is documented in `ARCHITECTURE.md`. | Specified |
| **NFR-04** | **Footprint** | Roughly 100–130 MB installed including the runtime; the local cache is a few MB. | Estimate only |
| **NFR-05** | **CPU** | Background analysis must not cause audible glitches or noticeable battery cost. Budget to be set from measurement. | Open |
| **NFR-06** | **Reliability** | The system never produces silence or an extreme EQ because of a failure. Any failure falls back down the chain to headphone correction only, then to neutral. | Specified |
| **NFR-07** | **Compatibility** | Windows shared-mode audio only. ASIO and WASAPI exclusive-mode applications bypass Equalizer APO and are unsupported. | Established limitation |
| **NFR-08** | **Offline** | Baseline EQ and cached profiles work without a connection. | Specified |
| **NFR-09** | **Security** | Account data is encrypted in transit; the installer is code-signed before public release. | Planned |

---

## 7. Non-Goals (V1)

| Non-goal | Note |
| :--- | :--- |
| **Mobile platforms (iOS, Android)** | Windows first; mobile is a later project. |
| **Offline AI training** | Training is not done on the user's machine. Offline *use* of the baseline is supported (NFR-08). |
| **Per-track user rating** | Preference is inferred from passive corrections and optional A/B. |
| **Playback-path ownership** | SonusPilot takes a passive loopback tap for analysis. It does not replace the Windows mixer; Equalizer APO applies the EQ. |
| **ASIO and exclusive-mode support** | Not possible through Equalizer APO. |
| **Per-song EQ files from third parties** | A licensing problem; blended reference profiles are used instead. |

---

## 8. Success Criteria and How They Are Measured

| ID | Criterion | Measurement | Threshold status |
| :--- | :--- | :--- | :--- |
| **SC-1** | Auto EQ beats manual genre presets. | Blind, randomised, loudness-matched A/B on held-out tracks; report the preference rate with a confidence interval. Protocol in `AI_EVALUATION.md`. | Threshold to be set before the test is run |
| **SC-2** | No audible artefacts on track switches. | Peak headroom after EQ; maximum per-band slew; listening test of transitions. | Limits to be set from PV-01 and PV-06 |
| **SC-3** | Install to first Auto EQ within three minutes. | Timed onboarding, measured with Equalizer APO already installed and with a clean machine. | Open (conflict C-08) |
| **SC-4** | A learned model is kept only if it beats the baseline. | The baseline ladder in `AI_EVALUATION.md`. | Specified |
| **SC-5** | The fallback chain is never worse than headphone correction alone. | Fault-injection tests at each fallback level. | Specified |

> **Not a result yet.** None of these criteria has been measured. SC-1 in particular must not be claimed from spectral error alone.

---

## 9. Constraints and Dependencies

| Dependency | Constraint | Consequence |
| :--- | :--- | :--- |
| **Equalizer APO** | Third-party, user-installed; no effect on ASIO or exclusive mode; some Windows updates have broken it. | Installer check and guidance (FR-15); documented unsupported cases. |
| **WASAPI loopback** | Position relative to APO is unproven. | Gate 0 must pass before any adaptive behaviour (`GATE0_PROTOCOL.md`). |
| **GSMTC** | Supplies title, artist and album strings only; no track ID. | Fuzzy metadata lookup with a confidence score. |
| **Metadata sources** | Genre taxonomies differ between sources. | Normalisation layer and weighted consensus. |
| **Headphone data** | Several public sources are non-commercial or unlicensed. | Curated, licence-clean profiles first. See `CRITICAL_TECHNICAL_RISKS.md`. |
| **Training data** | Public music datasets are research-licensed. | Licence review before any commercial use of trained weights. See `AI_DATASET_RESEARCH.md`. |

---

## 10. Release Plan

| Release | Scope | Exit criterion |
| :--- | :--- | :--- |
| **V1 — baseline** | Gate 0, headphone correction, genre prior, percentile-based enhancement from audio features, manual mode, local cache. No neural model. | Gate 0 passed with evidence; baseline beats "no EQ" and genre-spectrum matching in listening tests. |
| **V2 — neural residual** | A neural residual on top of the V1 baseline, with a confidence-gated fallback. | Beats the V1 baseline on unseen artists in the restoration experiment, then in human A/B. Otherwise it is not shipped. |
| **V3 — personalisation** | Passive corrections and optional A/B personalise the residual. | Personalised residual beats the non-personalised one for participating users. |

---

## 11. Open Decisions

| ID | Decision | Needed by |
| :--- | :--- | :--- |
| **D-01** | Where neural inference runs: local ONNX or cloud (conflict C-01). | After the Stage A go/no-go |
| **D-02** | Whether Describe mode ships in V1 or V2. | Before Phase 3 |
| **D-03** | Onboarding design given the manual Equalizer APO install (conflict C-08). | Before Phase 4 |
| **D-04** | Commercial-use position on research-licensed datasets (conflict C-09). | Before any public release |
| **D-05** | The headphone target curve and the source of the first 15–20 profiles. | Before T1.3 completes |

---

## Appendix A. Requirement Traceability

| Requirement | Architecture element | Build task | Verification |
| :--- | :--- | :--- | :--- |
| FR-01 | GSMTC service (Rust) | T1.2 | Track-change events logged for Spotify, browser, Apple Music |
| FR-02, FR-10 | Device detection, profile library | T1.3 | Correct profile chosen for each test device |
| FR-03, FR-04 | WASAPI loopback, feature extractor | T0.x, T2.2 | Gate 0 evidence; feature parity test with training |
| FR-05, FR-16 | `eqDecisionEngine`, safety clamp | T2.3 | Property tests on clamp, smoothness, headroom |
| FR-06, FR-07 | APO config writer | T2.1, T2.3 | Measured response matches intended vector; transition test |
| FR-11, FR-12 | Local cache, fallback chain | T3.3, T4.1 | Fault-injection at each level |
| FR-14 | Event logging pipeline | T5.1 | Consent honoured; no raw audio logged |

---

## Appendix B. Change Summary from v0.1

| Change | Reason |
| :--- | :--- |
| Added requirement IDs, priorities and traceability | Make the PRD testable. |
| Replaced "zero audio artifacts" with measurable criteria | An absolute cannot be verified. |
| Clarified "audio path interception" | The loopback tap is passive; APO applies the EQ. |
| Added a definition of success | Prevent optimising proxies such as spectral error or loudness. |
| Added a release plan and open decisions | Make scope and gating explicit. |
| Added NFRs, constraints and dependencies | These were missing from v0.1. |
