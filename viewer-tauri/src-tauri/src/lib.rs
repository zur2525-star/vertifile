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
/// Check for the magic bytes and at least one of the key markers
fn validate_pvf_content(content: &str) -> bool {
    // Must have the PVF magic bytes or Vertifile branding
    let has_magic = content.contains("<!--PVF:1.0-->") || content.contains("Vertifile");
    // Must have a hash variable (always present even after obfuscation)
    let has_hash = content.contains("var HASH=") || content.contains("pvf:hash");
    has_magic && has_hash
}

#[tauri::command]
fn open_file_dialog(app: tauri::AppHandle) {
    use tauri_plugin_dialog::DialogExt;

    eprintln!("[PVF] open_file_dialog called");
    let app_handle = app.clone();

    app.dialog()
        .file()
        .set_title("Open PVF Document")
        .add_filter("PVF Documents", &["pvf"])
        .add_filter("All Files", &["*"])
        .pick_file(move |file_path| {
            eprintln!("[PVF] pick_file callback: {:?}", file_path);
            if let Some(path) = file_path {
                // FilePath in Tauri v2 can be a Path or URL
                let path_buf = match path.as_path() {
                    Some(p) => p.to_path_buf(),
                    None => {
                        // Try to convert from string (might be file:// URL)
                        let s = path.to_string();
                        eprintln!("[PVF] FilePath as string: {}", s);
                        if s.starts_with("file://") {
                            PathBuf::from(s.strip_prefix("file://").unwrap_or(&s))
                        } else {
                            PathBuf::from(&s)
                        }
                    }
                };
                eprintln!("[PVF] Loading file: {:?}", path_buf);
                load_pvf_file(&app_handle, &path_buf);
            }
        });
}

#[tauri::command]
fn read_pvf_file(path: String, app: tauri::AppHandle) {
    eprintln!("[PVF] read_pvf_file called with: {}", path);
    let path_buf = PathBuf::from(&path);

    // Validate path — must end in .pvf
    match path_buf.extension() {
        Some(ext) if ext == "pvf" => {}
        _ => {
            eprintln!("[PVF] Rejected: not a .pvf file");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("pvf-error", "Only .pvf files can be opened.");
            }
            return;
        }
    }

    load_pvf_file(&app, &path_buf);
}

fn load_pvf_file(app: &tauri::AppHandle, file_path: &PathBuf) {
    eprintln!("[PVF] load_pvf_file: {:?}", file_path);

    // Get the main window
    let window = match app.get_webview_window("main") {
        Some(w) => w,
        None => {
            eprintln!("[PVF] ERROR: No main window found!");
            return;
        }
    };

    // Check file exists
    if !file_path.exists() {
        eprintln!("[PVF] File not found: {:?}", file_path);
        let _ = window.emit(
            "pvf-error",
            format!("File not found: {}", file_path.display()),
        );
        return;
    }

    // Check file size before reading
    match fs::metadata(file_path) {
        Ok(meta) => {
            eprintln!("[PVF] File size: {} bytes", meta.len());
            if meta.len() > MAX_FILE_SIZE {
                let _ = window.emit("pvf-error", "File too large.");
                return;
            }
        }
        Err(err) => {
            eprintln!("[PVF] Cannot read metadata: {}", err);
            let _ = window.emit("pvf-error", format!("Cannot access file: {}", err));
            return;
        }
    }

    // Read file content
    let content = match fs::read_to_string(file_path) {
        Ok(c) => {
            eprintln!("[PVF] Read {} chars", c.len());
            c
        }
        Err(err) => {
            eprintln!("[PVF] Read error: {}", err);
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
        eprintln!("[PVF] Invalid PVF content — missing markers");
        let _ = window.emit(
            "pvf-error",
            "Invalid PVF file \u{2014} missing verification data.".to_string(),
        );
        return;
    }

    eprintln!("[PVF] Valid PVF! Emitting pvf-loaded for: {}", file_name);

    // Emit the loaded event
    let data = PvfData {
        content,
        file_name: file_name.clone(),
    };

    if let Err(e) = window.emit("pvf-loaded", &data) {
        eprintln!("[PVF] Failed to emit pvf-loaded: {}", e);
    } else {
        eprintln!("[PVF] pvf-loaded emitted successfully!");
    }

    // Update window title
    let _ = window.set_title(&format!("{} \u{2014} PVF Viewer", file_name));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![open_file_dialog, read_pvf_file])
        .setup(|app| {
            // Handle CLI args: look for a .pvf file path
            let args: Vec<String> = std::env::args().collect();
            eprintln!("[PVF] CLI args: {:?}", args);

            let pvf_arg = args
                .iter()
                .skip(1)
                .find(|a| a.ends_with(".pvf") && !a.starts_with('-'));

            if let Some(pvf_path) = pvf_arg {
                eprintln!("[PVF] Found CLI arg: {}", pvf_path);
                let path = PathBuf::from(pvf_path);
                let app_handle = app.handle().clone();

                let path_clone = path.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    eprintln!("[PVF] Loading from CLI arg after delay...");
                    load_pvf_file(&app_handle, &path_clone);
                });
            } else {
                eprintln!("[PVF] No .pvf file in CLI args");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
