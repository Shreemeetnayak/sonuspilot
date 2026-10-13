import { invoke } from "@tauri-apps/api/core";
import { type NowPlayingData } from "../components/NowPlaying";
import { type OutputDevice } from "../components/DeviceSelector";

export interface RustTrackInfo {
  title: string;
  artist: string;
  album: string;
  status: string;
}

export function convertRustTrack(track: RustTrackInfo): NowPlayingData {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    status: track.status as NowPlayingData["status"],
    subgenres: [],
  };
}

export async function getCurrentTrack(): Promise<NowPlayingData | null> {
  try {
    const track = await invoke<RustTrackInfo | null>("get_current_track");
    if (track) return convertRustTrack(track);
  } catch {
    // GSMTC unavailable: caller shows the empty state.
  }
  return null;
}

export async function getDefaultOutputDevice(): Promise<OutputDevice | null> {
  try {
    return await invoke<OutputDevice>("get_default_output_device");
  } catch {
    // No default endpoint right now.
    return null;
  }
}

export async function listOutputDevices(): Promise<OutputDevice[]> {
  try {
    return await invoke<OutputDevice[]>("list_output_devices");
  } catch {
    return [];
  }
}
