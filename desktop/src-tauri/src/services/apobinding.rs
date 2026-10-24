//! Equalizer APO endpoint-binding detection.
//!
//! APO is installed into a *specific* endpoint's FX chain. Writing a correct
//! `config.txt` changes nothing if the endpoint you listen through is not the
//! one APO was bound to. Windows keeps no single "APO is bound to X" key, so
//! the reliable answer is to read each render endpoint's `FxProperties` and
//! look for APO's own CLSIDs in the merge chain.
//!
//! This answers the question a user asks when the EQ appears to do nothing,
//! from the registry rather than from a hardcoded guess.

use serde::Serialize;
use windows::core::{HSTRING, PCWSTR, PWSTR};
use windows::Win32::System::Registry::{
    RegCloseKey, RegEnumKeyExW, RegEnumValueW, RegGetValueW, RegOpenKeyExW, HKEY, RRF_RT_REG_DWORD,
    HKEY_LOCAL_MACHINE, KEY_READ, RRF_RT_REG_SZ,
};

/// DSP class ids that matter to this app, mapped to a human label.
///
/// Only ids read from the live registry are listed. Windows does not register
/// FxSound as an FX-chain APO, so it is detected separately by device presence
/// — inventing a CLSID here would make the diagnostic lie.
const KNOWN_DSPS: &[(&str, &str)] = &[
    // Equalizer APO: SFX and MFX as written by the APO installer.
    ("{EACD2258-FCAC-4FF4-B36D-419E924A6D79}", "Equalizer APO (SFX)"),
    ("{EC1CC9CE-FAED-4822-828A-82A81A6F018F}", "Equalizer APO (MFX)"),
    // Windows built-ins that also sit in the chain.
    ("{C18E2F7E-933D-4965-B7D1-1EEF228D2AF3}", "Windows Audio Effects"),
    ("{4780004E-7133-41D8-8C74-660DADD2C0EE}", "Windows Enhancements"),
    ("{B26FEB0D-EC94-477C-9494-D1AB8E753F6E}", "Windows Room Effects"),
    ("{5860E1C5-F95C-4a7a-8EC8-8AEF24F379A1}", "Microsoft Home Theater"),
];

/// Non-APO third-party processors that can win the endpoint chain.
///
/// FxSound installs its own driver endpoint and can be selected as the system
/// output, in which case Windows routes the stream there and never reaches
/// APO. It is detected by endpoint name rather than CLSID because it does not
/// register as an FX-chain effect.
const COMPETING_ENDPOINT_PATTERNS: &[(&str, &str)] = &[
    ("fxsound", "FxSound"),
    ("voicemeeter", "Voicemeeter"),
    ("thx", "THX"),
    ("dspatial", "dSpatial"),
    ("spectral", "Spectral"),
    ("sonos", "Sonos"),
];

const RENDER_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render";

/// Property keys holding an endpoint's FX merge chain, without braces —
/// registry value names append the pid directly: `{d04e05a6-…},5`.
///
/// The chain is split across several property sets. Checking only one misses
/// endpoints that register their effects under another, which is how a
/// working install gets reported as missing.
const FX_CHAIN_KEYS: [&str; 3] = [
    "d04e05a6-594b-4fb6-a80d-01af5eed7d1d",
    "d3993a3f-99c2-4402-b5ec-a92a0367664b",
    "0f8412d3-dc5c-4db3-b174-dc47a859435c",
];

/// PKEY_Device_FriendlyName on the endpoint. The `,2` suffix is the property
/// set index, not the pid — reading `,14` here returns nothing.
const FRIENDLY_NAME: &str = r"{a45c254e-df1c-4efd-8020-67d146a850e0},2";

/// Windows DEVICE_STATE bits. A Bluetooth headset that is not currently
/// connected still has an entry here, and APO bound to it looks healthy while
/// audio plays through something else entirely.
const DEVICE_STATE_ACTIVE: u32 = 0x1;
const DEVICE_STATE_PRESENT: u32 = 0x4;

#[derive(Debug, Clone, Serialize)]
pub struct EndpointBinding {
    /// MMDevices endpoint id, e.g. `{04b3884f-...}`.
    pub id: String,
    /// Friendly name from PKEY_Device_FriendlyName; empty when unreadable.
    pub name: String,
    /// True when Equalizer APO appears in this endpoint's FX merge chain.
    pub has_apo: bool,
    /// DEVICE_STATE bitfield, verbatim.
    pub device_state: u32,
    /// Device is currently the active render endpoint.
    pub is_active: bool,
    /// Device is physically present. A disconnected Bluetooth headset is not,
    /// and an APO bound to it is not doing anything.
    pub is_present: bool,
    /// Every recognised DSP found in this endpoint's chain, by label.
    pub dsps: Vec<String>,
    /// Third-party processors on this endpoint that can override APO.
    pub competing_dsps: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApoBindingStatus {
    /// True when APO is registered on at least one endpoint.
    pub apo_installed: bool,
    /// Endpoints APO is registered on.
    pub bound_endpoints: Vec<EndpointBinding>,
    /// Every render endpoint we could read, so the UI can show the gap.
    pub all_endpoints: Vec<EndpointBinding>,
    /// The active endpoint, resolved from the default render device.
    pub active_endpoint_id: Option<String>,
    /// True when the active endpoint has APO. This single gate decides whether
    /// the correction can reach the speakers at all.
    pub active_endpoint_has_apo: bool,
    /// Non-APO DSPs that can override SonusPilot — on the active endpoint, or
    /// installed as an endpoint in their own right that Windows may select.
    pub competing_dsps: Vec<String>,
    /// Set when the registry could not be read at all.
    pub error: Option<String>,
}

impl Default for ApoBindingStatus {
    fn default() -> Self {
        Self {
            apo_installed: false,
            bound_endpoints: Vec::new(),
            all_endpoints: Vec::new(),
            active_endpoint_id: None,
            active_endpoint_has_apo: false,
            competing_dsps: Vec::new(),
            error: None,
        }
    }
}

fn open_subkey(parent: HKEY, path: &str) -> Option<HKEY> {
    let mut key = HKEY::default();
    let wide = HSTRING::from(path);
    // SAFETY: `wide` outlives the call; the returned handle is closed by
    // `close_key` and never used after.
    let status =
        unsafe { RegOpenKeyExW(parent, PCWSTR(wide.as_ptr()), None, KEY_READ, &mut key) };
    if status.is_err() {
        return None;
    }
    Some(key)
}

fn close_key(key: HKEY) {
    // SAFETY: key came from RegOpenKeyExW and is not used after this.
    unsafe {
        let _ = RegCloseKey(key);
    }
}

/// Read a REG_SZ value; None for a missing value or a non-string type.
fn read_string(key: HKEY, name: &str) -> Option<String> {
    let mut size: u32 = 0;
    let name_wide = HSTRING::from(name);
    // First call sizes the buffer. A missing value is expected here, not an
    // error worth propagating.
    let _ = unsafe {
        RegGetValueW(
            key,
            None,
            PCWSTR(name_wide.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            None,
            Some(&mut size),
        )
    };
    if size == 0 {
        return None;
    }

    let mut buf = vec![0u16; (size as usize / 2) + 1];
    // pcbdata is in/out: it must carry the buffer capacity going in, or
    // Windows reports ERROR_MORE_DATA and copies nothing.
    let mut capacity = (buf.len() * 2) as u32;
    // SAFETY: buf holds `capacity` bytes; capacity reports what was written.
    let status = unsafe {
        RegGetValueW(
            key,
            None,
            PCWSTR(name_wide.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr().cast()),
            Some(&mut capacity),
        )
    };
    if status.is_err() {
        return None;
    }

    let end = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
    if end == 0 {
        return None;
    }
    String::from_utf16(&buf[..end]).ok()
}

/// Read a REG_DWORD value; None for a missing value or a different type.
fn read_u32(key: HKEY, name: &str) -> Option<u32> {
    let mut value: u32 = 0;
    let mut size = std::mem::size_of::<u32>() as u32;
    let name_wide = HSTRING::from(name);
    // SAFETY: `value` is exactly `size` bytes and `size` is passed by pointer.
    let status = unsafe {
        RegGetValueW(
            key,
            None,
            PCWSTR(name_wide.as_ptr()),
            RRF_RT_REG_DWORD,
            None,
            Some((&mut value as *mut u32).cast()),
            Some(&mut size),
        )
    };
    if status.is_err() {
        return None;
    }
    Some(value)
}

/// Immediate subkey names of `key`.
fn subkeys(key: HKEY) -> Vec<String> {
    let mut out = Vec::new();
    let mut index: u32 = 0;

    loop {
        let mut name_buf = [0u16; 512];
        let mut name_len: u32 = name_buf.len() as u32;
        // SAFETY: buffers are sized; the API fails rather than overflowing.
        let result = unsafe {
            RegEnumKeyExW(
                key,
                index,
                Some(PWSTR(name_buf.as_mut_ptr())),
                &mut name_len,
                None,
                None,
                None,
                None,
            )
        };

        if result.is_err() {
            break;
        }
        let end = name_buf[..name_len as usize]
            .iter()
            .position(|c| *c == 0)
            .unwrap_or(name_len as usize);
        out.push(String::from_utf16_lossy(&name_buf[..end]));
        index += 1;
    }

    out
}

/// Value names of `key`. The FX merge chain lives in values, not subkeys.
fn value_names(key: HKEY) -> Vec<String> {
    let mut out = Vec::new();
    let mut index: u32 = 0;

    loop {
        let mut name_buf = [0u16; 512];
        let mut name_len: u32 = name_buf.len() as u32;
        // SAFETY: buffers are sized; the API fails rather than overflowing.
        let result = unsafe {
            RegEnumValueW(
                key,
                index,
                Some(PWSTR(name_buf.as_mut_ptr())),
                &mut name_len,
                None,
                None,
                None,
                None,
            )
        };

        if result.is_err() {
            break;
        }
        let end = name_buf[..name_len as usize]
            .iter()
            .position(|c| *c == 0)
            .unwrap_or(name_len as usize);
        out.push(String::from_utf16_lossy(&name_buf[..end]));
        index += 1;
    }

    out
}

/// Every recognised DSP registered in an endpoint's FX merge chain, by label.
///
/// Only REG_SZ chain entries are read: REG_MULTI_SZ values hold hardware-effect
/// GUIDs that name no installable processor, and the all-zero GUID Windows
/// writes for "no effect" must never be read as a match.
fn endpoint_dsps(endpoint_key: HKEY) -> Vec<String> {
    let Some(fx) = open_subkey(endpoint_key, "FxProperties") else {
        return Vec::new();
    };

    let mut found: Vec<String> = Vec::new();
    for value_name in value_names(fx) {
        let Some((base, _index)) = value_name.split_once(',') else {
            continue;
        };
        let is_chain_key = FX_CHAIN_KEYS
            .iter()
            .any(|known| base.trim_matches(|c| c == '{' || c == '}').eq_ignore_ascii_case(known));
        if !is_chain_key {
            continue;
        }
        let Some(value) = read_string(fx, &value_name) else {
            continue;
        };
        // A chain slot may hold several GUIDs; match any of them.
        for (clsid, label) in KNOWN_DSPS {
            if value.to_uppercase().contains(clsid) && !found.iter().any(|f| f == label) {
                found.push((*label).to_string());
            }
        }
    }

    close_key(fx);
    found
}

/// DEVICE_STATE bitfield for an endpoint.
fn endpoint_device_state(endpoint_key: HKEY) -> u32 {
    read_u32(endpoint_key, "DeviceState").unwrap_or(0)
}

fn endpoint_name(endpoint_key: HKEY) -> String {
    let Some(props) = open_subkey(endpoint_key, "Properties") else {
        return String::new();
    };
    let name = read_string(props, FRIENDLY_NAME).unwrap_or_default();
    close_key(props);
    name
}

/// The endpoint GUID a WASAPI endpoint id refers to.
///
/// WASAPI ids look like `{0.0.0.00000000}.{15585b64-…}` while the render
/// registry keys on the bare `{15585b64-…}`, so the two must be reduced to the
/// same token before they can be compared.
pub fn endpoint_key(id: &str) -> &str {
    let trimmed = id.trim();
    match trimmed.rfind('{') {
        Some(open) => &trimmed[open..],
        None => trimmed,
    }
}

/// Same endpoint, regardless of which id format the caller holds.
pub fn same_endpoint(a: &str, b: &str) -> bool {
    endpoint_key(a).eq_ignore_ascii_case(endpoint_key(b))
}

/// A short, unambiguous way to refer to an endpoint in a message.
///
/// Several endpoints on a laptop legitimately share one friendly name — three
/// Realtek outputs here are all called "Headphones" — so a name alone can make
/// a sentence read as if a device were being described as not being itself.
pub fn short_label(id: &str) -> String {
    endpoint_key(id).trim_matches(|c| c == '{' || c == '}')
        .split('-')
        .next()
        .unwrap_or("?")
        .to_string()
}

/// The endpoint Windows is currently routing audio to.
///
/// Resolved from the actual default device rather than from `is_active`, which
/// is unset on every endpoint until the audio session starts — using it would
/// report "unknown" for a perfectly healthy system.
pub fn active_endpoint_id() -> Option<String> {
    match super::audio_device::get_default_output_device() {
        Ok(device) => Some(device.id),
        Err(_) => None,
    }
}

/// Read the render-endpoint tree and report where APO is registered.
pub fn probe() -> ApoBindingStatus {
    let mut status = ApoBindingStatus::default();

    let Some(render) = open_subkey(HKEY_LOCAL_MACHINE, RENDER_KEY) else {
        status.error = Some(format!("could not open HKLM\\{RENDER_KEY}"));
        return status;
    };

    for endpoint_id in subkeys(render) {
        let Some(endpoint) = open_subkey(render, &endpoint_id) else {
            continue;
        };

        let name = endpoint_name(endpoint);
        let dsps = endpoint_dsps(endpoint);
        let device_state = endpoint_device_state(endpoint);

        // An endpoint whose name matches a known third-party processor can take
        // the whole stream, so it is a competitor even though it registers no
        // APO. FxSound is detected this way.
        let name_lower = name.to_lowercase();
        let by_name: Vec<String> = COMPETING_ENDPOINT_PATTERNS
            .iter()
            .filter(|(pattern, _)| name_lower.contains(pattern))
            .map(|(_, label)| (*label).to_string())
            .collect();

        let has_apo = dsps.iter().any(|d| d.starts_with("Equalizer APO"));
        let competing: Vec<String> = {
            let mut all = by_name;
            for d in &dsps {
                if COMPETING_ENDPOINT_PATTERNS
                    .iter()
                    .any(|(pattern, label)| d.to_lowercase().contains(pattern) && !all.contains(&label.to_string()))
                {
                    all.push(d.clone());
                }
            }
            all
        };

        let binding = EndpointBinding {
            id: endpoint_id.clone(),
            name,
            has_apo,
            device_state,
            is_active: device_state & DEVICE_STATE_ACTIVE != 0,
            is_present: device_state & DEVICE_STATE_PRESENT != 0,
            dsps,
            competing_dsps: competing,
        };

        if binding.has_apo {
            status.apo_installed = true;
            status.bound_endpoints.push(binding.clone());
        }
        for c in &binding.competing_dsps {
            if !status.competing_dsps.contains(c) {
                status.competing_dsps.push(c.clone());
            }
        }
        status.all_endpoints.push(binding);

        close_key(endpoint);
    }

    close_key(render);

    status.active_endpoint_id = active_endpoint_id();
    status.active_endpoint_has_apo = status.active_endpoint_id.as_ref().is_some_and(|active| {
        status
            .all_endpoints
            .iter()
            .find(|e| same_endpoint(&e.id, active))
            .is_some_and(|e| e.has_apo)
    });

    status
}

/// Guidance shown when APO is registered somewhere other than the active output.
pub fn configurator_hint() -> &'static str {
    "Run DeviceSelector.exe from C:\\Program Files\\EqualizerAPO\\Configurator and \
     enable Equalizer APO on the endpoint you actually listen through."
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_reads_registry_without_panicking() {
        let status = probe();
        // With no audio stack the read may legitimately fail; what must never
        // happen is a panic or a fabricated answer.
        if let Some(err) = &status.error {
            eprintln!("probe unavailable: {err}");
            return;
        }
        eprintln!("APO installed: {}", status.apo_installed);
        for ep in &status.all_endpoints {
            eprintln!("  {} | {} | apo={}", ep.id, ep.name, ep.has_apo);
        }
    }

    #[test]
    fn installed_implies_at_least_one_bound_endpoint() {
        let status = probe();
        if status.error.is_some() {
            return;
        }
        assert_eq!(
            status.apo_installed,
            !status.bound_endpoints.is_empty(),
            "apo_installed must agree with the bound endpoint list"
        );
    }

    #[test]
    fn every_bound_endpoint_appears_in_the_full_list() {
        let status = probe();
        if status.error.is_some() {
            return;
        }
        for bound in &status.bound_endpoints {
            assert!(
                status.all_endpoints.iter().any(|e| e.id == bound.id),
                "bound endpoint {} missing from all_endpoints",
                bound.id
            );
        }
    }
}


#[cfg(test)]
mod endpoint_id_tests {
    use super::same_endpoint;

    #[test]
    fn wasapi_id_matches_registry_key() {
        // The two formats this machine hands out for one device. Compared
        // verbatim they never match, which is what made the audio path report
        // "no output device" on a system that clearly had one.
        assert!(same_endpoint(
            "{0.0.0.00000000}.{15585b64-e4d5-4509-850e-9b70339e31d6}",
            "{15585b64-e4d5-4509-850e-9b70339e31d6}"
        ));
        assert!(same_endpoint(
            "{15585b64-e4d5-4509-850e-9b70339e31d6}",
            "{0.0.0.00000000}.{15585b64-e4d5-4509-850e-9b70339e31d6}"
        ));
    }

    #[test]
    fn different_devices_stay_different() {
        assert!(!same_endpoint(
            "{0.0.0.00000000}.{15585b64-e4d5-4509-850e-9b70339e31d6}",
            "{04b3884f-fbb8-46b9-b5d4-d29e882551a0}"
        ));
    }

    #[test]
    fn comparison_ignores_case() {
        assert!(same_endpoint(
            "{0.0.0.00000000}.{15585B64-E4D5-4509-850E-9B70339E31D6}",
            "{15585b64-e4d5-4509-850e-9b70339e31d6}"
        ));
    }
}
