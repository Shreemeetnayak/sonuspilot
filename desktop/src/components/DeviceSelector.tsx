import "./DeviceSelector.css";

// ── Types ─────────────────────────────────────────────────────────────
export interface OutputDevice {
  id: string;
  name: string;
}

export interface HeadphoneProfile {
  id: string;
  brand: string;
  model: string;
}

interface DeviceSelectorProps {
  outputDevice?: OutputDevice | null;
  headphone?: HeadphoneProfile | null;
  onChangeHeadphone?: () => void;
}

// ── Icons (inline SVG) ────────────────────────────────────────────────
function SpeakerIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function HeadphonesIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" />
      <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

// ── Component ─────────────────────────────────────────────────────────
export default function DeviceSelector({
  outputDevice,
  headphone,
  onChangeHeadphone,
}: DeviceSelectorProps) {
  return (
    <div className="device-selector">
      <div className="card__label">Audio Device</div>

      {/* Output device (read-only — Windows selects this) */}
      <div className="device-row" style={{ cursor: "default" }}>
        <div className="device-row__icon">
          <SpeakerIcon />
        </div>
        <div className="device-row__info">
          <div className="device-row__name">
            {outputDevice?.name ?? "No output detected"}
          </div>
          <div className="device-row__sub">Output device</div>
        </div>
      </div>

      {/* Headphone mapping (user-selectable) */}
      <div className="headphone-label">
        <HeadphonesIcon />
        Headphones / IEM
      </div>
      <div
        className={`device-row${!headphone ? " device-row--unmapped" : ""}`}
        onClick={onChangeHeadphone}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onChangeHeadphone?.()}
        aria-label="Select headphone model"
      >
        <div className="device-row__icon">
          <HeadphonesIcon />
        </div>
        <div className="device-row__info">
          <div className="device-row__name">
            {headphone
              ? `${headphone.brand} ${headphone.model}`
              : "Select headphone…"}
          </div>
          <div className="device-row__sub">
            {headphone ? "Harman 2018 compensation" : "Tap to map a model"}
          </div>
        </div>
        <div className="device-row__action">
          <ChevronRightIcon />
        </div>
      </div>
    </div>
  );
}
