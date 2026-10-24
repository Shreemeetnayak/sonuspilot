use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED};

/// A level reading from the default render endpoint.
pub struct Level {
    pub peak: f32,
}

/// Activate the audio meter on the default render endpoint.
fn default_endpoint_meter() -> Option<IAudioMeterInformation> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
        device.Activate::<IAudioMeterInformation>(CLSCTX_ALL, None).ok()
    }
}

/// Measure the default endpoint.
pub fn measure_default_endpoint() -> Result<Level, String> {
    let meter = default_endpoint_meter().ok_or_else(|| "Failed to activate meter".to_string())?;
    let peak = unsafe { meter.GetPeakValue().map_err(|e| e.to_string())? };
    Ok(Level { peak })
}
