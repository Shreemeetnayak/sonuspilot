use tauri::command;
use windows::Win32::Media::Audio::{
    eConsole,
    eRender,
    IMMDeviceEnumerator,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
use windows::core::Interface;

#[command]
pub fn get_default_output_device() -> Result<String, String> {
    unsafe {
        // Create MMDeviceEnumerator via COM
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(
            &windows::Win32::Media::Audio::MMDeviceEnumerator,
            None,
            CLSCTX_ALL,
        ).map_err(|e| e.to_string())?;

        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| e.to_string())?;

        let id = device
            .GetId()
            .map_err(|e| e.to_string())?;

        Ok(id.to_string())
    }
}