use clap::{Args, Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(name = "collector", version, about = "Web Analytics event collector")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Debug, Subcommand)]
pub enum Commands {
    Serve(ServeArgs),
    Key {
        #[command(subcommand)]
        command: KeyCommands,
    },
}

#[derive(Debug, Subcommand)]
pub enum KeyCommands {
    Generate(KeyGenerateArgs),
}

#[derive(Debug, Args)]
pub struct KeyGenerateArgs {
    #[arg(long)]
    pub site: String,

    #[arg(long)]
    pub environment: String,
}

#[derive(Debug, Args)]
pub struct ServeArgs {
    #[arg(long, default_value = "0.0.0.0")]
    pub host: String,

    #[arg(long, default_value_t = 4001)]
    pub port: u16,
}

#[cfg(test)]
mod tests {
    use super::{Cli, Commands};
    use clap::Parser;

    #[test]
    fn serve_uses_default_host_and_port() {
        let cli = Cli::try_parse_from(["collector", "serve"]).expect("CLI should parse");

        let Commands::Serve(args) = cli.command else {
            panic!("expected serve command");
        };
        assert_eq!(args.host, "0.0.0.0");
        assert_eq!(args.port, 4001);
    }

    #[test]
    fn serve_arguments_override_defaults() {
        let cli = Cli::try_parse_from([
            "collector",
            "serve",
            "--host",
            "127.0.0.1",
            "--port",
            "4100",
        ])
        .expect("CLI should parse");

        let Commands::Serve(args) = cli.command else {
            panic!("expected serve command");
        };
        assert_eq!(args.host, "127.0.0.1");
        assert_eq!(args.port, 4100);
    }

    #[test]
    fn serve_rejects_removed_config_argument() {
        assert!(Cli::try_parse_from(["collector", "serve", "--config", "config.toml"]).is_err());
    }

    #[test]
    fn key_generate_requires_site_and_environment() {
        assert!(Cli::try_parse_from(["collector", "key", "generate"]).is_err());
        assert!(
            Cli::try_parse_from(["collector", "key", "generate", "--site", "site_example"])
                .is_err()
        );
    }
}
