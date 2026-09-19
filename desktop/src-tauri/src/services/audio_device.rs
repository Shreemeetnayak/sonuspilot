use windows::Win32::Media::Audio::{
    eConsole,
    eRender,
    IMMDeviceEnumerator,
    MMDeviceEnumerator,
};

pub fn get_default_output_device() -> Result<String, String> {
    unsafe {
        let enumerator =
            MMDeviceEnumerator::new()
                .map_err(|e| e.to_string())?;

        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| e.to_string())?;

        let id = device
            .GetId()
            .map_err(|e| e.to_string())?;

        Ok(id.to_string())
    }
}
