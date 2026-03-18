use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::Emitter;
use tauri::Manager;

/// Maximum PVF file size: 50 MB
const MAX_FILE_SIZE: u64 = 50 * 1024 * 1024;

#[derive(Debug, Serialize, Clone)]
pub struct PvfData {
    pub content: String,
    pub file_name: String,
}

/// Validate that the content looks like a PVF file
fn validate_pvf_content(content: &str) -> bool {
    content.contains("Vertifile")
        && content.contains("var HASH=")
        && content.contains("var SIG=")
}

/// Validate the file path is safe (ends with .pvf, no directory traversal)
fn validate_pvf_path(path: &PathBuf) -> Result<(), String> {
    // Must have .pvf extension
    match path.extension() {
        Some(ext) if ext == "pvf" => {}
        _ => return Err("Only .pvf files can be opened.".to_string()),
    }

    // Canonicalize to resolve symlinks and .. traversal
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Invalid file path: {}", e))?;

    // Ensure the canonical path still has .pvf extension (prevent symlink tricks)
    match canonical.extension() {
        Some(ext) if ext == "pvf" => Ok(()),
        _ => Err("Resolved path is not a .pvf file.".to_string()),
    }
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
                let path_str = path.to_string();
                let path_buf = PathBuf::from(&path_str);
                load_pvf_file(&app_handle, &path_buf);
            }
        });
}

#[tauri::command]
fn read_pvf_file(path: String, app: tauri::AppHandle) {
    let path_buf = PathBuf::from(&path);

    // Validate path before loading
    if let Err(msg) = validate_pvf_path(&path_buf) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.emit("pvf-error", msg);
        }
        return;
    }

    load_pvf_file(&app, &path_buf);
}

fn load_pvf_file(app: &tauri::AppHandle, file_path: &PathBuf) {
    // Get the main window
    let window = match app.get_webview_window("main") {
        Some(w) => w,
        None => return,
    };

    // Check file exists
    if !file_path.exists() {
        let _ = window.emit(
            "pvf-error",
            format!("File not found: {}", file_path.display()),
        );
        return;
    }

    // Check file size before reading
    match fs::metadata(file_path) {
        Ok(meta) => {
            if meta.len() > MAX_FILE_SIZE {
                let _ = window.emit(
                    "pvf-error",
                    format!(
                        "File too large ({:.1} MB). Maximum allowed size is {} MB.",
                        meta.len() as f64 / (1024.0 * 1024.0),
                        MAX_FILE_SIZE / (1024 * 1024)
                    ),
                );
                return;
            }
        }
        Err(err) => {
            let _ = window.emit("pvf-error", format!("Cannot access file: {}", err));
            return;
        }
    }

    // Read file content
    let content = match fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(err) => {
            let _ = window.emit("pvf-error", format!("Failed to read file: {}", err));
            return;
        }
    };

    // Get file name
    let file_name = file_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Validate PVF content
    if !validate_pvf_content(&content) {
        let _ = window.emit(
            "pvf-error",
            "Invalid PVF file \u{2014} missing verification data.".to_string(),
        );
        return;
    }

    // Emit the loaded event
    let data = PvfData {
        content,
        file_name: file_name.clone(),
    };

    if let Err(e) = window.emit("pvf-loaded", &data) {
        eprintln!("[PVF Viewer] Failed to emit pvf-loaded event: {}", e);
    }

    // Update window title
    if let Err(e) = window.set_title(&format!("{} \u{2014} PVF Viewer", file_name)) {
        eprintln!("[PVF Viewer] Failed to set window title: {}", e);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![open_file_dialog, read_pvf_file])
        .setup(|app| {
            // Handle CLI args: look for a .pvf file path
            let args: Vec<String> = std::env::args().collect();
            let pvf_arg = args
                .iter()
                .skip(1) // skip the binary name
                .find(|a| a.ends_with(".pvf") && !a.starts_with('-'));

            if let Some(pvf_path) = pvf_arg {
                let path = PathBuf::from(pvf_path);
                let app_handle = app.handle().clone();

                // Load file after window is ready using a background thread
                let path_clone = path.clone();
                std::thread::spawn(move || {
                    // Wait for webview to initialize
                    std::thread::sleep(std::time::Duration::from_millis(800));
                    load_pvf_file(&app_handle, &path_clone);
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
