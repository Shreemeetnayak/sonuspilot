# SonusPilot — Project Documentation

**Document set version:** 0.2 (draft) · **Last updated:** 2026-10-13 · **Project phase:** Pre-implementation, Gate 0 pending

---

## Summary

SonusPilot is a Windows desktop application (Tauri + Rust + React/TypeScript) that adapts a 31-band equaliser to the track being played and the headphone being worn. Its aim is not to make every song sound the same, but to let the important characteristics of each recording come through on the listener's own headphones.

The adaptation is built in three layers: a deterministic, measurement-based headphone correction; a genre/context prior; and a track-adaptive layer driven by the audio itself. The track-adaptive layer starts as a non-ML baseline and only becomes a neural model if the neural model beats that baseline in controlled tests.

This document set specifies the product, the architecture, the learning methodology, the evaluation protocol, the risks and the build order.

> **Not a validated product yet.** No component has been measured end to end. The Tauri shell is scaffolded, the audio path and EQ controller are stubs, and the first hard gate (where the WASAPI loopback tap sits relative to Equalizer APO) has not been run. Every performance, latency and quality figure in these documents is a **target or a provisional value**, not a result.

| Layer | Question it answers | State |
| :--- | :--- | :--- |
| **1. Headphone correction** | Can the headphone's colouration be undone toward a configurable target? | Specified |
| **2. Genre / context prior** | Can genre act as a soft prior instead of a fixed preset? | Specified |
| **3. Track-adaptive enhancement** | Can the actual audio decide how much enhancement a track needs? | Specified; V1 baseline then V2 neural, both unbuilt |

---

## Document Map

| Document | Purpose | Primary audience | State |
| :--- | :--- | :--- | :--- |
| `README.md` | Index, conventions, provisional values, conflict register | Everyone | This file |
| `PRD.md` | What the product must do and how success is measured | Product, engineering | Revised |
| `ARCHITECTURE.md` | System design, module boundaries, failure behaviour, decisions | Engineering | Revised |
| `GATE0_PROTOCOL.md` | Experiment that must pass before any adaptive behaviour is built | Engineering | **New** |
| `AI_EQ_ARCHITECTURE.md` | Model design and production gate | ML engineering | Revised |
| `AI_EQ_RESEARCH.md` | Research basis, what is established vs proposed | ML engineering | Revised |
| `AI_DATASET_RESEARCH.md` | Datasets, licences, provenance, split rules | ML, legal review | Revised |
| `AI_TRAINING_PLAN.md` | Staged training plan and experiment ladder | ML engineering | Revised |
| `AI_TRAINING_METHODOLOGY.md` | Learning formulation, preference learning, gated RL/PBT | ML engineering | Revised |
| `AI_EVALUATION.md` | Metrics, baselines, human evaluation, go/no-go rules | ML, QA | Revised |
| `CRITICAL_TECHNICAL_RISKS.md` | Risk register and corrected assumptions | Everyone | Revised |
| `BUILD_TASKS.md` | Ordered tasks with acceptance criteria and evidence | Engineering | Revised |
| `IMPLEMENTATION_STATUS.md` | What exists, what is verified, what blocks what | Everyone | Revised |

**Suggested reading order:** this README → `PRD.md` → `ARCHITECTURE.md` → `GATE0_PROTOCOL.md` → `CRITICAL_TECHNICAL_RISKS.md` → `BUILD_TASKS.md` → the `AI_*` documents.

---

## Conventions Used Across the Set

### Status labels

| Status | Meaning |
| :--- | :--- |
| **Complete** | Done, and the evidence artifact exists. |
| **In progress** | Work has started and is not yet at its acceptance criteria. |
| **Stubbed** | An interface exists but returns placeholder behaviour. |
| **Specified** | Designed in these documents; no working code. |
| **Planned** | Scheduled, with no detailed design yet. |
| **Gated** | Cannot start until a named gate or decision passes. |
| **Open** | A decision is still to be made. |
| **Superseded** | Replaced by a later decision. Kept for history. |

### Claim classification

Every technical claim falls into one of three groups, in the same way the EEG methodology report separates published basis from proposed change.

| Category | Meaning | How it is treated |
| :--- | :--- | :--- |
| **Established** | Supported by published work, vendor documentation or a measurement recorded in this repository. | May be relied on, with the source named. |
| **Proposed** | A design idea whose benefit has not been shown. | Must beat a named baseline before it stays. |
| **Implementation choice** | A reproducibility or engineering decision, not a claim about the world. | Recorded in the decision log and revisitable. |

### Evidence rule

No metric, latency, accuracy or preference result is reported without the artifact that produced it (configuration, seed, dataset manifest, checkpoint and evaluation output). If the evidence cannot be produced, the item is reported as **BLOCKED**, and unverified data is never substituted.

---

## Provisional Values Register

These numbers appear in the documents but have not been validated. Each must be either confirmed by measurement or replaced before it is treated as a requirement.

| ID | Value | Where used | Origin | What settles it |
| :--- | :--- | :--- | :--- | :--- |
| **PV-01** | `MAX_GAIN_DB` (per-band hard clamp) | Safety clamp, action space | Original methodology left it unspecified | Headphone and listening tests; headroom analysis |
| **PV-02** | Residual magnitude penalty above 3 dB | Training loss, evaluation | Original evaluation notes | Ablation on the penalty threshold |
| **PV-03** | Metadata confidence threshold 0.7 | Fallback to generic genre EQ | Risk review, 2026-09-18 | Calibration against resolved-track accuracy |
| **PV-04** | Simulator acceptance of 0.5 dB | Differentiable EQ vs real APO output | Project placeholder | Measured noise floor of the capture chain (Gate 0) |
| **PV-05** | Latency targets: under 100 ms cached, under 500 ms uncached | Track-change to EQ applied | Risk review (metadata path) | Measurement; the PCM-analysis path needs its own target |
| **PV-06** | 20 ms equal-power crossfade | Transition smoothing | Risk review | Listening test for audible artefacts |
| **PV-07** | Local cache of 1,000 tracks, 90-day expiry | Local cache | Risk review | Cache hit-rate and footprint measurement |
| **PV-08** | 70 / 30 train / test split | Training evaluation | Original methodology | Replaced by artist/album-disjoint train / validation / test; ratios still to fix |
| **PV-09** | About 200–300 active-learning A/B comparisons | Preference (critic) stage | Project design | Pilot study; learning-curve analysis |
| **PV-10** | 15–20 curated headphone profiles for MVP | Headphone correction | Risk review | Licensing outcome and target-curve choice |

---

## Cross-Document Conflict Register

The documents were written at different times and disagree in places. This register records each disagreement and the resolution used in version 0.2. Items marked **Open** need a decision from the project owner.

| ID | Conflict | Documents | Resolution in v0.2 | Status |
| :--- | :--- | :--- | :--- | :--- |
| **C-01** | **Where neural inference runs.** One document sends features to a cloud backend; others plan local ONNX Runtime inference. | `ARCHITECTURE`, `AI_EQ_ARCHITECTURE`, `BUILD_TASKS` Phase 3 | V1 (non-ML baseline) runs fully locally. Neural placement is decided after the Stage A go/no-go, based on model size and latency. Both paths are kept behind one interface. | **Open** |
| **C-02** | **Audio features vs metadata-only.** The risk review recommends a metadata-only MVP because GSMTC exposes no audio. The PRD and architecture analyse PCM from WASAPI loopback. | `CRITICAL_TECHNICAL_RISKS`, `PRD`, `ARCHITECTURE` | Loopback supplies the PCM that GSMTC cannot, but only if Gate 0 passes. Metadata-based genre priors remain as the fallback. | Resolved, conditional on Gate 0 |
| **C-03** | **Training paradigm.** The methodology centres on RL with population-based training; the training plan centres on supervised restoration from synthetic damage. | `AI_TRAINING_METHODOLOGY`, `AI_TRAINING_PLAN` | Supervised restoration runs first. Preference learning and RL/PBT are gated behind it. | Resolved |
| **C-04** | **Evaluation ground truth.** The evaluation notes score against "ground-truth user preferences", which do not exist at Stage A. | `AI_EVALUATION` | Stage A is scored against the known inverse of the applied damage. Preference-based scoring starts only with real human comparisons. | Resolved |
| **C-05** | **Data splits.** The methodology uses 70 / 30 with no validation set. | `AI_TRAINING_METHODOLOGY` | Artist/album-disjoint train / validation / test, with model selection on validation only. | Resolved; ratios open |
| **C-06** | **"Audio path interception" listed as a non-goal while loopback capture is core.** | `PRD`, `ARCHITECTURE` | Clarified: loopback is a passive tap for analysis. SonusPilot does not sit in the playback path; Equalizer APO applies the EQ. | Resolved |
| **C-07** | **Offline behaviour.** The PRD excludes offline AI training; the architecture promises offline reliability; the risk review says the MVP needs internet. | `PRD`, `ARCHITECTURE`, `CRITICAL_TECHNICAL_RISKS` | Offline means baseline and cached EQ still work. Cloud features (neural inference, RAG, sync, new-track lookup) degrade gracefully. | Resolved |
| **C-08** | **Three-minute onboarding vs a manual Equalizer APO install.** | `PRD`, `CRITICAL_TECHNICAL_RISKS` | The criterion is measured twice: with and without APO preinstalled. The installer flow is a Phase 4 task. | **Open** |
| **C-09** | **Non-commercial datasets and a possible commercial product.** | `AI_DATASET_RESEARCH`, `PRD` | Treated as research-only until a licence review completes. This is a legal question, not an engineering one. | **Open** |
| **C-10** | **Stage naming.** Plans use Stage 1/2/3; project briefs use Stage A/B/C. | `AI_TRAINING_PLAN`, `AI_TRAINING_METHODOLOGY` | Stages 1–3 are capability stages. "Stage A" means the restoration experiment inside Stage 2. Later experiments (critic, candidate search) are named in `AI_TRAINING_METHODOLOGY`. | Resolved; confirm naming |
| **C-11** | **"Zero audio artifacts" as an absolute.** | `PRD` | Replaced by measurable criteria (peak headroom, slew limit, listening test). | Resolved |

---

## Glossary

| Term | Meaning |
| :--- | :--- |
| **APO** | Audio Processing Object. Equalizer APO is the third-party APO SonusPilot uses to apply EQ system-wide. |
| **GSMTC** | Windows Global System Media Transport Controls; supplies track metadata strings, not audio or track IDs. |
| **WASAPI loopback** | A Windows capture mode that records what an output device is rendering. |
| **Gate 0** | The experiment that proves where the loopback tap sits relative to APO. A hard stop. |
| **Sound DNA** | The per-track descriptor (genre/subgenre mixture and spectral character) used to choose enhancement. |
| **Baseline (V1)** | The non-ML pipeline: audio features, genre/subgenre distribution, percentile-based enhancement, 31-band EQ. |
| **Residual** | A small learned correction added on top of the baseline EQ. |
| **Safety clamp** | The final limiter on gain, smoothness and headroom applied to any EQ vector. |
| **Restoration experiment (Stage A)** | Apply a known synthetic EQ damage to real tracks and test whether the model recovers the correcting EQ. |
| **Critic** | A learned model that scores how good an EQ sounds, trained on human comparisons. |
| **PBT** | Population-based training. |
