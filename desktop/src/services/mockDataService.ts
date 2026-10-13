// Mock data service for UI development
// Generates realistic track data for testing UI components

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  subgenre: string;
  durationSeconds: number;
  sampleRate: number;
  bitDepth: number;
  channelCount: number;
}

const GENRES = ['Rock', 'Pop', 'Hip Hop', 'Electronic', 'Jazz', 'Classical', 'R&B', 'Country', 'Metal', 'Indie'];
const SUBGENRES = {
  'Rock': ['Classic Rock', 'Alternative', 'Hard Rock', 'Indie Rock', 'Punk'],
  'Pop': ['Synth Pop', 'Dream Pop', 'Indie Pop', 'Teen Pop', 'dance pop'],
  'Hip Hop': ['Trap', 'Boom Bap', 'Cloud Rap', 'Drill', 'Conscious'],
  'Electronic': ['Techno', 'House', 'Trance', 'Dubstep', 'Ambient'],
  'Jazz': ['Smooth Jazz', 'Bebop', 'Modal', 'Fusion', 'Latin Jazz'],
  'Classical': ['Baroque', 'Romantic', 'Modern', 'Chamber', 'Orchestral'],
  'R&B': ['Contemporary', 'Soul', 'Neo Soul', 'Funk', 'Quiet Storm'],
  'Country': ['Traditional', 'Modern', 'Country Rock', 'Bluegrass', 'Outlaw'],
  'Metal': ['Death Metal', 'Black Metal', 'Power Metal', 'Doom Metal', 'Nu Metal'],
  'Indie': ['Lo-Fi', 'Dream Pop', 'Shoegaze', 'Indie Folk', 'Garage Rock']
};

const MOBILE_TRACKS = [
  { title: 'Midnight City', artist: 'M83' },
  { title: 'Blinding Lights', artist: 'The Weeknd' },
  { title: 'Bohemian Rhapsody', artist: 'Queen' },
  { title: 'Hotel California', artist: 'Eagles' },
  { title: 'Dreams', artist: 'Fleetwood Mac' },
  { title: 'Sweet Child O Mine', artist: 'Guns N\' Roses' },
  { title: 'Smells Like Teen Spirit', artist: 'Nirvana' },
  { title: 'Wonderwall', artist: 'Oasis' },
  { title: 'Lose Yourself', artist: 'Eminem' },
  { title: 'Rolling in the Deep', artist: 'Adele' }
];

const HEADPHONES = ['Sennheiser HD 650', 'Beyerdynamic DT 990 Pro', 'Audio-Technica ATH-M50x', 'Sony WH-1000XM5', 'Grado SR325e'];

export function getMockTrack(): Track {
  const genre = GENRES[Math.floor(Math.random() * GENRES.length)];
  const subgenres = SUBGENRES[genre];
  const subgenre = subgenres[Math.floor(Math.random() * subgenres.length)];
  const track = MOBILE_TRACKS[Math.floor(Math.random() * MOBILE_TRACKS.length)];
  const headphone = HEADPHONES[Math.floor(Math.random() * HEADPHONES.length)];

  return {
    id: `track-${Date.now()}`,
    title: track.title,
    artist: track.artist,
    album: ` Greatest Hits`,
    genre: genre,
    subgenre: subgenre,
    durationSeconds: Math.floor(Math.random() * 180) + 120, // 2-5 minutes
    sampleRate: 44100,
    bitDepth: 16,
    channelCount: 2
  };
}

export function getMockTrackWithOverrides(overrides: Partial<Track> = {}): Track {
  const baseTrack = getMockTrack();
  return { ...baseTrack, ...overrides };
}

export function getMockTrackList(count: number = 5): Track[] {
  return Array.from({ length: count }, () => getMockTrack());
}

export function getMockHeadphones(): string[] {
  return [...HEADPHONES];
}

export function getMockGenres(): string[] {
  return [...GENRES];
}

export function getMockSubgenres(genre: string): string[] {
  return SUBGENRES[genre] || [];
}
