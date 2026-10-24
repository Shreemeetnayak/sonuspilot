# AI EQ Architecture

| Field | Value |
| :--- | :--- |
| **Document type** | Model and inference architecture |
| **Status** | Design — no model has been trained or exported |
| **Last revised** | 2026-10-13 |
| **Related documents** | `ARCHITECTURE.md`, `AI_EQ_RESEARCH.md`, `AI_TRAINING_PLAN.md`, `AI_EVALUATION.md` |

---

## Summary

This document describes the neural component of SonusPilot. A pretrained or lightweight audio encoder produces features from the playing music. A small regressor, conditioned on the headphone and the genre, predicts a **31-band gain residual**. That residual is added to a deterministic baseline and passed through a safety clamp.

The design keeps the neural model small and bounded on purpose: the baseline carries the load, and the model only adjusts it for the individual song.

> **Not a result yet.** No model exists. The accuracy, latency and size of every component below are unmeasured, and two inputs (headphone embedding and confidence signal) are not yet specified.

---

## 1. Conceptual Pipeline

| Stage | Operation | Input | Output | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **1. Audio input** | Real-time PCM via WASAPI loopback. | Device mix format audio | PCM frames | Observe what the user hears. |
| **2. Audio understanding** | MERT/CLAP embedding model, or a lightweight CNN. | PCM resampled to the encoder rate | Timbral and musical feature vector | Summarise tonal balance and style. |
| **3. Context conditioning** | Headphone embedding plus genre/subgenre vector. | Device profile, genre metadata | Conditioning vector | Make the residual device-aware and genre-aware. |
| **4. Neural residual** | Lightweight regressor. | Audio features plus conditioning | 31 gain residuals (dB) | Per-song correction. |
| **5. Differentiable DSP** | 31-band IIR/FIR filter bank. | Predicted gains, audio | Filtered audio or magnitude response | Lets the training loss act on the frequency response. |
| **6. Production gate** | Deterministic baseline + neural residual → safety clamp → final EQ. | Baseline, residual | Final 31-band gains | Guarantee bounded, safe output. |

> **Clarification.** Stage 5 is a **training-time** component. In production the final gains are applied by Equalizer APO, not by the differentiable filter bank.

## 2. Why Each Component Is Included

| Component | What it does | Why it is included |
| :--- | :--- | :--- |
| **WASAPI loopback** | Captures system audio. | Gives the model the actual signal, which platform metadata cannot. |
| **MERT/CLAP embedding** | Maps audio to a semantic and timbral vector. | Richer than hand-crafted features such as MFCCs, according to the research notes. Needs confirmation in this project (see `AI_EVALUATION.md`). |
| **Lightweight CNN alternative** | Smaller encoder. | A realistic option if large models are too slow or too restricted by licence. |
| **Headphone embedding** | Encodes device frequency behaviour. | The same song needs a different residual on different headphones. |
| **Genre/subgenre vector** | Encodes musical context. | Narrows the prediction using a signal that is cheap to get. |
| **Residual head** | Predicts gain deltas, not whole curves. | A small, bounded output is easier to learn and safer to deploy. |
| **Differentiable filter bank** | Computes the response of the predicted EQ. | Allows direct frequency-domain optimisation. |
| **Safety clamp** | Limits gains and smoothness. | Final defence against clipping and over-correction. |

## 3. Research Basis

| Category | Examples | Meaning |
| :--- | :--- | :--- |
| **Published basis** | Differentiable biquads for parametric EQ matching; MERT and CLAP audio embeddings; differentiable DSP. | Supported by existing literature (see `AI_EQ_RESEARCH.md`). |
| **Proposed change** | Residual prediction on top of a deterministic headphone baseline, conditioned on headphone and genre. | The contribution to be tested. |
| **Implementation choice** | 31 bands, residual clamp, ONNX export, fallback rules. | Engineering decisions, not literature claims. |

## 4. Interfaces

| Interface | Specification | Status |
| :--- | :--- | :--- |
| **Encoder input** | Mono or stereo PCM at the encoder's sample rate. MERT-v1 expects 24 kHz. | Resampling stage not designed |
| **Audio embedding** | Dimension depends on the chosen encoder (768 for MERT-v1-95M). | Encoder not chosen |
| **Headphone embedding** | Source and dimension not specified (learned, or derived from the measured response). | **Open** |
| **Genre vector** | Taxonomy from the genre-normalisation layer in `CRITICAL_TECHNICAL_RISKS.md` §6. | Taxonomy not built |
| **Output** | 31 gains in dB, one per band. | Band centres to be fixed |
| **Clamp** | `MAX_GAIN`, smoothness limit, headroom. | Values not set (`ARCHITECTURE.md` D5) |

## 5. Deterministic Fallback

| Trigger | Behaviour |
| :--- | :--- |
| **Inference fails or times out** | Use the deterministic baseline only. |
| **Confidence is low** | Use the deterministic baseline only. |
| **No cloud connection and no local model** | Use the deterministic baseline only. |

The switch must not cause an audible jump; it should use the same crossfade as a track change. "Confidence" has no definition yet (`ARCHITECTURE.md` D6). Candidates are the model's own uncertainty, distance from the training distribution, or agreement with the genre prior.

## 6. Production Integration (Windows)

| Layer | Role |
| :--- | :--- |
| **Rust (Tauri)** | Runs the real-time audio loop, feature extraction, and orchestrates Equalizer APO writes. |
| **ONNX Runtime** | Executes the exported neural model inside the Rust runtime. |
| **Equalizer APO** | Applies the final 31-band gains system-wide. |

> **Conflict with the system architecture.** `ARCHITECTURE.md` describes cloud inference and sends features to a backend. This document assumes local ONNX inference. The two cannot both be the v1 design (`ARCHITECTURE.md` D1).

## 7. Model Size, Runtime and Licence

| Concern | Detail | Impact |
| :--- | :--- | :--- |
| **MERT model size** | MERT-v1 comes in 95M and 330M parameter versions. | Heavy for a real-time desktop loop; needs a measured CPU budget. |
| **Frame rate** | MERT-v1 produces features at 75 Hz from 24 kHz audio. | Window length and update rate must be chosen. |
| **Licence** | MERT-v1 weights are published under CC-BY-NC-4.0 (non-commercial). | May block use in a commercial product (see `AI_DATASET_RESEARCH.md`). |
| **CLAP variant** | Several CLAP models exist with different terms. | The exact model and licence must be recorded before adoption. |
| **Fallback encoder** | A lightweight CNN trained in-project. | Avoids third-party weight terms; accuracy to be compared. |

## 8. Implementation Status

| Component | Status | Note |
| :--- | :--- | :--- |
| **Audio capture** | Stubbed | T2.2. |
| **Encoder selection** | Not started | Depends on licence review and latency tests. |
| **Headphone and genre conditioning** | Not started | Headphone embedding source open. |
| **Residual regressor** | Not started | Needs Stage 2 training (`AI_TRAINING_PLAN.md`). |
| **Differentiable filter bank** | Not started | Training-time only. |
| **ONNX export and Rust inference** | Planned | T3.1, T3.2. |
| **Safety clamp and fallback** | Planned | T3.3. |

> **Hypothesis.** If a pretrained audio embedding captures a song's tonal balance, then a small residual head conditioned on headphone and genre can predict corrections that a deterministic baseline cannot, and a clamp will keep those corrections safe.
