use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::Emitter;
use tauri::Manager;

const MAX_FILE_SIZE: u64 = 50 * 1024 * 1024;

#[derive(Debug, Serialize, Clone)]
pub struct PvfData {
    pub file_name: String,
    pub temp_path: String,
}

fn validate_pvf_content(content: &str) -> bool {
    let has_magic = content.contains("<!--PVF:1.0-->") || content.contains("Vertifile");
    let has_hash = content.contains("var HASH=") || content.contains("pvf:hash");
    has_magic && has_hash
}

/// Save PVF content to temp file and return the path
fn save_to_temp(content: &str) -> Result<PathBuf, String> {
    let temp_dir = std::env::temp_dir().join("pvf-viewer");
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Cannot create temp dir: {}", e))?;
    let temp_path = temp_dir.join("current.html");
    fs::write(&temp_path, content).map_err(|e| format!("Cannot write temp file: {}", e))?;
    Ok(temp_path)
}

#[tauri::command]
fn open_file_dialog(app: tauri::AppHandle) {
    use tauri_plugin_dialog::DialogExt;
    let app_handle = app.clone();
    app.dialog()
        .file()
        .set_title("Open PVF Document")
        .add_filter("PVF Documents", &["pvf"])
        .add_filter("All Files", &["*"])
        .pick_file(move |file_path| {
            if let Some(path) = file_path {
                let path_buf = match path.as_path() {
                    Some(p) => p.to_path_buf(),
                    None => {
                        let s = path.to_string();
                        if s.starts_with("file://") {
                            PathBuf::from(s.strip_prefix("file://").unwrap_or(&s))
                        } else {
                            PathBuf::from(&s)
                        }
                    }
                };
                load_pvf_file(&app_handle, &path_buf);
            }
        });
}

#[tauri::command]
fn read_pvf_file(path: String, app: tauri::AppHandle) {
    let path_buf = PathBuf::from(&path);
    match path_buf.extension() {
        Some(ext) if ext == "pvf" => {}
        _ => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("pvf-error", "Only .pvf files can be opened.");
            }
            return;
        }
    }
    load_pvf_file(&app, &path_buf);
}

fn load_pvf_file(app: &tauri::AppHandle, file_path: &PathBuf) {
    let window = match app.get_webview_window("main") {
        Some(w) => w,
        None => return,
    };

    if !file_path.exists() {
        let _ = window.emit("pvf-error", format!("File not found: {}", file_path.display()));
        return;
    }

    match fs::metadata(file_path) {
        Ok(meta) if meta.len() > MAX_FILE_SIZE => {
            let _ = window.emit("pvf-error", "File too large.");
            return;
        }
        Err(err) => {
            let _ = window.emit("pvf-error", format!("Cannot access file: {}", err));
            return;
        }
        _ => {}
    }

    let content = match fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(err) => {
            let _ = window.emit("pvf-error", format!("Failed to read file: {}", err));
            return;
        }
    };

    let file_name = file_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    if !validate_pvf_content(&content) {
        let _ = window.emit("pvf-error", "Invalid PVF file — missing verification data.");
        return;
    }

    // Save to temp file
    let temp_path = match save_to_temp(&content) {
        Ok(p) => p,
        Err(err) => {
            let _ = window.emit("pvf-error", err);
            return;
        }
    };

    // Open the PVF in the system's default browser
    if let Err(e) = open::that(&temp_path) {
        eprintln!("[PVF] Failed to open in browser: {}", e);
        let _ = window.emit("pvf-error", format!("Failed to open: {}", e));
    } else {
        eprintln!("[PVF] Opened PVF in browser: {}", file_name);
    }

    // Notify the main window
    let data = PvfData {
        file_name: file_name.clone(),
        temp_path: temp_path.to_string_lossy().to_string(),
    };
    let _ = window.emit("pvf-loaded", &data);
    let _ = window.set_title(&format!("{} — PVF Viewer", file_name));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![open_file_dialog, read_pvf_file])
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            let pvf_arg = args.iter().skip(1)
                .find(|a| a.ends_with(".pvf") && !a.starts_with('-'));

            if let Some(pvf_path) = pvf_arg {
                let path = PathBuf::from(pvf_path);
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    load_pvf_file(&app_handle, &path);
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
