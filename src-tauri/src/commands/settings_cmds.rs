use crate::config::{AppConfig, RepoConfig};
use crate::git::GitManager;
use tauri::State;
use parking_lot::Mutex;

pub type ConfigState = Mutex<AppConfig>;

#[tauri::command]
pub fn get_config(config: State<ConfigState>) -> AppConfig {
    config.lock().clone()
}

#[tauri::command]
pub fn save_config(config: State<ConfigState>, new_config: AppConfig) -> Result<(), String> {
    let mut cfg = config.lock();
    *cfg = new_config;
    cfg.save()
}

#[tauri::command]
pub fn add_repo(config: State<ConfigState>, path: String, name: String) -> Result<(), String> {
    println!("[add_repo] Called with path: {}, name: {}", path, name);
    let mut cfg = config.lock();
    cfg.repos.push(RepoConfig { path: path.clone(), name: name.clone() });
    println!("[add_repo] Repo added to config, total repos: {}", cfg.repos.len());
    let result = cfg.save();
    match &result {
        Ok(()) => println!("[add_repo] Config saved successfully"),
        Err(e) => println!("[add_repo] Failed to save config: {}", e),
    }
    result
}

#[tauri::command]
pub fn remove_repo(config: State<ConfigState>, index: usize) -> Result<(), String> {
    let mut cfg = config.lock();
    if index < cfg.repos.len() {
        cfg.repos.remove(index);
        if cfg.active_repo_index >= cfg.repos.len() && !cfg.repos.is_empty() {
            cfg.active_repo_index = cfg.repos.len() - 1;
        }
        cfg.save()
    } else {
        Err("Invalid repo index".to_string())
    }
}

#[tauri::command]
pub fn set_active_repo(config: State<ConfigState>, index: usize) -> Result<(), String> {
    let mut cfg = config.lock();
    if index < cfg.repos.len() {
        cfg.active_repo_index = index;
        cfg.save()
    } else {
        Err("Invalid repo index".to_string())
    }
}

#[tauri::command]
pub fn get_active_repo(config: State<ConfigState>) -> Option<RepoConfig> {
    let cfg = config.lock();
    cfg.get_active_repo().cloned()
}

#[tauri::command]
pub fn get_git_branch(repo_path: String) -> Result<String, String> {
    GitManager::get_current_branch(&repo_path)
}
