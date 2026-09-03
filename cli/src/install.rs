//! `ow self-install` and `ow install-skills`.
//!
//! `install-skills` writes the embedded skill (`cli/skill/SKILL.md`) into the
//! global skill directories of the supported agents. `self-install` copies the
//! running binary into the user bin dir, puts that dir on the user PATH
//! (Windows registry + `WM_SETTINGCHANGE` broadcast) and then installs the
//! skills.

use std::fs;
use std::path::{Path, PathBuf};

/// The skill text shipped inside the binary.
const SKILL_MD: &str = include_str!("../skill/SKILL.md");

/// Skill directory name used under each agent's `skills/` root.
const SKILL_NAME: &str = "openwhisperer";

/// The directory `self-install` copies the binary into: `%LOCALAPPDATA%\
/// OpenWhisperer\bin` on Windows, `~/.local/bin` elsewhere.
pub fn bin_dir() -> Result<PathBuf, String> {
    if cfg!(windows) {
        dirs::data_local_dir()
            .map(|dir| dir.join("OpenWhisperer").join("bin"))
            .ok_or_else(|| "could not determine %LOCALAPPDATA%".to_string())
    } else {
        dirs::home_dir()
            .map(|dir| dir.join(".local").join("bin"))
            .ok_or_else(|| "could not determine the home directory".to_string())
    }
}

/// File name of the installed binary.
fn bin_name() -> &'static str {
    if cfg!(windows) {
        "ow.exe"
    } else {
        "ow"
    }
}

/// Default skill directories: `~/.claude`, `~/.codex` and `~/.agents`.
fn default_skill_dirs() -> Result<Vec<PathBuf>, String> {
    let home =
        dirs::home_dir().ok_or_else(|| "could not determine the home directory".to_string())?;
    Ok([".claude", ".codex", ".agents"]
        .iter()
        .map(|agent| home.join(agent).join("skills").join(SKILL_NAME))
        .collect())
}

/// Write `SKILL.md` into each target directory (created if missing, existing
/// files overwritten). `overrides` replaces the default directory list.
pub fn install_skills(overrides: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    let targets = if overrides.is_empty() {
        default_skill_dirs()?
    } else {
        overrides.to_vec()
    };

    let mut written = Vec::new();
    for dir in targets {
        fs::create_dir_all(&dir)
            .map_err(|err| format!("could not create {}: {err}", dir.display()))?;
        let path = dir.join("SKILL.md");
        fs::write(&path, SKILL_MD)
            .map_err(|err| format!("could not write {}: {err}", path.display()))?;
        written.push(path);
    }
    Ok(written)
}

/// Copy the running binary into the bin dir, register that dir on the user
/// PATH and install the skills.
pub fn self_install(skills_only: bool, skill_dirs: &[PathBuf]) -> Result<(), String> {
    if !skills_only {
        let target_dir = bin_dir()?;
        fs::create_dir_all(&target_dir)
            .map_err(|err| format!("could not create {}: {err}", target_dir.display()))?;
        let source = std::env::current_exe()
            .map_err(|err| format!("could not locate the running executable: {err}"))?;
        let target = target_dir.join(bin_name());

        if same_file(&source, &target) {
            println!("Binary already installed at {}", target.display());
        } else {
            fs::copy(&source, &target).map_err(|err| {
                format!(
                    "could not copy {} to {}: {err}",
                    source.display(),
                    target.display()
                )
            })?;
            println!("Installed binary: {}", target.display());
        }

        register_on_path(&target_dir)?;
    }

    for path in install_skills(skill_dirs)? {
        println!("Installed skill: {}", path.display());
    }

    if skills_only {
        println!("\nDone. Restart your agent so it picks up the new skill.");
    } else {
        println!(
            "\nDone. Restart open terminals (and your agent) to pick up the new PATH.\n\
             Sessions started by OpenWhisperer itself already get the bin directory prepended."
        );
    }
    Ok(())
}

/// True when both paths resolve to the same file on disk.
fn same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// Put `dir` on the user PATH (Windows), or tell the user how to (unix).
#[cfg(windows)]
fn register_on_path(dir: &Path) -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, REG_EXPAND_SZ};
    use winreg::types::FromRegValue;
    use winreg::{RegKey, RegValue};

    let dir_display = dir.display().to_string();
    let (env, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey("Environment")
        .map_err(|err| format!("could not open HKCU\\Environment: {err}"))?;

    // Read the raw value so `%VAR%` entries survive verbatim — expanding them
    // and writing the result back would bake in machine-specific paths.
    let current = match env.get_raw_value("Path") {
        Ok(value) => String::from_reg_value(&value)
            .map_err(|err| format!("could not read the user PATH: {err}"))?,
        Err(_) => String::new(),
    };

    let already_present = current
        .split(';')
        .map(|entry| entry.trim().trim_end_matches(['\\', '/']))
        .any(|entry| entry.eq_ignore_ascii_case(dir_display.trim_end_matches(['\\', '/'])));
    if already_present {
        println!("User PATH already contains {dir_display}");
        return Ok(());
    }

    let updated = if current.trim().is_empty() {
        dir_display.clone()
    } else {
        format!("{};{}", current.trim_end_matches(';'), dir_display)
    };
    let mut bytes: Vec<u8> = updated
        .encode_utf16()
        .flat_map(|unit| unit.to_le_bytes())
        .collect();
    bytes.extend_from_slice(&[0, 0]);
    env.set_raw_value(
        "Path",
        &RegValue {
            bytes,
            vtype: REG_EXPAND_SZ,
        },
    )
    .map_err(|err| format!("could not update the user PATH: {err}"))?;
    broadcast_environment_change();
    println!("Added to user PATH: {dir_display}");
    Ok(())
}

/// Tell running processes (Explorer, new shells) that the environment changed.
#[cfg(windows)]
fn broadcast_environment_change() {
    use windows_sys::Win32::Foundation::{LPARAM, WPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
    };

    let param: Vec<u16> = "Environment\0".encode_utf16().collect();
    let mut result: usize = 0;
    // Safety: the message is a documented broadcast; `param` outlives the call
    // (SMTO_ABORTIFHUNG bounds it to the 5 s timeout) and `result` is a valid
    // out-pointer.
    unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            0 as WPARAM,
            param.as_ptr() as LPARAM,
            SMTO_ABORTIFHUNG,
            5_000,
            &mut result,
        );
    }
}

#[cfg(not(windows))]
fn register_on_path(dir: &Path) -> Result<(), String> {
    let dir_display = dir.display().to_string();
    let on_path = std::env::var("PATH").unwrap_or_default().split(':').any(
        |entry| entry.trim_end_matches('/') == dir_display.trim_end_matches('/'),
    );
    if on_path {
        println!("PATH already contains {dir_display}");
    } else {
        println!(
            "{dir_display} is not on your PATH. Add this to your shell profile:\n  \
             export PATH=\"{dir_display}:$PATH\""
        );
    }
    Ok(())
}
