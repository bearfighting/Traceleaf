use std::time::Duration;

use processor::Processor;
use tracing::{error, info};

pub(super) async fn run(processor: Processor, poll_interval_ms: u64) -> anyhow::Result<()> {
    let interval = Duration::from_millis(poll_interval_ms);
    loop {
        match processor.process_one().await {
            Ok(true) => {}
            Ok(false) => {
                if processor.process_rebuild_queue_once().await? {
                    continue;
                }
                tokio::select! {
                    _ = tokio::time::sleep(interval) => {}
                    _ = tokio::signal::ctrl_c() => {
                        info!("processor stopped");
                        return Ok(());
                    }
                }
            }
            Err(error) => {
                error!(%error, "processor transaction failed; will retry");
                tokio::select! {
                    _ = tokio::time::sleep(interval) => {}
                    _ = tokio::signal::ctrl_c() => {
                        info!("processor stopped");
                        return Ok(());
                    }
                }
            }
        }
    }
}
