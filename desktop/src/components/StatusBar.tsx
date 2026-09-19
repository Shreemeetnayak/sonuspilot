// ── StatusBar ─────────────────────────────────────────────────────────
// Shows cloud connectivity, EQ engine status, and current output device.

export type ServiceStatus = "online" | "offline" | "loading";

interface StatusBarProps {
  cloudStatus: ServiceStatus;
  eqStatus: ServiceStatus;
  outputDeviceName?: string;
}

function dot(status: ServiceStatus) {
  const cls = {
    online:  "statusbar__dot statusbar__dot--online",
    offline: "statusbar__dot statusbar__dot--offline",
    loading: "statusbar__dot statusbar__dot--loading",
  }[status];
  return <span className={cls} aria-hidden="true" />;
}

function label(status: ServiceStatus) {
  return { online: "Connected", offline: "Offline", loading: "Connecting…" }[status];
}

export default function StatusBar({
  cloudStatus,
  eqStatus,
  outputDeviceName,
}: StatusBarProps) {
  return (
    <footer className="statusbar" role="status" aria-live="polite">
      <div className="statusbar__item">
        {dot(cloudStatus)}
        <span>SonusPilot Cloud — {label(cloudStatus)}</span>
      </div>

      <div className="statusbar__item">
        {dot(eqStatus)}
        <span>EQ Engine — {label(eqStatus)}</span>
      </div>

      <div className="statusbar__item">
        <span>{outputDeviceName ?? "No output device"}</span>
      </div>
    </footer>
  );
}
