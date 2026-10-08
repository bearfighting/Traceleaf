use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use syn::{
    File, UseTree,
    visit::{self, Visit},
};

type ModulePath = Vec<String>;
type AliasTable = HashMap<String, Vec<(Vec<String>, ModulePath)>>;

#[derive(Clone, Debug)]
struct Import {
    path: Vec<String>,
    alias: Option<String>,
    module: ModulePath,
    glob: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Owner {
    Analytics,
    Transport,
    SiteManagement,
    Application,
    Storage,
    Unowned,
}

fn owner_for(relative: &Path) -> Owner {
    let components = relative
        .components()
        .filter_map(|part| part.as_os_str().to_str())
        .collect::<Vec<_>>();
    match components.first().copied() {
        Some("analytics") => Owner::Analytics,
        Some("site_management") => Owner::SiteManagement,
        Some("application") => Owner::Application,
        Some("storage") => Owner::Storage,
        Some("transport") => Owner::Transport,
        _ if matches!(
            relative.to_str(),
            Some("lib.rs" | "routes.rs" | "state.rs" | "main.rs")
        ) =>
        {
            Owner::Application
        }
        _ => Owner::Unowned,
    }
}

fn module_path(relative: &Path) -> ModulePath {
    let mut components = relative
        .components()
        .filter_map(|part| part.as_os_str().to_str())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let Some(file) = components.pop() else {
        return Vec::new();
    };
    if file != "mod.rs" {
        components.push(file.trim_end_matches(".rs").to_owned());
    }
    components
}

fn push_imports(tree: &UseTree, prefix: &[String], module: &[String], output: &mut Vec<Import>) {
    match tree {
        UseTree::Path(path) => {
            let mut nested = prefix.to_vec();
            nested.push(path.ident.to_string());
            push_imports(&path.tree, &nested, module, output);
        }
        UseTree::Name(name) => {
            let mut path = prefix.to_vec();
            path.push(name.ident.to_string());
            output.push(Import {
                path,
                alias: None,
                module: module.to_vec(),
                glob: false,
            });
        }
        UseTree::Rename(rename) => {
            let mut path = prefix.to_vec();
            path.push(rename.ident.to_string());
            output.push(Import {
                path,
                alias: Some(rename.rename.to_string()),
                module: module.to_vec(),
                glob: false,
            });
        }
        UseTree::Glob(_) => output.push(Import {
            path: prefix.to_vec(),
            alias: None,
            module: module.to_vec(),
            glob: true,
        }),
        UseTree::Group(group) => {
            for item in &group.items {
                push_imports(item, prefix, module, output);
            }
        }
    }
}

#[derive(Default)]
struct ImportCollector {
    module: ModulePath,
    imports: Vec<Import>,
}

impl<'ast> Visit<'ast> for ImportCollector {
    fn visit_item_mod(&mut self, item: &'ast syn::ItemMod) {
        if item.attrs.iter().any(|attr| matches!(&attr.meta, syn::Meta::List(list) if list.tokens.to_string().contains("test"))) {
            return;
        }
        if let Some((_, items)) = &item.content {
            self.module.push(item.ident.to_string());
            for item in items {
                self.visit_item(item);
            }
            self.module.pop();
        }
    }

    fn visit_item_use(&mut self, item: &'ast syn::ItemUse) {
        push_imports(&item.tree, &[], &self.module, &mut self.imports);
    }

    fn visit_item_extern_crate(&mut self, item: &'ast syn::ItemExternCrate) {
        if item.ident == "self"
            && let Some((_, rename)) = &item.rename
        {
            self.imports.push(Import {
                path: vec!["crate".to_owned()],
                alias: Some(rename.to_string()),
                module: self.module.clone(),
                glob: false,
            });
        }
    }
}

fn aliases_for(imports: &[Import]) -> AliasTable {
    let mut aliases = AliasTable::new();
    for import in imports {
        if import.path.is_empty() || import.glob {
            continue;
        }
        let alias = import
            .alias
            .clone()
            .unwrap_or_else(|| import.path.last().cloned().unwrap_or_default());
        if alias == "self" || alias == "super" || alias == "crate" || alias == "*" {
            continue;
        }
        aliases
            .entry(alias)
            .or_default()
            .push((import.path.clone(), import.module.clone()));
    }
    aliases
}

fn resolve_paths(
    path: &[String],
    module: &[String],
    aliases: &AliasTable,
    active_aliases: &mut Vec<String>,
) -> Vec<ModulePath> {
    let mut cursor = 0;
    let mut resolved = module.to_vec();
    while let Some(segment) = path.get(cursor).map(String::as_str) {
        match segment {
            "crate" => {
                resolved.clear();
                cursor += 1;
            }
            "self" => cursor += 1,
            "super" => {
                if resolved.pop().is_none() {
                    return Vec::new();
                }
                cursor += 1;
            }
            _ => break,
        }
    }

    let Some(first) = path.get(cursor) else {
        return vec![resolved];
    };
    if let Some(candidates) = aliases.get(first) {
        if active_aliases.contains(first) {
            return Vec::new();
        }
        active_aliases.push(first.clone());
        let mut results = Vec::new();
        for (target, target_module) in candidates {
            for mut value in resolve_paths(target, target_module, aliases, active_aliases) {
                value.extend_from_slice(&path[cursor + 1..]);
                results.push(value);
            }
        }
        active_aliases.pop();
        return results;
    }

    resolved.extend_from_slice(&path[cursor..]);
    vec![resolved]
}

fn is_forbidden_path(owner: Owner, relative: &Path, path: &[String]) -> bool {
    let domain = path.first().map(String::as_str);
    match owner {
        Owner::Analytics => {
            matches!(domain, Some("site_management" | "storage"))
                || path.iter().any(|segment| segment == "sqlx")
        }
        Owner::SiteManagement => {
            matches!(domain, Some("analytics" | "storage"))
                || path
                    .iter()
                    .any(|segment| matches!(segment.as_str(), "config_store" | "site_store"))
                || path
                    .iter()
                    .any(|segment| matches!(segment.as_str(), "sqlx" | "axum"))
        }
        Owner::Unowned => matches!(domain, Some("analytics" | "site_management")),
        Owner::Application => {
            (path.iter().any(|segment| segment == "sqlx") && relative.to_str() != Some("lib.rs"))
                || (domain == Some("storage") && relative.to_str() != Some("lib.rs"))
                || (matches!(domain, Some("analytics" | "site_management"))
                    && !application_path_is_allowed(relative, path))
        }
        Owner::Storage => {
            (domain == Some("application") && !storage_application_path_is_allowed(relative, path))
                || (domain == Some("site_management")
                    && !matches!(path.get(1).map(String::as_str), Some("site" | "sites")))
                || (domain == Some("analytics")
                    && !matches!(
                        path.get(1).map(String::as_str),
                        Some("models" | "definition_catalog" | "freshness") | Some("errors")
                    ))
        }
        Owner::Transport => {
            path.iter().any(|segment| segment == "sqlx") || domain == Some("storage")
        }
    }
}

fn storage_application_path_is_allowed(relative: &Path, path: &[String]) -> bool {
    let allowed: &[&[&str]] = match relative.to_str() {
        Some("storage/postgres/analytics_read_adapter.rs") => &[
            &["application", "analytics_queries"],
            &["application", "errors", "AnalyticsApplicationError"],
        ],
        Some("storage/postgres/report_transactions.rs") => {
            &[&["application", "errors"], &["analytics", "models"]]
        }
        Some("storage/postgres/mod.rs") => &[&["application", "state", "HealthCheck"]],
        Some("storage/postgres/site_management_adapter.rs") => &[
            &["application", "site_management"],
            &["application", "site"],
        ],
        Some("storage/postgres/site_creation.rs") => &[&["application", "site"]],
        _ => &[],
    };
    allowed.iter().any(|prefix| {
        path.len() >= prefix.len()
            && path
                .iter()
                .zip(prefix.iter())
                .all(|(segment, expected)| segment == expected)
    })
}

fn application_path_is_allowed(relative: &Path, path: &[String]) -> bool {
    let allowed: &[&[&str]] = match relative.to_str() {
        Some("application/analytics_queries.rs") => &[
            &["analytics", "definition_catalog"],
            &["analytics", "models"],
            &["application", "errors", "AnalyticsApplicationError"],
        ],
        Some("routes.rs" | "application/routes.rs") => &[
            &["analytics", "routes"],
            &["site_management", "routes"],
            &["state"],
        ],
        Some("state.rs" | "application/state.rs") => &[
            &["analytics", "state"],
            &["site_management", "auth"],
            &["application", "site_management_state"],
        ],
        Some("application/site_management_state.rs") => &[
            &["application", "site_management"],
            &["site_management", "auth"],
            &["application", "site_management_validation"],
        ],
        Some("lib.rs") => &[
            &["analytics", "validation"],
            &["analytics", "errors"],
            &["site_management", "auth"],
            &["state"],
            &["application", "state"],
        ],
        Some("main.rs") => &[],
        Some("storage/postgres/analytics_queries.rs") => &[&["analytics", "models"]],
        Some("application/site_management.rs") => &[
            &["application", "site"],
            &["application", "site_management_validation"],
        ],
        _ => &[],
    };
    allowed.iter().any(|prefix| {
        path.len() >= prefix.len()
            && path
                .iter()
                .zip(prefix.iter())
                .all(|(segment, expected)| segment == expected)
    })
}

fn check_imports(relative: &Path, file: &File, source_path: &str) -> Vec<String> {
    let owner = owner_for(relative);

    let mut collector = ImportCollector {
        module: module_path(relative),
        ..ImportCollector::default()
    };
    collector.visit_file(file);
    let aliases = aliases_for(&collector.imports);
    let mut errors = Vec::new();

    for import in &collector.imports {
        let resolved = resolve_paths(&import.path, &import.module, &aliases, &mut Vec::new());
        if resolved
            .iter()
            .any(|path| is_forbidden_path(owner, relative, path))
        {
            errors.push(format!(
                "{source_path}: {owner:?} imports a forbidden module through `use`"
            ));
        }
    }

    let mut paths = PathChecker {
        owner,
        module: module_path(relative),
        aliases: &aliases,
        errors: &mut errors,
        source_path,
        relative,
    };
    paths.visit_file(file);
    errors
}

struct PathChecker<'a> {
    owner: Owner,
    module: ModulePath,
    aliases: &'a AliasTable,
    errors: &'a mut Vec<String>,
    source_path: &'a str,
    relative: &'a Path,
}

impl<'ast> Visit<'ast> for PathChecker<'_> {
    fn visit_item_mod(&mut self, item: &'ast syn::ItemMod) {
        if item.attrs.iter().any(|attr| matches!(&attr.meta, syn::Meta::List(list) if list.tokens.to_string().contains("test"))) {
            return;
        }
        if let Some((_, items)) = &item.content {
            self.module.push(item.ident.to_string());
            for item in items {
                self.visit_item(item);
            }
            self.module.pop();
        }
    }

    fn visit_path(&mut self, path: &'ast syn::Path) {
        let segments = path
            .segments
            .iter()
            .map(|segment| segment.ident.to_string())
            .collect::<Vec<_>>();
        if resolve_paths(&segments, &self.module, self.aliases, &mut Vec::new())
            .iter()
            .any(|resolved| is_forbidden_path(self.owner, self.relative, resolved))
        {
            self.errors.push(format!(
                "{}: {:?} references a forbidden domain path",
                self.source_path, self.owner
            ));
        }
        visit::visit_path(self, path);
    }

    fn visit_expr_field(&mut self, field: &'ast syn::ExprField) {
        if self.owner == Owner::Transport
            && matches!(&field.member, syn::Member::Named(member) if member == "pool")
        {
            self.errors.push(format!(
                "{}: transport accesses the application database pool",
                self.source_path
            ));
        }
        visit::visit_expr_field(self, field);
    }
}

fn check_source(relative: &Path, source: &str) -> Vec<String> {
    let source_path = relative.to_string_lossy();
    let file = match syn::parse_file(source) {
        Ok(file) => file,
        Err(error) => return vec![format!("{source_path}: failed to parse Rust: {error}")],
    };
    let mut errors = check_imports(relative, &file, &source_path);
    if owner_for(relative) == Owner::Analytics
        && source.contains("pub use")
        && source.contains("storage")
    {
        errors.push(format!(
            "{source_path}: analytics re-exports storage implementation"
        ));
    }
    errors
}

fn rust_files(directory: &Path, root: &Path, output: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(directory).expect("source directory should be readable") {
        let entry = entry.expect("source directory entry should be readable");
        let path = entry.path();
        if path.is_dir() {
            rust_files(&path, root, output);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            output.push(
                path.strip_prefix(root)
                    .expect("file is under src")
                    .to_path_buf(),
            );
        }
    }
}

#[test]
fn analytics_api_modules_do_not_import_each_other() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = Vec::new();
    rust_files(&root, &root, &mut files);
    let errors = files
        .into_iter()
        .flat_map(|relative| {
            let source =
                fs::read_to_string(root.join(&relative)).expect("Rust source should be readable");
            check_source(&relative, &source)
        })
        .collect::<Vec<_>>();
    assert!(errors.is_empty(), "{}", errors.join("\n"));
}

#[test]
fn boundary_checker_covers_absolute_grouped_relative_and_aliased_imports() {
    let cases = [
        (
            "analytics/a.rs",
            "use crate::site_management::config_store;",
            true,
        ),
        (
            "site_management/a.rs",
            "use crate::{analytics::{queries, models}};",
            true,
        ),
        (
            "site_management/a.rs",
            "use crate::storage::postgres::site_creation as persistence;",
            true,
        ),
        (
            "site_management/a.rs",
            "use crate::storage as persistence; fn f() { persistence::postgres::load(); }",
            true,
        ),
        (
            "site_management/a.rs",
            "use crate::{storage::postgres};",
            true,
        ),
        ("site_management/a.rs", "use crate::storage::*;", true),
        (
            "site_management/sub/a.rs",
            "use super::super::super::storage::postgres::site_creation;",
            true,
        ),
        (
            "site_management/a.rs",
            "fn f() { let _: crate::storage::postgres::Site; }",
            true,
        ),
        ("site_management/a.rs", "use sqlx::PgPool;", true),
        ("site_management/a.rs", "use axum::Router;", true),
        (
            "analytics/handlers/a.rs",
            "use super::super::super::site_management::config_store;",
            true,
        ),
        (
            "site_management/configuration.rs",
            "use super::super::analytics::queries;",
            true,
        ),
        (
            "analytics/a.rs",
            "use super::{super::site_management::config_store};",
            true,
        ),
        (
            "site_management/a.rs",
            "use crate as root; use root::analytics::queries;",
            true,
        ),
        (
            "site_management/a.rs",
            "extern crate self as app; use app::analytics::queries;",
            true,
        ),
        (
            "analytics/a.rs",
            "use crate::site_management as management; fn f() { let _: management::Thing; }",
            true,
        ),
        (
            "analytics/a.rs",
            "fn f() { let _: crate::site_management::Thing; }",
            true,
        ),
        (
            "site_management/a.rs",
            "use crate::analytics as analytics_api; fn f() { analytics_api::queries::run(); }",
            true,
        ),
        ("infra.rs", "use crate::analytics::queries;", true),
        ("analytics/a.rs", "use crate::analytics::queries;", false),
        ("analytics/state.rs", "use sqlx::PgPool;", true),
        (
            "analytics/a.rs",
            "use crate::storage::postgres::analytics_queries;",
            true,
        ),
        (
            "site_management/a.rs",
            "use crate::site_management::config_store;",
            true,
        ),
        (
            "routes.rs",
            "use crate::{analytics::routes, site_management::routes};",
            false,
        ),
        ("routes.rs", "use crate::analytics::queries;", true),
        (
            "routes.rs",
            "use crate::analytics as domain; use domain::queries;",
            true,
        ),
        ("state.rs", "use crate::analytics::queries;", true),
        (
            "application/analytics_queries.rs",
            "use crate::storage::postgres::analytics_queries;",
            true,
        ),
        ("lib.rs", "use crate::storage::postgres;", false),
        (
            "lib.rs",
            "pub use crate::site_management as management;",
            true,
        ),
        ("main.rs", "use crate::analytics::queries;", true),
        ("application/state.rs", "use sqlx::PgPool;", true),
        (
            "storage/postgres/site_creation.rs",
            "use crate::site_management::site::Site;",
            false,
        ),
        (
            "storage/postgres/site_creation.rs",
            "use crate::site_management::configuration;",
            true,
        ),
        (
            "storage/postgres/other_adapter.rs",
            "use crate::application::analytics_queries::AnalyticsReadUseCases;",
            true,
        ),
        (
            "storage/postgres/analytics_read_adapter.rs",
            "use crate::application::analytics_queries::{AnalyticsReadUseCases, AnalyticsReportRequest};",
            false,
        ),
        (
            "storage/postgres/site_management_adapter.rs",
            "use crate::application::site_management::SiteManagementUseCases;",
            false,
        ),
        (
            "storage/postgres/mod.rs",
            "impl crate::application::state::HealthCheck for PostgresHealthCheck {}",
            false,
        ),
        ("transport/http/a.rs", "use sqlx::PgPool;", true),
        (
            "transport/http/a.rs",
            "fn f(state: &State) { state.pool.execute(); }",
            true,
        ),
        (
            "transport/http/a.rs",
            "fn f(state: &State) { state . pool . execute(); }",
            true,
        ),
        (
            "transport/http/site_management/a.rs",
            "fn f(state: &State) { state.pool.acquire(); }",
            true,
        ),
        (
            "transport/http/a.rs",
            "use crate::storage::postgres::analytics_queries;",
            true,
        ),
        (
            "transport/http/a.rs",
            "use crate::storage as database; fn f() { database::postgres::run(); }",
            true,
        ),
        (
            "transport/http/a.rs",
            "fn f() { crate::storage::postgres::run(); }",
            true,
        ),
        (
            "analytics/mod.rs",
            "pub use crate::storage::postgres::analytics_queries as queries;",
            true,
        ),
    ];

    for (file, source, expected_violation) in cases {
        let errors = check_source(Path::new(file), source);
        assert_eq!(
            !errors.is_empty(),
            expected_violation,
            "unexpected boundary result for {file} source: {source}\n{}",
            errors.join("\n")
        );
    }
}
