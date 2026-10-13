// Music classification at metadata capability level.
//
// GSMTC gives us title/artist/album, not PCM. So this classifier works from
// text evidence only and reports how it got there. Anything it cannot infer
// from metadata is left out rather than invented.

export interface TrackMetadata {
  title: string;
  artist: string;
  album: string;
}

export interface SubgenreWeight {
  name: string;
  weight: number;
}

interface GenreLexicon {
  genre: string;
  // Words that suggest this genre in titles, albums or artist names.
  terms: readonly string[];
}

const LEXICON: readonly GenreLexicon[] = [
  { genre: "Thrash Metal", terms: ["thrash", "megadeth", "slayer", "testament", "exodus"] },
  { genre: "Death Metal", terms: ["death metal", "cannibal", "necrophobic", "possessed"] },
  { genre: "Doom Metal", terms: ["doom", "saint vitus", "pentagram", "black sabbath"] },
  { genre: "Speed Metal", terms: ["speed metal", "helloween", "running wild", "blind guardian"] },
  { genre: "Heavy Metal", terms: ["metal", "iron maiden", "judas priest", "accept"] },
  { genre: "Hard Rock", terms: ["hard rock", "ac/dc", "guns n roses", "aerosmith", "led zeppelin"] },
  { genre: "EDM", terms: ["edm", "house", "techno", "trance", "dubstep", "drum and bass", "dnb", "electro"] },
  { genre: "Hip-Hop", terms: ["hip hop", "hip-hop", "rap", "trap", "drill", "boombap", "boom bap"] },
  { genre: "Jazz", terms: ["jazz", "bebop", "swing", "cool jazz"] },
  { genre: "Classical", terms: ["classical", "symphony", "concerto", "sonata", "nocturne", "prelude", "baroque", "mozart", "bach", "beethoven"] },
  { genre: "Acoustic", terms: ["acoustic", "unplugged", "folk", "singer songwriter"] },
  { genre: "Podcast", terms: ["podcast", "episode", "interview", "talk show", "news"] },
  { genre: "Dream Pop", terms: ["dream pop", "shoegaze", "ambient", "ethereal"] },
];

/**
 * Score each lexicon entry against the metadata and return a normalised
 * weighted mixture. Returns an empty list when nothing matches, which the
 * pipeline treats as "unknown" rather than guessing a genre.
 */
export function classifyTrack(metadata: TrackMetadata): SubgenreWeight[] {
  const haystack = `${metadata.title} ${metadata.artist} ${metadata.album}`.toLowerCase();
  if (!haystack.trim()) return [];

  const scores = LEXICON.map((entry) => ({
    name: entry.genre,
    // Longer terms are stronger evidence than a bare "metal".
    score: entry.terms.reduce((sum, term) => {
      if (!haystack.includes(term)) return sum;
      return sum + (term.includes(" ") ? 2 : 1);
    }, 0),
  })).filter((item) => item.score > 0);

  if (scores.length === 0) return [];

  const total = scores.reduce((sum, item) => sum + item.score, 0);
  return scores
    .map((item) => ({ name: item.name, weight: Number((item.score / total).toFixed(3)) }))
    .sort((a, b) => b.weight - a.weight);
}

/** Genre mixture as a single string, e.g. "Thrash Metal 70% / Speed Metal 30%". */
export function describeMixture(mixture: SubgenreWeight[]): string {
  if (mixture.length === 0) return "Unknown";
  return mixture.map((item) => `${item.name} ${Math.round(item.weight * 100)}%`).join(" / ");
}
