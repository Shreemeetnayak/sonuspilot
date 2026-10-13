/**
 * EQ engine diagnostics.
 *
 * These checks exist because the failure they catch is invisible: Equalizer APO
 * silently stops processing the session when it is not in the exclusive-mode
 * chain, and a second DSP driver (FxSound, Sonos, Voicemeeter) in the chain
 * will fight it. In both cases SonusPilot still writes a correct config file
 * and still reports "applied" — the music just does not change.
 *
 * Every probe reads real system state. A check that cannot determine its
 * answer returns "unknown", never "ok".
 */

import { invoke } from "@tauri-apps/api/core";

export type DiagnosticSeverity = "ok" | "warn" | "error" | "unknown";

export interface DiagnosticCheck {
  id: string;
  label: string;
  severity: DiagnosticSeverity;
  detail: string;
  /** What the user can actually do about it, when there is something. */
  remedy?: string;
}

export interface EqEngineStatus {
  available: boolean;
  reason: string;
  configPath?: string;
  /** Whether APO was installed in exclusive mode, i.e. in the chain. */
  exclusiveMode?: boolean;
  /** Friendly name of the endpoint APO is bound to, when known. */
  boundEndpoint?: string;
  /** True when config.txt exists on disk. */
  configPresent?: boolean;
}

export async function getEngineStatus(): Promise<EqEngineStatus> {
  try {
    const status = await invoke<EqEngineStatus>("get_eq_engine_status");
    return {
      available: Boolean(status?.available),
      reason: status?.reason ?? "unknown",
      configPath: status?.configPath,
      exclusiveMode: status?.exclusiveMode,
      boundEndpoint: status?.boundEndpoint,
      configPresent: status?.configPresent,
    };
  } catch (e) {
    return { available: false, reason: e instanceof Error ? e.message : "status unavailable" };
  }
}

/** One render endpoint as Windows records it. */
export interface EndpointBinding {
  id: string;
  name: string;
  has_apo: boolean;
}

export interface ApoBinding {
  apo_installed: boolean;
  bound_endpoints: EndpointBinding[];
  all_endpoints: EndpointBinding[];
  error: string | null;
}

const NO_BINDING: ApoBinding = {
  apo_installed: false,
  bound_endpoints: [],
  all_endpoints: [],
  error: "binding not checked",
};

/**
 * Read where APO is registered. Windows keeps no single "APO is bound to X"
 * key, so Rust walks each render endpoint's FX chain — see services/apobinding.rs.
 */
export async function getApoBinding(): Promise<ApoBinding> {
  try {
    return await invoke<ApoBinding>("get_apo_binding");
  } catch (e) {
    return { ...NO_BINDING, error: e instanceof Error ? e.message : "binding unavailable" };
  }
}

/**
 * Known Windows audio drivers that sit in the endpoint chain and do their own
 * processing. If one is present alongside APO, the last one loaded wins and
 * SonusPilot's correction is not what reaches the output.
 *
 * Matched against the live endpoint list by substring, because these drivers
 * present themselves under varying names.
 */
const COMPETING_DSP_DRIVERS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /fxsound/i, label: "FxSound" },
  { pattern: /voicemeeter/i, label: "Voicemeeter" },
  { pattern: /sonos/i, label: "Sonos" },
  { pattern: /\bth-?fi\b|\bthx\b/i, label: "THX" },
  { pattern: /dspatial/i, label: "dSpatial" },
  { pattern: /nahimic/i, label: "Nahimic" },
  { pattern: /\bdts\b/i, label: "DTS" },
  { pattern: /dolby/i, label: "Dolby" },
];

export function detectCompetingDrivers(
  endpointNames: string[]
): Array<{ label: string; matched: string }> {
  const found: Array<{ label: string; matched: string }> = [];
  for (const name of endpointNames) {
    for (const driver of COMPETING_DSP_DRIVERS) {
      if (driver.pattern.test(name)) {
        found.push({ label: driver.label, matched: name });
        break;
      }
    }
  }
  return found;
}

/**
 * Windows route APO's output through. The user must do this or the correction
 * never reaches the endpoint.
 */
export const WINDOWS_APO_ENDPOINT_HINT =
  "Settings → System → Sound → your output device → Audio enhancements → " +
  "enable Equalizer APO (not just the preset dropdown), then Apply. " +
  "On Windows 10: Control Panel → Sound → device Properties → Enhancements.";

export interface DiagnosticInput {
  engine: EqEngineStatus;
  endpointNames: string[];
  boundEndpointName: string | null;
  defaultEndpointName: string | null;
  hasHeadphoneProfile: boolean;
}

export function buildDiagnostics(input: DiagnosticInput): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = [];
  const { engine } = input;

  checks.push(
    engine.available
      ? {
          id: "engine",
          label: "Equalizer APO",
          severity: "ok",
          detail: engine.configPath
            ? `Writing configuration to ${engine.configPath}`
            : "Installed and ready",
        }
      : {
          id: "engine",
          label: "Equalizer APO",
          severity: "error",
          detail: `Not usable: ${engine.reason}`,
          remedy:
            "Install Equalizer APO from https://www.autoeq.app — SonusPilot writes its configuration directly.",
        }
  );

  const competing = detectCompetingDrivers(input.endpointNames);
  checks.push(
    competing.length === 0
      ? {
          id: "competing",
          label: "Competing audio effects",
          severity: "ok",
          detail: "No other audio processor detected on the output devices.",
        }
      : {
          id: "competing",
          label: "Competing audio effects",
          severity: "warn",
          detail:
            `${competing.map((c) => `${c.label} ("${c.matched}")`).join(", ")} detected. ` +
            "Only the last processor in the chain takes effect, so these may be overriding the SonusPilot correction.",
          remedy:
            "Settings → System → Sound → your device → Audio enhancements: turn the other processors off and leave Equalizer APO enabled.",
        }
  );

  const bindingMatches =
    input.boundEndpointName !== null && input.boundEndpointName === input.defaultEndpointName;
  checks.push(
    input.boundEndpointName === null
      ? {
          id: "binding",
          label: "Endpoint binding",
          severity: "unknown",
          detail:
            "Windows does not record which endpoint Equalizer APO was installed on, so this cannot be verified automatically.",
          remedy: WINDOWS_APO_ENDPOINT_HINT,
        }
      : bindingMatches
        ? {
            id: "binding",
            label: "Endpoint binding",
            severity: "ok",
            detail: `Equalizer APO is bound to "${input.boundEndpointName}", which is the active output.`,
          }
        : {
            id: "binding",
            label: "Endpoint binding",
            severity: "warn",
            detail:
              `Equalizer APO is bound to "${input.boundEndpointName}", but audio is playing through ` +
              `"${input.defaultEndpointName}". The correction is not reaching the speakers or headphones.`,
            remedy: WINDOWS_APO_ENDPOINT_HINT,
          }
  );

  checks.push(
    engine.configPresent === false
      ? {
          id: "config",
          label: "APO configuration",
          severity: "error",
          detail: "config.txt is missing, so nothing can be written to the audio engine.",
          remedy: "Reinstall Equalizer APO, or point SonusPilot at the config folder in Settings → Audio.",
        }
      : engine.configPresent === true
        ? {
            id: "config",
            label: "APO configuration",
            severity: "ok",
            detail: "config.txt is present and writable.",
          }
        : {
            id: "config",
            label: "APO configuration",
            severity: "unknown",
            detail: "Could not determine whether config.txt exists.",
          }
  );

  checks.push(
    input.hasHeadphoneProfile
      ? {
          id: "headphone",
          label: "Headphone profile",
          severity: "ok",
          detail: "A measured headphone profile is selected, so headphone correction is active.",
        }
      : {
          id: "headphone",
          label: "Headphone profile",
          severity: "warn",
          detail:
            "No measured headphone selected, so no headphone correction is applied — only taste and preset layers.",
          remedy: "Settings → Headphones → import measurements, then map your output device to a model.",
        }
  );

  return checks;
}

export function worstSeverity(checks: DiagnosticCheck[]): DiagnosticSeverity {
  if (checks.some((c) => c.severity === "error")) return "error";
  if (checks.some((c) => c.severity === "warn")) return "warn";
  if (checks.some((c) => c.severity === "unknown")) return "unknown";
  return "ok";
}

/**
 * Name of the endpoint APO is registered on.
 *
 * Returns null when nothing can be determined, which the caller must report as
 * "unknown" rather than "not bound" — the two mean very different things to
 * someone whose EQ is not working.
 */
export function boundEndpointName(binding: ApoBinding | null): string | null {
  if (!binding || binding.error !== null) return null;
  if (binding.bound_endpoints.length === 0) return null;
  return binding.bound_endpoints.map((e) => e.name || e.id).join(", ");
}

/** Endpoint names to scan for competing DSP drivers. */
export function endpointNames(binding: ApoBinding | null): string[] {
  if (!binding) return [];
  return binding.all_endpoints.map((e) => e.name).filter((n) => n.length > 0);
}
