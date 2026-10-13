import { useState } from "react";
import "./Settings.css";
import {
  getAppSettings,
  resetAppSettings,
  saveAppSettings,
  type AppSettings,
} from "../services/appSettingsService";
import {
  createUnmeasuredProfile,
  getDeviceMappings,
  getProfiles,
  mapOutputDeviceToHeadphone,
  removeProfile,
  type HeadphoneProfileData,
} from "../services/headphoneProfileService";
import { clearLearnedData } from "../services/cloudEqService";

interface SettingsPageProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  outputDevice: { id: string; name: string } | null;
  onClose: () => void;
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="settings-row">
      <span className="settings-row__text">
        <span className="settings-row__label">{label}</span>
        <span className="settings-row__hint">{hint}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

export default function SettingsPage({
  settings,
  onChange,
  outputDevice,
  onClose,
}: SettingsPageProps) {
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [profiles, setProfiles] = useState<HeadphoneProfileData[]>(() => getProfiles());
  const [mappings, setMappings] = useState(() => getDeviceMappings());
  const [profileCount, setProfileCount] = useState(() => getProfiles().length);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const next = { ...settings, [key]: value };
    saveAppSettings(next);
    onChange(next);
  };

  const addHeadphone = () => {
    if (!brand.trim() || !model.trim()) return;
    const profile = createUnmeasuredProfile(brand, model);
    setProfiles((prev) => [...prev, profile]);
    setBrand("");
    setModel("");
  };

  const mapCurrentDevice = (profileId: string) => {
    if (!outputDevice) return;
    mapOutputDeviceToHeadphone(outputDevice.id, profileId);
    setMappings(getDeviceMappings());
  };

  const clearLearned = () => {
    clearLearnedData();
    setProfileCount(getProfiles().length);
  };

  return (
    <main className="settings">
      <header className="settings__header">
        <h1>Settings</h1>
        <button className="settings__close" onClick={onClose} aria-label="Back to equalizer">
          Back
        </button>
      </header>

      <section className="settings__section">
        <h2>Auto-EQ</h2>
        <Toggle
          label="Auto-EQ enabled"
          hint="When off, SonusPilot writes a neutral curve to Equalizer APO."
          checked={settings.autoEqEnabled}
          onChange={(value) => update("autoEqEnabled", value)}
        />
        <Toggle
          label="Auto-detect track changes"
          hint="Reads Windows media sessions to change profiles on its own."
          checked={settings.autoDetectTracks}
          onChange={(value) => update("autoDetectTracks", value)}
        />
        <Toggle
          label="Show feedback controls"
          hint="Turn off to stop recording listening feedback."
          checked={settings.feedbackEnabled}
          onChange={(value) => update("feedbackEnabled", value)}
        />
        <label className="settings-row">
          <span className="settings-row__text">
            <span className="settings-row__label">Maximum correction</span>
            <span className="settings-row__hint">Caps any single band in the final curve.</span>
          </span>
          <input
            type="number"
            min={0}
            max={12}
            step={0.5}
            value={settings.maximumCorrectionDb}
            onChange={(event) => update("maximumCorrectionDb", Number(event.target.value))}
          />
        </label>
      </section>

      <section className="settings__section">
        <h2>Output device &amp; headphones</h2>
        <p className="settings__hint">
          {outputDevice ? `Active output: ${outputDevice.name}` : "No output device detected."}
        </p>
        <div className="settings__add">
          <input
            placeholder="Brand"
            value={brand}
            onChange={(event) => setBrand(event.target.value)}
            aria-label="Headphone brand"
          />
          <input
            placeholder="Model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            aria-label="Headphone model"
          />
          <button onClick={addHeadphone}>Add</button>
        </div>
        <ul className="settings__profiles">
          {profiles.map((profile) => (
            <li key={profile.id}>
              <span>
                {profile.brand} {profile.model}
                {mappings.some((m) => m.headphoneProfileId === profile.id) ? " — mapped" : ""}
              </span>
              <span className="settings__profile-actions">
                <button onClick={() => mapCurrentDevice(profile.id)} disabled={!outputDevice}>
                  Map to current output
                </button>
                <button
                  onClick={() => {
                    removeProfile(profile.id);
                    setProfiles(getProfiles());
                    setMappings(getDeviceMappings());
                  }}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="settings__section">
        <h2>Learned data</h2>
        <p className="settings__hint">{profileCount} learned profile(s) stored locally.</p>
        <button onClick={clearLearned}>Clear learned data and feedback</button>
      </section>

      <section className="settings__section">
        <h2>About</h2>
        <p className="settings__hint">SonusPilot 0.2.0 — local decision pipeline, Equalizer APO backend.</p>
        <button onClick={() => { resetAppSettings(); onChange(getAppSettings()); }}>
          Restore default settings
        </button>
      </section>
    </main>
  );
}
