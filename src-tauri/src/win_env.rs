//! Windows-only repair of the environment that spawned processes inherit.
//!
//! Every agent process the app starts — the Node sidecar, the Codex app-server,
//! validation agents, `gh`/`git` calls — inherits this process's environment.
//! A GUI launch (Explorer, Start menu) hands us a clean one, but a launch from
//! an MSYS shell (Git Bash, or a Warp/VS Code terminal defaulting to bash — the
//! usual `npm run tauri:dev` path) can hand us a PATH that is already mangled,
//! and the damage is invisible until an agent's Bash tool fails with something
//! like `grep: command not found`.
//!
//! Two corruptions have been observed in the wild, both from MSYS's
//! Windows<->POSIX PATH conversion running one time too many:
//!
//! * **Double conversion.** A Windows-form PATH handed to MSYS as if it were
//!   POSIX. Splitting `C:\Program Files\X;C:\Y` on `:` yields `C`,
//!   `\Program Files\X;C`, `\Y`; converting those back to Windows form resolves
//!   the drive-less fragments against the current drive and rejoins on `;`:
//!   `C;F:\Program Files\X;C;F:\Y`.
//! * **Mixed separators.** A POSIX-form entry appended to a Windows-form PATH
//!   with `:` as the separator: `...\PowerShell\7\:/c/Users/me/bin`.
//!
//! Both leave signatures no legitimate Windows PATH has, so we detect rather
//! than guess, and rebuild from the registry — the *persisted* PATH is
//! virtually always fine, since the corruption is runtime-only.

use std::collections::HashSet;
use std::path::Path;
use std::process::Command;

/// Marker variables MSYS/Cygwin shells export into their children.
///
/// `MSYSTEM` is the one that matters: the MSYS runtime reads its presence as
/// "my parent was already an MSYS process" and skips the Windows->POSIX
/// conversion of PATH. A Git Bash started underneath a process that leaked it
/// therefore receives a `;`-separated PATH, splits it on `:`, and ends up with
/// no `/usr/bin` — that is the `grep: command not found` failure mode. The rest
/// are removed with it so the child sees one coherent shell identity.
const MSYS_MARKER_VARS: &[&str] = &[
    "MSYSTEM",
    "MSYSTEM_CHOST",
    "MSYSTEM_PREFIX",
    "MINGW_CHOST",
    "MINGW_PREFIX",
    "MINGW_PACKAGE_PREFIX",
    "MSYS",
    "MSYS2_PATH_TYPE",
    "MSYS2_ARG_CONV_EXCL",
    "MSYS2_ENV_CONV_EXCL",
    "ORIGINAL_PATH",
    "ORIGINAL_TEMP",
    "ORIGINAL_TMP",
    "EXEPATH",
];

/// Variables that are meaningful on Windows but useless in POSIX form. A
/// leaked `HOME=/c/Users/me` sends native tools (git above all) looking for a
/// config directory that does not exist; dropping the variable lets them fall
/// back to `USERPROFILE`/`TEMP` as they would in a normal Windows session.
const POSIX_FORM_VARS: &[&str] = &["HOME", "SHELL", "TMPDIR"];

/// Outcome of [`repair_process_env`], replayed into the log once the log plugin
/// exists (the repair itself has to run before anything spawns, which is before
/// logging is initialised — same replay pattern as the config load).
#[derive(Default)]
pub struct PathRepairReport {
    /// Entry count of the inherited PATH.
    pub entries_before: usize,
    /// Segments that tripped the corruption check (empty = nothing to do).
    pub corrupt: Vec<String>,
    /// The PATH now in force, when a repair was applied.
    pub repaired: Option<String>,
    /// Why a needed repair could not be applied.
    pub failure: Option<String>,
}

impl PathRepairReport {
    pub fn log(&self) {
        if self.corrupt.is_empty() {
            log::info!(
                "[env] Inherited PATH looks clean ({} entries)",
                self.entries_before
            );
            return;
        }
        log::warn!(
            "[env] Inherited PATH is MSYS-mangled ({} entries, {} corrupt): {}",
            self.entries_before,
            self.corrupt.len(),
            self.corrupt.join(" | ")
        );
        match (&self.repaired, &self.failure) {
            (Some(path), _) => log::warn!(
                "[env] PATH rebuilt from the registry ({} entries): {}",
                path.split(';').filter(|s| !s.trim().is_empty()).count(),
                path
            ),
            (None, Some(err)) => log::error!(
                "[env] PATH left as-is — could not read the registry PATH: {}. \
                 Agent processes may fail to find CLI tools; relaunching the app \
                 from PowerShell or cmd clears it.",
                err
            ),
            (None, None) => {}
        }
    }
}

/// Repair this process's PATH in place when it carries MSYS mangling, so that
/// everything spawned later inherits a usable one. No-op on a clean PATH: a
/// launching shell may have legitimately added entries, and the registry does
/// not know about those.
pub fn repair_process_env() -> PathRepairReport {
    let runtime = std::env::var("PATH").unwrap_or_default();
    let mut report = PathRepairReport {
        entries_before: runtime.split(';').filter(|s| !s.trim().is_empty()).count(),
        corrupt: corrupt_segments(&runtime),
        ..Default::default()
    };
    if report.corrupt.is_empty() {
        return report;
    }
    match registry_path() {
        Ok(base) => {
            let repaired = merge_intact_extras(&base, &runtime);
            std::env::set_var("PATH", &repaired);
            report.repaired = Some(repaired);
        }
        Err(err) => report.failure = Some(err),
    }
    report
}

/// Strip MSYS/Cygwin leakage from a child's environment.
///
/// Deliberately narrower than [`repair_process_env`], which fixes this whole
/// process: a mangled PATH is never what anyone wanted, but the MSYS markers
/// are meaningful to a user's own launch-profile command that intentionally
/// runs bash. So the markers are removed only for the agent rails.
///
/// Returns what was removed, for logging.
pub fn scrub_child_env(cmd: &mut Command) -> Vec<String> {
    let mut removed = Vec::new();
    for var in MSYS_MARKER_VARS {
        if std::env::var_os(var).is_some() {
            cmd.env_remove(var);
            removed.push((*var).to_string());
        }
    }
    for var in POSIX_FORM_VARS {
        if let Ok(value) = std::env::var(var) {
            if value.starts_with('/') {
                cmd.env_remove(var);
                removed.push(format!("{}={}", var, value));
            }
        }
    }
    removed
}

/// One-line PATH description for the log: entry count, plus the offending
/// segments when something still looks wrong.
pub fn path_health(path: &str) -> String {
    let entries = path.split(';').filter(|s| !s.trim().is_empty()).count();
    let corrupt = corrupt_segments(path);
    if corrupt.is_empty() {
        format!("{} entries, ok", entries)
    } else {
        format!(
            "{} entries, {} CORRUPT: {} — full value: {}",
            entries,
            corrupt.len(),
            corrupt.join(" | "),
            path
        )
    }
}

/// Segments that no legitimate Windows PATH contains. Empty segments are
/// untidy but common, so they don't count as corruption.
fn corrupt_segments(path: &str) -> Vec<String> {
    path.split(';')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .filter(|s| is_corrupt_segment(s))
        .map(str::to_string)
        .collect()
}

fn is_corrupt_segment(seg: &str) -> bool {
    let seg = unquote(seg);
    // A bare drive letter: the `:` was eaten when `C:\Program Files\X` was
    // split POSIX-style into `C` and `\Program Files\X`.
    if seg.len() == 1 && seg.starts_with(|c: char| c.is_ascii_alphabetic()) {
        return true;
    }
    // POSIX-form entry (`/c/Users/...`), never usable by a Windows process.
    if seg.starts_with('/') {
        return true;
    }
    // A `:` anywhere but the drive separator means two entries were joined with
    // the POSIX separator.
    seg.bytes().enumerate().any(|(i, b)| b == b':' && i != 1)
}

fn unquote(seg: &str) -> &str {
    seg.trim().trim_matches('"')
}

/// The persisted PATH: machine scope first (matching how Windows itself builds
/// the variable), then user scope.
fn registry_path() -> Result<String, String> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    let machine = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(
            r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
            KEY_READ,
        )
        .and_then(|key| key.get_value::<String, _>("Path"))
        .map_err(|e| format!("machine PATH: {}", e))?;
    // A user-scope PATH is optional — plenty of accounts don't have one.
    let user = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags("Environment", KEY_READ)
        .and_then(|key| key.get_value::<String, _>("Path"))
        .unwrap_or_default();

    let joined = if user.trim().is_empty() {
        machine
    } else {
        format!("{};{}", machine.trim_end_matches(';'), user)
    };
    Ok(expand_percent_vars(&joined))
}

/// Expand `%VAR%` references, which the registry stores unexpanded
/// (`REG_EXPAND_SZ`). `%PATH%` itself is left literal — expanding it would
/// splice the corrupt runtime value straight back into the repaired one.
fn expand_percent_vars(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        let (before, after) = rest.split_at(start);
        out.push_str(before);
        match after[1..].find('%') {
            Some(end) => {
                let name = &after[1..=end];
                let resolved = if name.eq_ignore_ascii_case("PATH") {
                    None
                } else {
                    std::env::var(name).ok()
                };
                match resolved {
                    Some(v) => out.push_str(&v),
                    // Unknown name: keep it verbatim rather than silently
                    // dropping a directory we can't resolve.
                    None => out.push_str(&after[..=end + 1]),
                }
                rest = &after[end + 2..];
            }
            None => {
                out.push_str(after);
                return out;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Registry entries first, then runtime entries that survived intact **and**
/// exist on disk.
///
/// The existence check is what makes this safe: a shell may legitimately have
/// prepended a toolchain directory (nvm, a venv) that the registry knows
/// nothing about and that we should keep, while a mangled entry — say
/// `F:\Program Files\...`, produced by resolving a drive-less fragment against
/// whatever the current drive happened to be — points nowhere and is dropped.
fn merge_intact_extras(registry: &str, runtime: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for seg in registry.split(';') {
        push_unique(seg, &mut out, &mut seen);
    }
    for seg in runtime.split(';') {
        let seg = seg.trim();
        if seg.is_empty() || is_corrupt_segment(seg) {
            continue;
        }
        if !Path::new(unquote(seg)).is_dir() {
            continue;
        }
        push_unique(seg, &mut out, &mut seen);
    }
    out.join(";")
}

fn push_unique(seg: &str, out: &mut Vec<String>, seen: &mut HashSet<String>) {
    let seg = seg.trim();
    let key = unquote(seg).trim_end_matches(['\\', '/']).to_lowercase();
    if key.is_empty() || !seen.insert(key) {
        return;
    }
    out.push(seg.to_string());
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exact shape reported from the field: `C:\A;C:\B` parsed as POSIX and
    /// converted back, resolving the drive-less halves against drive F:.
    #[test]
    fn detects_double_conversion() {
        let mangled = r"C;F:\Program Files\Microsoft SDKs\Azure\CLI2\wbin;C;F:\Program Files\Git\cmd";
        let corrupt = corrupt_segments(mangled);
        assert_eq!(corrupt, vec!["C", "C"]);
    }

    /// A POSIX entry appended to a Windows-form PATH with `:`.
    #[test]
    fn detects_mixed_separators() {
        let mangled = r"C:\Windows;C:\Program Files\PowerShell\7\:/c/Users/me/.claude/bin";
        assert_eq!(
            corrupt_segments(mangled),
            vec![r"C:\Program Files\PowerShell\7\:/c/Users/me/.claude/bin"]
        );
        assert_eq!(corrupt_segments("/usr/bin;/c/Windows").len(), 2);
    }

    #[test]
    fn leaves_healthy_paths_alone() {
        let clean = r"C:\Windows\system32;C:\Program Files (x86)\NVIDIA Corporation\PhysX\Common;;C:\Users\me\AppData\Local\nvm;\\server\share\tools";
        assert!(corrupt_segments(clean).is_empty());
        // Quoted entries are legal and must not read as a stray colon.
        assert!(corrupt_segments("\"C:\\Program Files\\Git\\cmd\"").is_empty());
    }

    #[test]
    fn merge_keeps_registry_order_and_drops_garbage() {
        let registry = r"C:\Windows\system32;C:\Windows";
        // `C` is corrupt; the F: entry is syntactically fine but points nowhere.
        let runtime = format!(
            r"C;F:\Program Files\Nope;{};C:\Windows\SYSTEM32",
            env!("CARGO_MANIFEST_DIR")
        );
        let merged = merge_intact_extras(registry, &runtime);
        let entries: Vec<&str> = merged.split(';').collect();
        assert_eq!(entries[0], r"C:\Windows\system32");
        assert_eq!(entries[1], r"C:\Windows");
        // The real directory survives; the mangled ones don't.
        assert!(merged.contains(env!("CARGO_MANIFEST_DIR")));
        assert!(!merged.contains("Nope"));
        // Case- and trailing-slash-insensitive dedup: SYSTEM32 is already there.
        assert_eq!(entries.len(), 3);
    }

    /// The repair is only as good as the value it rebuilds from, so read the
    /// real persisted PATH: it must be non-empty, free of the corruption
    /// signatures, and fully expanded (no `%VAR%` left over from REG_EXPAND_SZ).
    #[test]
    fn reads_a_usable_registry_path() {
        let path = registry_path().expect("registry PATH should be readable");
        assert!(!path.trim().is_empty());
        assert!(corrupt_segments(&path).is_empty(), "corrupt: {}", path);
        assert!(!path.contains('%'), "unexpanded reference in: {}", path);
    }

    #[test]
    fn expands_registry_style_references() {
        std::env::set_var("OW_TEST_ROOT", r"C:\Root");
        assert_eq!(
            expand_percent_vars(r"%OW_TEST_ROOT%\bin;C:\Other"),
            r"C:\Root\bin;C:\Other"
        );
        // Self-reference must not splice the corrupt runtime value back in.
        assert_eq!(expand_percent_vars(r"%PATH%;C:\X"), r"%PATH%;C:\X");
        // Unknown names and a stray `%` are preserved verbatim.
        assert_eq!(expand_percent_vars("%OW_NOPE%;C:\\X"), "%OW_NOPE%;C:\\X");
        assert_eq!(expand_percent_vars("100%;C:\\X"), "100%;C:\\X");
    }
}
