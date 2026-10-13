use std::time::Duration;
use tokio::time::interval;
use tauri::{command, Emitter};
use windows::core::PCWSTR;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED, STGM_READ};
use windows::Win32::Devices::Properties::DEVPKEY_Device_FriendlyName;
use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE};
use windows::Win32::System::Variant::VT_LPWSTR;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OutputDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

fn enumerator() -> Result<IMMDeviceEnumerator, String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.to_string())
    }
}

fn device_name(id: &str) -> String {
    unsafe {
        let Ok(enumerator) = enumerator() else {
            return id.to_string();
        };
        let wide: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
        let Ok(device) = enumerator.GetDevice(PCWSTR(wide.as_ptr())) else {
            return id.to_string();
        };
        let Ok(store) = device.OpenPropertyStore(STGM_READ) else {
            return id.to_string();
        };
        let key = windows::Win32::Foundation::PROPERTYKEY {
            fmtid: DEVPKEY_Device_FriendlyName.fmtid,
            pid: DEVPKEY_Device_FriendlyName.pid,
        };
        let Ok(propvar) = store.GetValue(&key) else {
            return id.to_string();
        };
        
        // Extract string from PROPVARIANT
        if propvar.vt() == VT_LPWSTR {
            let ptr = propvar.Anonymous.Anonymous.Anonymous.pwszVal;
            if !ptr.is_null() {
                let mut len = 0;
                while *ptr.0.add(len) != 0 {
                    len += 1;
                }
                let slice = std::slice::from_raw_parts(ptr.0, len);
                return String::from_utf16_lossy(slice);
            }
        }
        id.to_string()
    }
}

#[command]
pub fn list_output_devices() -> Result<Vec<OutputDevice>, String> {
    let enumerator = enumerator()?;
    let default_id = unsafe {
        enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .ok()
            .and_then(|device| device.GetId().ok())
            .and_then(|id| id.to_string().ok())
    };

    let mut devices = Vec::new();
    unsafe {
        let collection = enumerator
            .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
            .map_err(|e| e.to_string())?;
        let count = collection.GetCount().map_err(|e| e.to_string())?;
        devices.reserve(count as usize);
        for index in 0..count {
            let Ok(device) = collection.Item(index) else { continue };
            let Ok(id) = device
                .GetId()
                .map_err(|e| e.to_string())
                .and_then(|id| id.to_string().map_err(|e| e.to_string()))
            else {
                continue;
            };
            let is_default = default_id.as_deref() == Some(id.as_str());
            let name = device_name(&id);
            devices.push(OutputDevice { id, name, is_default });
        }
    }
    Ok(devices)
}

#[command]
pub fn get_default_output_device() -> Result<OutputDevice, String> {
    let enumerator = enumerator()?;
    let id = unsafe {
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("no default output endpoint: {e}"))?;
        device
            .GetId()
            .map_err(|e| e.to_string())?
            .to_string()
            .map_err(|e| e.to_string())?
    };
    let name = device_name(&id);
    Ok(OutputDevice { id, name, is_default: true })
}

pub async fn watch_output_devices(app: tauri::AppHandle) {
    let mut ticker = interval(Duration::from_millis(750));
    let mut last_id: Option<String> = None;

    loop {
        ticker.tick().await;
        let current = get_default_output_device().ok();
        let current_id = current.as_ref().map(|device| device.id.clone());
        if current_id != last_id {
            if let Some(device) = current {
                let _ = app.emit("output-device-changed", &device);
            }
            last_id = current_id;
        }
    }
}
