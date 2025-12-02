use std::path::Path;
use std::process::Command;

pub struct GitManager;

impl GitManager {
    pub fn is_git_repo(path: &str) -> bool {
        Path::new(path).join(".git").exists()
    }

    pub fn get_current_branch(repo_path: &str) -> Result<String, String> {
        let output = Command::new("git")
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(repo_path)
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    pub fn create_branch(repo_path: &str, branch_name: &str) -> Result<(), String> {
        let output = Command::new("git")
            .args(["checkout", "-b", branch_name])
            .current_dir(repo_path)
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        Ok(())
    }

    pub fn create_worktree(
        repo_path: &str,
        branch_name: &str,
        worktree_path: &str,
    ) -> Result<(), String> {
        let output = Command::new("git")
            .args(["worktree", "add", "-b", branch_name, worktree_path])
            .current_dir(repo_path)
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        Ok(())
    }

    pub fn remove_worktree(repo_path: &str, worktree_path: &str) -> Result<(), String> {
        let output = Command::new("git")
            .args(["worktree", "remove", worktree_path, "--force"])
            .current_dir(repo_path)
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        Ok(())
    }

    pub fn merge_branch(repo_path: &str, branch_name: &str) -> Result<(), String> {
        let output = Command::new("git")
            .args(["merge", branch_name, "--no-edit"])
            .current_dir(repo_path)
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        Ok(())
    }

    pub fn checkout_branch(repo_path: &str, branch_name: &str) -> Result<(), String> {
        let output = Command::new("git")
            .args(["checkout", branch_name])
            .current_dir(repo_path)
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        Ok(())
    }

    pub fn delete_branch(repo_path: &str, branch_name: &str) -> Result<(), String> {
        let output = Command::new("git")
            .args(["branch", "-D", branch_name])
            .current_dir(repo_path)
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        Ok(())
    }

    pub fn generate_branch_name(prompt: &str) -> String {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let slug: String = prompt
            .chars()
            .filter(|c| c.is_alphanumeric() || c.is_whitespace())
            .take(30)
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join("-")
            .to_lowercase();

        format!("claude/{}-{}", slug, timestamp)
    }

    pub fn get_worktree_path(repo_path: &str, branch_name: &str) -> String {
        let repo_dir = Path::new(repo_path);
        let parent = repo_dir.parent().unwrap_or(repo_dir);
        let repo_name = repo_dir
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("repo");

        let sanitized_branch = branch_name.replace('/', "-");
        parent
            .join(format!("{}-worktrees", repo_name))
            .join(&sanitized_branch)
            .to_string_lossy()
            .to_string()
    }
}
