use db_migrator::run;
use sqlx::postgres::PgPoolOptions;

const EXPECTED_MIGRATIONS: &[(i64, &str, &str)] = &[
    (
        20260919000100,
        "create raw events",
        "7340977e6ba99d5fa0f00479e8e5d7158388d06aa17a398f564b52821ecde3213a7ceafbc7f146a2cb8ed4b3e855efd7",
    ),
    (
        20260919000200,
        "create page view aggregates",
        "6d8bd57deb40963f327f65cd6ed259970fefea3cbc7d5f4521bd3ec10e74a589f74856bd5dcf30a29aa17751a4a01960",
    ),
    (
        20260921000300,
        "create phase6 pr1 metadata",
        "f391b67cb9586b75c5b3d294a5b7504ab36ad42111621b4807c37d1bdc9ea3865e6a6b2667cdabba77da3f5a7fc559a4",
    ),
    (
        20260921000400,
        "add phase6 watermark constraints",
        "9b70e4b4ef3b5cce0b6a275d2200291fded012ced328b135686f0a961ddcf96085d0c321f0cf1521c9599419a970a2cc",
    ),
    (
        20260922000500,
        "create phase6 pr3 derived",
        "2acf23350f34be0a1d052b78abe131c9191acd90a232cf96abc34c61733383ae9f28830724c88082aa9a2d64e4e4ca2c",
    ),
    (
        20260922000600,
        "add phase6 pr3 query indexes",
        "e74ff18616314d0039d510b42d411054a3f9d14cd9712e8ddfbf212ebad963247231289818e200bf542ac60a2f669ebd",
    ),
    (
        20260922000700,
        "create phase6 pr4 dimensions",
        "49fdaabb77834423beb44f88c7229276d39ca5fa5d39e428bcca11ffdfdd6db09d0895eba50f1970e1110076ec02d78e",
    ),
    (
        20260922000800,
        "deprecate protocol v2 flag",
        "8368271f14da20308fe96d8460b8de942529f7cf2a283c9b4f348b548156b62c3f1920fd56972c6cd0df4c6a82882e37",
    ),
    (
        20260923000900,
        "add custom event facts",
        "1a76130b66261dc1bb7957ea0241f1616179c2ef7e8d8cc5590cf358187a04e0c28bdafacbd643a0140d2e1d22b762cc",
    ),
    (
        20260923001000,
        "add web vital facts",
        "2e4ac3134a6fcdae7cc7566174ad1485553c8897257f3fe04288cedab3ed378684b46a40a678b27c34d31703cad87850",
    ),
    (
        20260923001100,
        "add conversion funnel facts",
        "84c0855c01ae188daacf6d33b1de60f8109bf15bc038ede00bd857f7a2bb6dd305224b1a2607eddafe54b2f0a5f5f205",
    ),
    (
        20260924001200,
        "add geo country facts",
        "15fdd9aa6ddfb1cf5b69ccd52b9e5c198a3bd45455be724df15ccae911f21546bfe9cec545c03ee750e8bfdce037bf12",
    ),
    (
        20260925001300,
        "create configuration storage",
        "cb04240faaa360d8b2d7f6f937d5e7aab4a0ca6e42fd4542332c169dae33a4325d82059b8efc02ec448846256eec8d19",
    ),
    (
        20260925001400,
        "allow empty ingest key policies",
        "0fdb8a6099cc738d2805b29846904edb18d95a95682edde1320eaf552d094112fd6c532c530685e593d9d095bed27cd5",
    ),
    (
        20260925001500,
        "create configuration runtime state",
        "3642b27ce139c182cd37e9a86db53189dce19ce2fdfaee2ac8811013c1aa7ea8ccb738a4ccf40c08d0af90685c2e5b4d",
    ),
    (
        20260925001600,
        "add capability runtime state",
        "23b5fbb21d8bff00865e55bd3e0e6e3012285e60491dc6cbe96012c52034871a4e8fdb709eb8b1e2a226225fc489cb33",
    ),
    (
        20260926001700,
        "create definition revisions",
        "839b94316e4f515bedf89e7031df1c36ad6f0f47ad56f0f33fb5ed38084451edc23624aa43b424a108b3562d1ef44996",
    ),
    (
        20260930001800,
        "create site registry",
        "6ef7e1d4ceb78b2e38fde53b643aff28c7762bea94efadecd8b7de9674828f1ff6dc8342392d992d6709720f88dcdf42",
    ),
    (
        20261001001900,
        "add site registry references",
        "2a57800a0804b014dd365e34a8236cc037a181019be2995a99ad8a8905fb5c8fd4812f7943330c0c8586a9acda456446",
    ),
    (
        20261001002000,
        "pin policy validator search path",
        "bed8211216ce711a57e00ed87b93935353b72743bee16d37150c54254714eb3fa9b7bb5ddc18d0d14a72a93032b513d0",
    ),
    (
        20261002002100,
        "add site management version audit",
        "a6ab9dfc115a12c005dfdb42cf6c61dd642bd6eddd45d3948396a2170d19eb92337276474cc8a82a27fb7580aadc687d",
    ),
    (
        20261003002200,
        "align site registry setup readiness",
        "b22c9ea34660d665eb29411d9fd764ae44422f1cbdaa79893c3e92e28e341460da3c1822e92bd37e23b0c7e475f015d7",
    ),
    (
        20261004002300,
        "create site creation requests",
        "698c01e489b29660a6d3ee36889e514e5df73b8befb23c6a1000def39ed0ccd4c4de1c25ee98eb31acda3a673ca7553f",
    ),
];

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn migrations_are_idempotent() {
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL is required");

    run(&database_url)
        .await
        .expect("first migration run should succeed");
    run(&database_url)
        .await
        .expect("second migration run should be idempotent");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .expect("integration database should be reachable");
    let applied: Vec<(i64, String, String)> = sqlx::query_as(
        "SELECT version, description, encode(checksum, 'hex')
         FROM _sqlx_migrations
         ORDER BY version",
    )
    .fetch_all(&pool)
    .await
    .expect("SQLx migration history should be queryable");
    let expected = EXPECTED_MIGRATIONS
        .iter()
        .map(|(version, description, checksum)| {
            (*version, (*description).to_owned(), (*checksum).to_owned())
        })
        .collect::<Vec<_>>();
    assert_eq!(applied, expected);

    let version_default: Option<String> = sqlx::query_scalar(
        "SELECT column_default FROM information_schema.columns
         WHERE table_schema='public' AND table_name='site_registry' AND column_name='version'",
    )
    .fetch_one(&pool)
    .await
    .expect("Site version column should exist");
    assert!(version_default.is_some_and(|value| value.contains('1')));

    let request_fk_restricts_delete: bool = sqlx::query_scalar(
        "SELECT EXISTS (
             SELECT 1 FROM pg_constraint
              WHERE conrelid='site_creation_requests'::regclass
                AND contype='f' AND confdeltype='r'
         )",
    )
    .fetch_one(&pool)
    .await
    .expect("Site creation request FK should be queryable");
    assert!(request_fk_restricts_delete);

    let immutable_trigger_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (
             SELECT 1 FROM pg_trigger
              WHERE tgrelid='site_creation_requests'::regclass
                AND tgname='site_creation_requests_immutable'
                AND NOT tgisinternal
         )",
    )
    .fetch_one(&pool)
    .await
    .expect("Site creation immutability trigger should be queryable");
    assert!(immutable_trigger_exists);
}
