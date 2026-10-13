# AI EQ Research

## Core Research Findings
*   **Automatic Equalization Approaches:** Research indicates that automatic EQ is a non-convex optimization problem. Differentiable digital signal processing (DDSP) and differentiable biquads are state-of-the-art for parametric EQ matching and optimization, allowing for direct frequency-domain optimization.
*   **Audio Understanding:** State-of-the-art models for music understanding (like MERT, CLAP) provide rich embeddings. These are significantly better for feature extraction than manual hand-crafted features (like MFCCs/spectral flux), as they capture high-level semantic and timbral content.
*   **Critic/Reward Models:** Instead of pure self-supervised spectral matching, a learned critic/reward model can better evaluate the perceptual balance of the output, avoiding "reward hacking" (e.g., loudness bias or over-correction) by ensuring the critic is conditioned on audio features and headphone/context constraints.
*   **Self-Supervised Learning (SSL):** Research suggests training audio representations through pretext tasks like spectral reconstruction, masked audio modeling, or predicting applied artificial degradations is highly effective for bootstrapping audio understanding.
*   **Dataset Feasibility:** Publicly available datasets like FMA and MTG-Jamendo are suitable for non-commercial research, provided CC-BY attribution is respected.

## Key References
*   Nercessian, S. (2020). *Neural Parametric Equalizer Matching Using Differentiable Biquads*.
*   Bogdanov, D., et al. (2019). *The MTG-Jamendo Dataset for Automatic Music Tagging*.
*   Defferrard, M., et al. (2017). *FMA: A Dataset for Music Analysis*.
*   Differentiable Signal Processing (DDSP) and Black-Box Audio Effects research.
