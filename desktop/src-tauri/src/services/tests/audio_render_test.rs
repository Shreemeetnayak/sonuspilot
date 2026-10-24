#[cfg(test)]
mod tests {
    use crate::services::audio::{AudioBlock, TestToneSource, AudioSource};
    use crate::services::audio_render::WasapiRenderClient;
    use crate::services::eq_controller::{EqController, create_eq_engine};
    use tokio::sync::mpsc;
    use std::sync::Arc;

    #[tokio::test]
    async fn test_dsp_processing_loop() {
        // Setup
        let (tx, rx) = mpsc::channel(1);
        let engine = create_eq_engine();
        let controller = Arc::new(EqController::new(engine));
        let mut client = WasapiRenderClient::new(rx, controller);

        // Mock input
        let source = TestToneSource::new(440.0, 44100, 2);
        let block = source.read_samples().expect("Failed to read samples");

        // Act
        let _ = tx.send(block).await;

        // This is a minimal check as actual WASAPI binding isn't mocked
        // Just verify client can process the channel message.
        client.stop();
    }
}
