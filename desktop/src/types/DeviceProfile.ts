export type DeviceKind = "wired" | "usb" | "bluetooth" | "builtin" | "hdmi" | "unknown";

export interface DeviceProfile {
  deviceId: string;
  name: string;
  kind: DeviceKind;
  connection?: string;
  codec?: string;
  sampleRate?: number;
  channelCount?: number;
  responseDb: number[];
  maxBoostDb: number[];
  confidence: number; // 0.0 - 1.0
}
