# AI Training Plan

## Stage 1: Audio Understanding (Self-Supervised)
*   **Objective:** Pretrain an audio encoder (or fine-tune MERT/CLAP) to understand musical structure and spectral balance without EQ labels.
*   **Pretext Task:** Masked Audio Modeling / Spectral Reconstruction on FMA/MTG-Jamendo datasets.

## Stage 2: Residual EQ Prediction
*   **Objective:** Predict a 31-band residual EQ from audio features, headphone profile, and genre context.
*   **Data:** Synthetic EQ degradations applied to clean audio from the FMA/MTG-Jamendo dataset.
*   **Loss Function:** Log-magnitude spectral distance + smoothness penalty + headroom penalty.

## Stage 3: Personalized Residual (Future)
*   **Objective:** Personalize the residual model using real user preference events (Manual EQ changes).
*   **Data:** Genuine user interaction data coalesced into preference events.
