/**
 * Output endpoint access.
 *
 * Everything here goes through Windows' MMDevice API via Rust. There is no
 * fallback list of "known" devices: if the API cannot answer, the UI says so
 * rather than showing a device that may not exist.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface OutputDevice {
  id: string;
  name: string;
  is_default: boolean;
}

export class AudioPathError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "AudioPathError";
  }
}

export async function listOutputDevices(): Promise<OutputDevice[]> {
  try {
    const devices = await invoke<OutputDevice[]>("list_output_devices");
    // A device without an id cannot be mapped or bound to APO, so it is not
    // something the UI should offer.
    return devices.filter((d) => d.id && d.name);
  } catch (e) {
    throw new AudioPathError(
      "Windows would not report audio output devices. Check that the Audio service is running.",
      e
    );
  }
}

export async function getDefaultOutputDevice(): Promise<OutputDevice | null> {
  try {
    const device = await invoke<OutputDevice>("get_default_output_device");
    return device?.id ? device : null;
  } catch {
    return null;
  }
}

/**
 * Fires when the Windows default output endpoint changes — i.e. the user
 * switched devices in the sound panel while SonusPilot was running.
 */
export function onDefaultOutputChanged(
  handler: (device: OutputDevice) => void
): Promise<UnlistenFn> {
  return listen<OutputDevice>("output-device-changed", (event) => {
    if (event.payload?.id) handler(event.payload);
  });
}
