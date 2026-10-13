import { EQLayer } from "./eqDecisionEngine";

export interface SongAudioFeatures {
  rms: number;
  peak: number;
  crest_factor: number;
  spectral_bands: number[];
  spectral_centroid: number;
}

export interface SongFeatures {
  trackId: string;
  genre: string;
  audioFeatures?: SongAudioFeatures;
}

export function extractSongFeatures(metadata: any, audioFeatures?: SongAudioFeatures): SongFeatures {
  return {
    trackId: `${metadata.title}-${metadata.artist}`,
    genre: metadata.subgenres?.[0]?.name || "unknown",
    audioFeatures,
  };
}

export function computeResidual(features: SongFeatures, headphoneId: string): EQLayer {
  if (!features || !headphoneId) {
    return { source: "none", gains: new Array(31).fill(0), confidence: 0 };
  }

  // If real audio features exist, calculate an adaptive residual based on spectral balance
  if (features.audioFeatures && features.audioFeatures.spectral_bands.length === 31) {
    // A simplified model that applies dynamic cut/boost based on energy
    const gains = features.audioFeatures.spectral_bands.map((energy, i) => {
      // Small learned/modeled adjustment: reduce harshness if excessive energy in high bands
      if (i > 20 && energy > 0.5) return -1.5;
      if (i < 5 && energy < 0.2) return 1.0; // Bass boost for weak low-end
      return 0.0;
    });

    return {
      source: "model",
      gains,
      confidence: 0.75, // Higher confidence because real audio features were used
    };
  }

  // Fallback to deterministic baseline (zero residual)
  return {
    source: "none",
    gains: new Array(31).fill(0),
    confidence: 0,
  };
}
