#[tokio::main]
async fn main() {
    collector::logging::init();
    if let Err(error) = collector::cli::run().await {
        tracing::error!(error = %error, "collector stopped");
        std::process::exit(1);
    }
}
