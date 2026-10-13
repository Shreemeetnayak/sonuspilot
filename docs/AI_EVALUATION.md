# AI Evaluation Strategy

## Metrics
*   **Spectral MAE (Mean Absolute Error):** Per-band error against ground-truth user preferences.
*   **Residual Magnitude:** Penalty for excessive correction (gain magnitude > 3dB).
*   **Smoothness:** Penalty for adjacent-band gain divergence.
*   **Clipping Protection:** Hard constraint enforcement via final output validation.

## Evaluation Protocol
1.  **Held-Out Tracks:** Evaluate model performance on tracks unseen during training.
2.  **Baselines:** Compare against deterministic baseline and zero-residual baseline.
3.  **Adversarial Check:** Ensure the model does not attempt "reward hacking" (loudness boosting, spectral flattening).
