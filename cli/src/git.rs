//! Git repository / worktree detection and path normalization.
//!
//! The CLI reports three things about its working directory: the **main**
//! repository root (parent of the git common dir), the current worktree root
//! (`null` when it *is* the main root) and the checked-out branch. Everything
//! is best-effort: outside a repository — or without `git` on PATH — all three
//! are `None` and the app decides what to do.

use std::path::Path;
use std::process::Command;

/// What the CLI could learn about the working directory.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct GitInfo {
    /// Main worktree root (the git common dir's parent).
    pub repo_path: Option<String>,
    /// Current worktree root, or `None` when it equals `repo_path`.
    pub worktree_path: Option<String>,
    /// Current branch, or `None` when detached.
    pub branch: Option<String>,
}

/// Inspect `cwd` with `git rev-parse`.
pub fn detect(cwd: &Path) -> GitInfo {
    let Some(toplevel) = git(cwd, &["rev-parse", "--show-toplevel"]) else {
        return GitInfo::default();
    };
    let toplevel = normalize_path_str(&toplevel);

    let repo_path = git(
        cwd,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )
    .map(|common| main_root_from_common_dir(&common))
    // Older git versions lack --path-format; treating the worktree root as the
    // main root is the safe fallback (the app then sees no worktree).
    .unwrap_or_else(|| toplevel.clone());

    let worktree_path = if same_path(&toplevel, &repo_path) {
        None
    } else {
        Some(toplevel)
    };

    let branch = git(cwd, &["rev-parse", "--abbrev-ref", "HEAD"])
        .filter(|branch| !branch.is_empty() && branch != "HEAD");

    GitInfo {
        repo_path: Some(repo_path),
        worktree_path,
        branch,
    }
}

/// Run `git <args>` in `cwd`, returning trimmed stdout on success.
fn git(cwd: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git").args(args).current_dir(cwd).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// Derive the main repository root from a git common dir: its parent when it
/// ends in `/.git`, else the directory itself (bare repositories).
pub fn main_root_from_common_dir(common_dir: &str) -> String {
    let normalized = normalize_path_str(common_dir);
    match normalized.rsplit_once('/') {
        Some((parent, last)) if last.eq_ignore_ascii_case(".git") && !parent.is_empty() => {
            normalize_path_str(parent)
        }
        _ => normalized,
    }
}

/// Normalize a path to absolute-ish forward-slash form: strips the Windows
/// `\\?\` verbatim prefix, converts separators and drops a trailing slash
/// (except for roots such as `C:/` or `/`).
pub fn normalize_path_str(path: &str) -> String {
    let trimmed = path.trim();
    let without_verbatim = trimmed
        .strip_prefix(r"\\?\UNC\")
        .map(|rest| format!(r"\\{rest}"))
        .unwrap_or_else(|| {
            trimmed
                .strip_prefix(r"\\?\")
                .unwrap_or(trimmed)
                .to_string()
        });
    let mut slashed = without_verbatim.replace('\\', "/");
    while slashed.len() > 1 && slashed.ends_with('/') && !slashed.ends_with(":/") {
        slashed.pop();
    }
    slashed
}

/// Normalize the process working directory for the request payload.
pub fn normalize_current_dir() -> Result<String, String> {
    let cwd = std::env::current_dir()
        .map_err(|err| format!("could not determine the current directory: {err}"))?;
    Ok(normalize_path_str(&cwd.to_string_lossy()))
}

/// Path equality — case-insensitive on Windows, exact elsewhere.
fn same_path(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b)
    } else {
        a == b
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn main_root_strips_dot_git() {
        assert_eq!(
            main_root_from_common_dir("F:/Repos/Foo/.git"),
            "F:/Repos/Foo"
        );
        assert_eq!(
            main_root_from_common_dir(r"F:\Repos\Foo\.git"),
            "F:/Repos/Foo"
        );
        assert_eq!(
            main_root_from_common_dir("F:/Repos/Foo/.git/"),
            "F:/Repos/Foo"
        );
        assert_eq!(
            main_root_from_common_dir("/home/me/proj/.git"),
            "/home/me/proj"
        );
    }

    #[test]
    fn main_root_keeps_bare_repos() {
        assert_eq!(
            main_root_from_common_dir("F:/Repos/Foo.git"),
            "F:/Repos/Foo.git"
        );
        assert_eq!(main_root_from_common_dir("/srv/bare"), "/srv/bare");
    }

    #[test]
    fn normalizes_windows_paths() {
        assert_eq!(normalize_path_str(r"F:\Repos\Foo"), "F:/Repos/Foo");
        assert_eq!(normalize_path_str(r"\\?\F:\Repos\Foo"), "F:/Repos/Foo");
        assert_eq!(normalize_path_str(r"F:\Repos\Foo\"), "F:/Repos/Foo");
        assert_eq!(normalize_path_str(r"F:\"), "F:/");
        assert_eq!(normalize_path_str("  F:/Repos/Foo  "), "F:/Repos/Foo");
    }

    #[test]
    fn normalizes_unc_and_posix_paths() {
        assert_eq!(
            normalize_path_str(r"\\?\UNC\server\share\proj"),
            "//server/share/proj"
        );
        assert_eq!(normalize_path_str("/home/me/proj/"), "/home/me/proj");
        assert_eq!(normalize_path_str("/"), "/");
    }
}
