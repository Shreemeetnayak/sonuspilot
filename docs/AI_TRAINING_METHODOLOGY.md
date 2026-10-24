# AI Training Methodology: Reinforcement Learning (RL)

## 1. Overview
SonusPilot uses a Model-in-the-Loop Reinforcement Learning (RL) framework to optimize 31-band EQ curves. The system treats EQ optimization as a Sequential Decision Process (MDP) where the agent (EQ model) interacts with the environment (Audio stream + Equalizer APO) to maximize perceptual sound quality.

## 2. Training Loop
The training loop utilizes Population-Based Training (PBT) to evolve optimal strategies:
- **State ($S$):** Latent audio embeddings (via CLAP/MERT), headphone frequency response, and genre/subgenre metadata.
- **Action ($A$):** Continuous adjustment of 31-band EQ gains (constrained to [-MAX_GAIN, +MAX_GAIN]).
- **Reward ($R$):** Composite objective function based on spectral distance, perceptual loss, and a learned critic model.

### Process
1. **PBT Initialization:** Parallel agent population explores different EQ strategies.
2. **Action/Loopback:** Actions are applied via APO and captured via WASAPI loopback.
3. **Reward Evaluation:** The Critic model (trained on user feedback) scores the perceptual quality.
4. **Update:** Successful policies are propagated; inefficient exploration nodes are replaced.
5. **Iteration:** Advance to the next random track/genre to ensure generalizability.

## 3. Evaluation & Testing
- **Artist/Album Disjoint Splits:** 70% Training / 30% Testing, ensuring the model generalizes to unseen data.
- **Multi-Metric Validation:** 
    - Spectral Reconstruction Metrics (Loss on frequency response).
    - Perceptual Loss (Psychoacoustic masking/harshness).
    - Critic Score (Learned preference).
- **Overfitting/Underfitting Monitoring:** Track training vs. testing loss curves iteratively, adjusting model capacity and regularization as needed.

## 4. Implementation
- Implemented as a modular Python/Rust service pipeline.
- Evaluation artifacts are stored per run for auditability.
