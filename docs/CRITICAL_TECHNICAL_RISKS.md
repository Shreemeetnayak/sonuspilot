# SonusPilot — Critical Technical Risks & Corrections

**Author:** Senior Architecture Review  
**Date:** 2026-09-18  
**Purpose:** Identify and correct technical assumptions, API limitations, and architectural flaws before implementation begins.

---

## 1. Spotify Audio Features API — DEPRECATED (CRITICAL)

### The Problem
Your product concept relies heavily on Spotify's audio features endpoint to obtain **BPM, energy, danceability, acousticness, valence, instrumentalness, speechiness, and liveness**. 

**As of November 27, 2024, Spotify officially deprecated these endpoints:**
* `GET /v1/audio-features/{id}`
* `GET /v1/audio-features` (batch)
* `GET /v1/audio-analysis/{id}`

They are scheduled for **complete removal**. No replacement service has been announced.

### Impact
You **cannot** build SonusPilot's audio feature pipeline around Spotify Web API. This eliminates a cornerstone of your "Sound DNA" strategy as originally conceived.

### Solutions
1. **Third-Party Audio Analysis APIs**
   * **AcousticBrainz** (now deprecated, but successor projects exist)
   * **Essentia** (open-source audio analysis library — self-hosted)
   * **librosa** (Python DSP library for extracting spectral features, onset detection, tempo)
   * **Aubio** (real-time audio feature extraction in C/Python)

2. **Build Your Own Audio Fingerprinting + Feature Extraction Pipeline**
   * Use **AcoustID/Chromaprint** to fingerprint songs from the audio stream (requires access to decoded PCM).
   * Run **Essentia extractors** on decoded audio to derive BPM, key, spectral rolloff, MFCC, etc.
   * This is computationally expensive and requires access to the raw audio stream — which GSMTC does NOT provide.

3. **Pivot to Pure Metadata-Based Classification (Recommended for MVP)**
   * Accept that audio features are unavailable without raw audio access.
   * Rely entirely on **genre/subgenre tags from MusicBrainz, Last.fm, and Discogs**.
   * Derive "Sound DNA" from **statistical genre profiles** rather than per-song audio analysis.
   * Future enhancement: Add optional audio fingerprinting for users who grant microphone/loopback access.

**Recommendation:** For the MVP, abandon real-time per-song audio feature extraction. Focus on genre-tag-based Sound DNA and manual subgenre reference profiles. Reserve audio analysis for a future "advanced mode."

---

## 2. GSMTC Does Not Expose Track IDs

### The Problem
Windows GSMTC provides **only string metadata** (title, artist, album). It does **not** provide:
* Spotify URI or Track ID
* MusicBrainz Recording ID
* ISRC codes
* Any unique identifier

### Impact
You must perform **fuzzy text-based lookups** against MusicBrainz/Last.fm/Discogs using title + artist strings. This introduces:
* **Ambiguity:** Multiple recordings with the same title/artist (live versions, remasters, covers).
* **API Overhead:** Text search is slower and less accurate than ID-based lookup.
* **Rate-Limit Pressure:** You may need 2-3 API calls to resolve one song (MusicBrainz search → recording lookup → tag fetch).

### Solutions
1. **Canonical Title Normalization**
   * Strip parentheticals: `"Song Title (Remastered)"` → `"Song Title"`
   * Remove feat./ft. annotations
   * Lowercase and trim whitespace
   * Store normalized hash as `title_hash` for cache lookups

2. **MusicBrainz Lucene Search API**
   * Use the `/ws/2/recording?query=` endpoint with weighted search:
     ```
     recording:"{title}" AND artist:"{artist}" AND release:"{album}"
     ```
   * Parse the top result's MBID and tags.

3. **Accept Ambiguity & Store Confidence Scores**
   * Tag each resolved song with a `confidence_score` (0.0–1.0).
   * If confidence < 0.7, apply a generic fallback genre EQ rather than a highly specific subgenre blend.

**Recommendation:** Implement a two-tier caching strategy:
1. **Local cache** (SQLite) stores `(title_hash, artist_hash) → resolved_profile`.
2. **Cloud cache** (Redis) stores global resolutions to avoid re-querying MusicBrainz for popular songs.

---

## 3. MusicBrainz Does Not Provide BPM

### The Problem
MusicBrainz **does not** store BPM in its core data model. You listed BPM as a desired feature, but it is not available from this API.

### Solutions
1. **AcousticBrainz (Deprecated)** — Was a sister project to MusicBrainz that stored computed audio features including BPM, but it shut down in 2022.
2. **Last.fm** — Does not provide BPM either.
3. **Spotify** — Previously provided BPM via audio features endpoint (now deprecated).
4. **Manual BPM Database** — Build a small curated dataset of BPM for popular subgenres, or crowdsource it.
5. **Client-Side Beat Detection** — Use Essentia or Aubio to detect BPM from audio loopback (requires microphone/loopback permission).

**Recommendation:** Deprioritize BPM for MVP. It is not essential to the core EQ-adaptation product. If you need it later, add optional audio analysis for users who opt in.

---

## 4. Equalizer APO Limitations

### The Problem
Equalizer APO is **not a universal solution** for system-wide EQ. It has significant limitations:

1. **WASAPI Exclusive Mode:** Applications using exclusive mode (e.g., professional DAWs, some games) **bypass** the Windows audio engine entirely. Equalizer APO has no effect on them.
2. **ASIO Drivers:** Applications using ASIO (studio-grade low-latency audio) also bypass Equalizer APO.
3. **Installation Friction:** Users must manually install Equalizer APO. It is not redistributable with your app.
4. **Windows Updates:** Some Windows 11 feature updates have broken Equalizer APO, requiring reinstallation.

### Impact
SonusPilot **will not work** for:
* Audiophile users with ASIO-enabled DAWs (FL Studio, Ableton Live, Reaper)
* Gamers using exclusive-mode audio
* Users who haven't installed Equalizer APO

### Solutions
1. **Document Requirements Clearly**
   * The installer should check for Equalizer APO and prompt the user to install it if missing.
   * Provide a one-click download link to the official Equalizer APO installer.

2. **Build a Custom APO (Long-Term)**
   * Invest in EV code-signing certificate (~$300-500/year).
   * Develop a user-mode APO in C/C++ that SonusPilot installs as part of setup.
   * This gives you full control and eliminates the dependency on third-party software.

3. **Virtual Audio Device Fallback (Not Recommended)**
   * Too much latency (20-40ms).
   * Requires manual routing setup.
   * Still doesn't capture ASIO or exclusive-mode apps.

**Recommendation:** For MVP, **require Equalizer APO as a dependency** and clearly document this limitation. For v2.0, invest in a custom APO.

---

## 5. Headphone Compensation Data Licensing

### The Problem
You want to use headphone frequency response measurements to build compensation profiles. The best public data sources are:

* **AutoEq:** 6,000+ headphone profiles, but **CC BY-NC-SA 4.0** (non-commercial).
* **Oratory1990:** High-quality parametric EQ presets, but **no formal license** — requires direct contact for commercial use.
* **Crinacle:** Excellent IEM measurements, but **commercial licensing required** (paid).
* **RTINGS:** Proprietary, requires partnership agreement.

### Impact
You **cannot legally use AutoEq or Oratory1990 data in SonusPilot** without explicit permission or a commercial license agreement.

### Solutions
1. **Take Your Own Measurements**
   * Purchase an IEC-711 coupler (~$1,000-3,000) and measure popular headphones yourself.
   * Publish under your own permissive license.

2. **License Crinacle's Data**
   * Visit https://crinacle.com/sound-profile-licenses/ and negotiate a commercial license.

3. **User-Generated Profiles**
   * Allow users to upload their own REW (Room EQ Wizard) measurements.
   * Convert their measurements into Equalizer APO parametric EQ presets.

4. **Minimal MVP Dataset**
   * Start with 10-20 manually curated headphone profiles for popular models (e.g., AirPods Pro, Sony WH-1000XM5, Sennheiser HD 600).
   * Use only data you have legal rights to or derive yourself.

**Recommendation:** For MVP, manually create 15-20 headphone compensation profiles based on published target curves (e.g., Harman 2018). Expand the library post-launch through licensing or user contributions.

---

## 6. Genre Taxonomy Inconsistency

### The Problem
Different metadata sources use incompatible genre systems:

* **MusicBrainz:** ~2,000 curated genres (e.g., `"Thrash Metal"`)
* **Last.fm:** Folksonomy tags, case-sensitive (`"Rock"` ≠ `"rock"`)
* **Spotify:** Algorithmic micro-genres (`"bedroom pop"`, `"indie rock"`)
* **Discogs:** Two-level structure: 15 genres + 700 styles

### Impact
You will receive conflicting genre labels from different APIs. For example:
* MusicBrainz says: `"Heavy Metal"`
* Last.fm says: `"thrash metal"`, `"speed metal"`, `"Heavy Metal"`
* Discogs says: Genre = `"Rock"`, Style = `["Thrash", "Speed Metal"]`

### Solutions
1. **Canonical Genre Mapping Table**
   * Build a normalization map in your database:
     ```sql
     CREATE TABLE genre_aliases (
         canonical_name VARCHAR(100) PRIMARY KEY,
         alias VARCHAR(100) UNIQUE NOT NULL
     );
     INSERT INTO genre_aliases VALUES ('thrash_metal', 'Thrash Metal');
     INSERT INTO genre_aliases VALUES ('thrash_metal', 'thrash metal');
     INSERT INTO genre_aliases VALUES ('thrash_metal', 'Thrash');
     ```

2. **Weighted Consensus Algorithm**
   * Assign reliability weights to each source:
     * MusicBrainz curated genres: 1.0
     * Discogs styles: 0.9
     * Last.fm top tags (>1000 votes): 0.7
     * Last.fm rare tags (<100 votes): 0.3
   * Calculate weighted subgenre probabilities from all sources.

3. **Fallback Hierarchy**
   * If APIs disagree significantly (entropy too high), fall back to the **album-level or artist-level genre** rather than track-level.

**Recommendation:** Implement a fuzzy-matching normalization layer with manual curation of the top 200 most common genre variants.

---

## 7. Cold-Start Problem (New/Obscure Songs)

### The Problem
What happens when:
* A song is brand-new (released this week) and not yet tagged in MusicBrainz or Last.fm?
* A song is extremely obscure and has zero metadata coverage?
* APIs are rate-limited or temporarily down?

### Impact
SonusPilot cannot generate a Sound DNA profile. The user experiences:
* Silence (bad)
* Random/incorrect EQ (bad)
* Long loading delay (bad)

### Solutions
1. **Graceful Fallback Chain**
   ```
   Song Metadata → Cloud Cache → MusicBrainz → Last.fm → Discogs
   └─(Miss)─► Artist-Level Genre → Album-Level Genre → Generic "Unknown" EQ (Neutral 0 dB)
   ```

2. **User Feedback Loop**
   * If a song cannot be classified, show a small toast: *"Unknown song. Help us classify it? [Genre] [Subgenre]"*
   * Store user submissions for manual review and integration into the backend.

3. **Partial Profile Confidence**
   * If only 1 API returns data, apply a low-confidence blend (e.g., 50% inferred profile + 50% neutral).

**Recommendation:** Never fail silently. Always show the user what EQ profile is active, even if it's "Neutral (No metadata available)."

---

## 8. Real-Time Latency Budget

### The Problem
You claimed the system can achieve "200 microseconds" for track changes. This is **physically impossible** for an internet-backed operation.

### Reality Check
* **GSMTC event detection:** 10-50ms (Windows scheduling latency)
* **Network round-trip to backend:** 50-300ms (depending on geography, CDN, cold start)
* **Database lookup:** 1-10ms (Redis cache hit) or 50-200ms (PostgreSQL cache miss + external API call)
* **EQ calculation & crossfade:** 20ms (deliberate, for artifact prevention)

**Total realistic latency: 100-600ms** from track change to EQ applied.

### Solutions
1. **Aggressive Predictive Caching**
   * When a song starts playing, immediately fetch and cache the next 3 songs in the playlist.
   * Use Spotify Web API (if available) or browser playlist scraping to predict upcoming tracks.

2. **Local-First Mode**
   * Store the last 500 resolved song profiles locally in SQLite.
   * If the song is in local cache, apply EQ instantly (<50ms).
   * Background-sync updates from cloud in parallel.

3. **Staged EQ Application**
   * Apply headphone compensation **immediately** (this is device-based, not song-based).
   * Apply subgenre EQ blend as soon as metadata resolves (100-600ms later).
   * User sees "Headphone EQ Active" → "Applying Dream Pop profile..." → "Complete."

**Recommendation:** Set realistic expectations. Target **<100ms for cached songs, <500ms for uncached songs**. Be transparent with a small status indicator showing when EQ is loading.

---

## 9. Storage Footprint (Local Cache Size)

### The Problem
You want minimal local storage, but caching improves UX dramatically. How much is acceptable?

### Analysis
* **1 song profile:** ~2 KB (subgenre weights, metadata, timestamp)
* **500 cached songs:** ~1 MB
* **5,000 cached songs:** ~10 MB
* **Headphone profiles:** ~50 KB each × 20 profiles = 1 MB
* **Application binaries + Tauri runtime:** ~80-120 MB

**Total realistic footprint: ~100-130 MB** (well within your 500 GB budget).

### Solutions
* Cache the last 1,000 played songs locally (only ~2 MB).
* Expire entries older than 90 days.
* Provide a "Clear Cache" button in settings for power users.

**Recommendation:** Local caching is essential for good UX. The footprint is negligible — proceed with it.

---

## 10. AI/ML Strategy — Clarification Required

### The Problem
You mention "AI" and "ML" repeatedly but do not specify:
* **What model architecture?** (Neural network, gradient boosting, simple regression?)
* **What training data?** (User feedback, expert-labeled EQ presets, audio features?)
* **What is being predicted?** (Subgenre confidence? EQ gain values? User preference adjustments?)
* **Where does inference run?** (Cloud? Desktop? Real-time or batch?)

### Impact
Without a concrete ML design, "AI refinement" is just a buzzword placeholder.

### Recommendations
1. **Start Without ML (MVP)**
   * Use deterministic rule-based blending for 6-12 months.
   * Collect user feedback data (manual EQ changes, skip behavior, session duration).

2. **Post-MVP: Preference Learning Model**
   * Train a lightweight regression model (e.g., XGBoost or simple MLP) to predict **per-user EQ offset vectors**.
   * Input features: subgenre weights, headphone model, time of day, listening history.
   * Output: 31-element delta vector to add to the base EQ.
   * Run inference in the cloud backend; return the delta with each profile.

3. **Long-Term: Genre Embedding Model**
   * Train a transformer or audio embedding model (e.g., CLMR, Jukebox) to generate Sound DNA vectors directly from audio.
   * This requires a large labeled dataset (10,000+ songs with expert-labeled subgenre mixtures).
   * Expensive to train; defer until you have revenue.

**Recommendation:** Drop all ML claims from MVP marketing. Add "AI-powered EQ refinement" as a v2.0 feature once you have real user data.

---

## 11. Incorrect Technical Claims to Remove

| Claim | Reality | Correction |
| :--- | :--- | :--- |
| "Spotify provides BPM, energy, valence" | Deprecated Nov 2024 | Remove from design or switch to third-party audio analysis |
| "GSMTC provides track IDs" | No, only strings | Implement fuzzy text-based lookup |
| "200 microsecond EQ switching" | Physically impossible with internet | Set realistic target: <100ms cached, <500ms uncached |
| "AI will optimize EQ from day one" | No model, no training data | Phase ML as v2.0; MVP is rule-based |
| "Universal system-wide EQ" | Equalizer APO doesn't work with ASIO/exclusive mode | Document limitations clearly |
| "Download EQs for every song" | Licensing violation | Use blended reference profiles, not per-song files |

---

## 12. Recommended MVP Scope Reduction

To ship a functional, legally compliant, technically sound prototype:

### In Scope (MVP)
✅ Windows GSMTC track detection  
✅ MusicBrainz + Last.fm genre/tag lookup  
✅ Fuzzy text-based song matching  
✅ Tag normalization & consensus (top 100 subgenres)  
✅ Weighted subgenre blending (deterministic math)  
✅ 31-band parametric EQ via Equalizer APO + Peace CLI  
✅ 20ms equal-power crossfade  
✅ 15-20 manually curated headphone compensation profiles  
✅ Local cache (SQLite) for 1,000 recent songs  
✅ Cloud backend (Node.js/Rust + PostgreSQL + Redis)  
✅ Manual user preference adjustments  

### Out of Scope (Defer to v2.0+)
❌ Real-time audio feature extraction (BPM, energy, valence)  
❌ Audio fingerprinting (AcoustID/Chromaprint)  
❌ AI/ML-based EQ prediction  
❌ AutoEq integration (licensing issues)  
❌ Custom APO development (requires EV cert)  
❌ macOS/Linux support  
❌ ASIO/exclusive-mode audio support  
❌ Offline mode (internet required for MVP)  

---

## Conclusion

The original product vision is **achievable**, but several key assumptions were technically incorrect or legally problematic. This document corrects those mistakes and provides a realistic, shippable architecture.

**Next Steps:**
1. Accept that Spotify audio features are unavailable — pivot to pure metadata-based classification.
2. Build a robust tag normalization layer for MusicBrainz/Last.fm inconsistencies.
3. Clarify the long-term ML roadmap (defer to post-MVP).
4. Secure headphone compensation data through licensing or original measurements.
5. Set realistic latency expectations (<500ms for cold starts is acceptable).
6. Focus on 15-20 curated subgenre profiles for MVP rather than attempting comprehensive coverage.
