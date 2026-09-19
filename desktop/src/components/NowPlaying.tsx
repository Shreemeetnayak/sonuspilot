import "./NowPlaying.css";

// ── Types ─────────────────────────────────────────────────────────────
export interface SubgenreWeight {
  name: string;
  weight: number; // 0.0 – 1.0
}

export interface NowPlayingData {
  title: string;
  artist: string;
  album: string;
  artworkUrl?: string;
  subgenres: SubgenreWeight[];
  status: "playing" | "paused" | "stopped";
}

interface NowPlayingProps {
  data?: NowPlayingData | null;
  mode: "auto" | "manual" | "preset" | "neutral";
}

// ── Music note icon (inline SVG, no deps) ─────────────────────────────
function MusicNoteIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

// ── Mode badge labels ─────────────────────────────────────────────────
const MODE_LABELS: Record<NowPlayingProps["mode"], string> = {
  auto:    "Auto EQ",
  manual:  "Manual",
  preset:  "Preset",
  neutral: "Neutral",
};

// ── Component ─────────────────────────────────────────────────────────
export default function NowPlaying({ data, mode }: NowPlayingProps) {
  const hasTrack = !!data && data.status !== "stopped";

  return (
    <div className="nowplaying">
      {/* Artwork */}
      <div className="nowplaying__artwork-wrap">
        {hasTrack && data!.artworkUrl ? (
          <img
            className="nowplaying__artwork"
            src={data!.artworkUrl}
            alt={`${data!.title} artwork`}
            draggable={false}
          />
        ) : (
          <div className="nowplaying__artwork-placeholder">
            <MusicNoteIcon />
          </div>
        )}
        <span className="nowplaying__mode-badge">{MODE_LABELS[mode]}</span>
      </div>

      {/* Track metadata */}
      {hasTrack ? (
        <>
          <div className="nowplaying__meta">
            <div className="nowplaying__title">{data!.title}</div>
            <div className="nowplaying__artist">{data!.artist}</div>
            {data!.album && (
              <div className="nowplaying__album">{data!.album}</div>
            )}
          </div>

          {/* Subgenre Sound DNA chips */}
          {data!.subgenres.length > 0 && (
            <div className="genre-chips">
              {data!.subgenres.map((sg, i) => (
                <span
                  key={sg.name}
                  className={`genre-chip${i === 0 ? " genre-chip--primary" : ""}`}
                >
                  {sg.name}
                  <span className="genre-chip__weight">
                    {Math.round(sg.weight * 100)}%
                  </span>
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="nowplaying__empty">
          <div className="nowplaying__empty-icon">
            <MusicNoteIcon />
          </div>
          <div className="nowplaying__empty-text">
            No track playing.<br />
            Start music in any app to begin.
          </div>
        </div>
      )}
    </div>
  );
}
