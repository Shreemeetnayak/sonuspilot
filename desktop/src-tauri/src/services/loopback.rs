use tokio::sync::mpsc;
use windows::Win32::Media::Audio::{
    eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_LOOPBACK, IAudioCaptureClient, IAudioClient,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED};
// use windows::core::Interface;

pub struct LoopbackCapture {
    pub sender: mpsc::Sender<Vec<f32>>,
}

impl LoopbackCapture {
    pub fn new(sender: mpsc::Sender<Vec<f32>>) -> Self {
        Self { sender }
    }

    pub async fn run(&self) -> Result<(), String> {
        let sender = self.sender.clone();

        // Launch capture entirely within the blocking thread to avoid Send issues
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            unsafe {
                CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().map_err(|e| e.to_string())?;
                let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
                let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).map_err(|e| e.to_string())?;

                let audio_client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(|e| e.to_string())?;

                let format_ptr = audio_client.GetMixFormat().map_err(|e| e.to_string())?;
                let wave_format = *format_ptr;

                audio_client.Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_LOOPBACK,
                    10000000,
                    0,
                    format_ptr,
                    None
                ).map_err(|e| e.to_string())?;

                let capture_client: IAudioCaptureClient = audio_client.GetService().map_err(|e| e.to_string())?;
                audio_client.Start().map_err(|e| e.to_string())?;

                // Get format to know how to decode PCM
                let bytes_per_sample = wave_format.wBitsPerSample as usize / 8;
                let channels = wave_format.nChannels as usize;

                loop {
                    let mut buffer: *mut u8 = std::ptr::null_mut();
                    let mut num_frames = 0;
                    let mut flags = 0;

                    if capture_client.GetBuffer(&mut buffer, &mut num_frames, &mut flags, None, None).is_ok() {
                        if num_frames > 0 {
                            let data_size = num_frames as usize * channels * bytes_per_sample;
                            let data = std::slice::from_raw_parts(buffer, data_size);

                            // Convert to f32 (Assuming 32-bit float or 16-bit PCM)
                            // WAVE_FORMAT_IEEE_FLOAT = 3, but often it's WAVE_FORMAT_EXTENSIBLE
                            let pcm_data: Vec<f32> = if wave_format.wFormatTag == 3 || (wave_format.wFormatTag == 65534 && bytes_per_sample == 4) {
                                data.chunks_exact(4).map(|chunk| f32::from_ne_bytes(chunk.try_into().unwrap())).collect()
                            } else { // Fallback to 16-bit PCM
                                data.chunks_exact(2).map(|chunk| i16::from_ne_bytes(chunk.try_into().unwrap()) as f32 / 32768.0).collect()
                            };

                            let _ = sender.blocking_send(pcm_data);
                        }
                        let _ = capture_client.ReleaseBuffer(num_frames);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
            }
        });
        Ok(())
    }
}
