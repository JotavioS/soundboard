// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use std::process::{Child, Command, Stdio};
use tauri::Manager;

struct EngineState(Mutex<Option<Child>>);

use serde::{Deserialize, Serialize};
use zeromq::{ReqSocket, Socket, SocketRecv, SocketSend};

#[derive(Serialize, Deserialize, Debug)]
struct PlaySoundCommand {
    cmd: String,
    path: String,
    volume: f32,
    #[serde(rename = "startTime")]
    start_time: f32,
    #[serde(rename = "endTime")]
    end_time: f32,
}

#[derive(Serialize, Deserialize, Debug)]
struct ToggleVoiceCommand {
    cmd: String,
    enabled: bool,
}

// Since UI actions are low frequency (clicking buttons), creating a socket per command is perfectly fine for localhost ZMQ.
async fn send_zmq_command(json_str: String) -> Result<(), String> {
    let mut socket = ReqSocket::new();
    socket
        .connect("tcp://127.0.0.1:5556")
        .await
        .map_err(|e| e.to_string())?;
    socket
        .send(json_str.into())
        .await
        .map_err(|e| e.to_string())?;
    let _reply = socket.recv().await.map_err(|e| e.to_string())?;
    socket.close().await;
    Ok(())
}

async fn send_zmq_command_with_reply(json_str: String) -> Result<String, String> {
    let mut socket = ReqSocket::new();
    socket
        .connect("tcp://127.0.0.1:5556")
        .await
        .map_err(|e| e.to_string())?;
    socket
        .send(json_str.into())
        .await
        .map_err(|e| e.to_string())?;
    let reply = socket.recv().await.map_err(|e| e.to_string())?;
    socket.close().await;
    let mut bytes = Vec::new();
    for part in reply.into_vec() {
        bytes.extend_from_slice(&part);
    }
    String::from_utf8(bytes).map_err(|e| e.to_string())
}
#[tauri::command]
async fn play_sound(
    path: String,
    volume: f32,
    start_time: f32,
    end_time: f32,
) -> Result<(), String> {
    let cmd = PlaySoundCommand {
        cmd: "PLAY_SOUND".to_string(),
        path,
        volume,
        start_time,
        end_time,
    };

    let json_str = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
    send_zmq_command(json_str).await
}

#[tauri::command]
async fn toggle_voice(enabled: bool) -> Result<(), String> {
    let cmd = ToggleVoiceCommand {
        cmd: "SET_VOICE_CHANGER".to_string(),
        enabled,
    };

    let json_str = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
    send_zmq_command(json_str).await
}

#[derive(Serialize, Deserialize, Debug)]
struct ToggleHearMyselfCommand {
    cmd: String,
    enabled: bool,
}

#[tauri::command]
async fn toggle_hear_myself(enabled: bool) -> Result<(), String> {
    let cmd = ToggleHearMyselfCommand {
        cmd: "SET_HEAR_MYSELF".to_string(),
        enabled,
    };
    
    let json_str = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
    send_zmq_command(json_str).await
}

#[tauri::command]
async fn toggle_satanic_1(enabled: bool) -> Result<(), String> {
    let cmd = serde_json::json!({
        "cmd": "SET_SATANIC_1",
        "enabled": enabled
    });
    
    let json_str = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
    send_zmq_command(json_str).await
}

#[tauri::command]
async fn toggle_satanic_2(enabled: bool) -> Result<(), String> {
    let cmd = serde_json::json!({
        "cmd": "SET_SATANIC_2",
        "enabled": enabled
    });
    
    let json_str = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
    send_zmq_command(json_str).await
}

#[derive(Serialize, Deserialize, Debug)]
struct LoadModelCommand {
    cmd: String,
    path: String,
    index_path: String,
}

#[tauri::command]
async fn set_voice_model(path: String, index_path: String) -> Result<(), String> {
    let cmd = LoadModelCommand {
        cmd: "SET_VOICE_MODEL".to_string(),
        path,
        index_path,
    };
    let json_str = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
    send_zmq_command(json_str).await
}

#[derive(Serialize, Deserialize, Debug)]
struct SetPitchCommand {
    cmd: String,
    pitch: i32,
}

#[tauri::command]
async fn set_voice_pitch(pitch: i32) -> Result<(), String> {
    let cmd = SetPitchCommand {
        cmd: "SET_PITCH".to_string(),
        pitch,
    };
    let json_str = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
    send_zmq_command(json_str).await
}

#[derive(Serialize, Deserialize, Debug)]
struct SetVoiceControlCommand {
    cmd: String,
    pitch_estimator: String,
    index_rate: f32,
    chunk_frames: usize,
    extra_frames: usize,
    embedder: String,
}

#[tauri::command]
async fn set_voice_control(
    pitch_estimator: String,
    index_rate: f32,
    chunk_frames: usize,
    extra_frames: usize,
    embedder: String,
) -> Result<(), String> {
    let cmd = SetVoiceControlCommand {
        cmd: "SET_VOICE_CONTROL".to_string(),
        pitch_estimator,
        index_rate,
        chunk_frames,
        extra_frames,
        embedder,
    };
    let json_str = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
    send_zmq_command(json_str).await
}

#[tauri::command]
fn get_voice_models() -> Vec<String> {
    let mut models = Vec::new();
    let path = std::path::Path::new("c:/development/soundboard/models");
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.is_file() && path.extension().unwrap_or_default() == "onnx" {
                    if let Some(file_name) = path.file_name() {
                        models.push(file_name.to_string_lossy().into_owned());
                    }
                }
            }
        }
    }
    models
}

#[tauri::command]
fn get_appdata_dir() -> String {
    let mut path = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("C:/"));
    path.push("soundboard");
    path.to_string_lossy().into_owned()
}

#[tauri::command]
fn save_config(config: String) -> Result<(), String> {
    let mut path = dirs::data_dir().ok_or("No AppData dir")?;
    path.push("soundboard");
    if !path.exists() {
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }
    path.push("config.json");
    std::fs::write(&path, config).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_config() -> Result<String, String> {
    let mut path = dirs::data_dir().ok_or("No AppData dir")?;
    path.push("soundboard");
    path.push("config.json");
    if !path.exists() {
        return Ok("{}".to_string());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn import_voice_model(source_path: String) -> Result<String, String> {
    let source = std::path::Path::new(&source_path);
    if !source.exists() || !source.is_file() {
        return Err("Invalid file".into());
    }
    
    let file_name = source.file_name()
        .ok_or("No filename")?
        .to_string_lossy()
        .into_owned();
        
    let mut dest_dir = dirs::data_dir().ok_or("No AppData dir")?;
    dest_dir.push("soundboard");
    dest_dir.push("models");
    
    if !dest_dir.exists() {
        std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    }
    
    let dest_path = dest_dir.join(&file_name);
    std::fs::copy(source, &dest_path).map_err(|e| e.to_string())?;
    
    Ok(file_name)
}

#[tauri::command]
fn save_voice_model(file_name: String, data: Vec<u8>) -> Result<String, String> {
    let mut dest_dir = dirs::data_dir().ok_or("No AppData dir")?;
    dest_dir.push("soundboard");
    dest_dir.push("models");
    
    if !dest_dir.exists() {
        std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    }
    
    let dest_path = dest_dir.join(&file_name);
    std::fs::write(&dest_path, data).map_err(|e| e.to_string())?;
    
    Ok(file_name)
}

#[tauri::command]
fn import_sound_file(source_path: String) -> Result<String, String> {
    let source = std::path::Path::new(&source_path);
    if !source.exists() || !source.is_file() {
        return Err("Invalid file".into());
    }
    
    let file_name = source.file_name()
        .ok_or("No filename")?
        .to_string_lossy()
        .into_owned();
        
    let mut dest_dir = dirs::data_dir().ok_or("No AppData dir")?;
    dest_dir.push("soundboard");
    dest_dir.push("sounds");
    
    if !dest_dir.exists() {
        std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    }
    
    let unique_name = format!("{}_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis(), file_name);
    let dest_path = dest_dir.join(&unique_name);
    
    std::fs::copy(source, &dest_path).map_err(|e| e.to_string())?;
    
    Ok(dest_path.to_string_lossy().into_owned().replace("\\", "/"))
}

#[tauri::command]
async fn trim_sound_file(path: String, start_time: f32, end_time: f32) -> Result<String, String> {
    let source = std::path::Path::new(&path);
    if !source.exists() || !source.is_file() {
        return Err("Invalid source file path".into());
    }
    
    let mut dest_dir = dirs::data_dir().ok_or("No AppData dir")?;
    dest_dir.push("soundboard");
    dest_dir.push("sounds");
    
    if !dest_dir.exists() {
        std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    }
    
    let name_without_ext = source.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "sound".to_string());
    
    let unique_name = format!(
        "trimmed_{}_{}.wav",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis(),
        name_without_ext
    );
    let dest_path = dest_dir.join(&unique_name);
    let dest_path_str = dest_path.to_string_lossy().into_owned().replace("\\", "/");
    let source_path_str = path.replace("\\", "/");
    
    let cmd = serde_json::json!({
        "cmd": "TRIM_AUDIO",
        "sourcePath": source_path_str,
        "destPath": dest_path_str,
        "startTime": start_time,
        "endTime": end_time
    });
    
    let json_str = cmd.to_string();
    let reply = send_zmq_command_with_reply(json_str).await?;
    if reply != "OK" {
        return Err(format!("C++ engine failed to trim file: {}", reply));
    }
    
    Ok(dest_path_str)
}


#[tauri::command]
fn install_audio_cable(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let resource_path = app_handle
        .path()
        .resolve("vbcable/VBCABLE_Setup_x64.exe", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;

    // Use powershell to trigger UAC elevation
    let path_str = resource_path.to_string_lossy().to_string();
    std::process::Command::new("powershell")
        .args(&["-Command", &format!("Start-Process -FilePath '{}' -Verb RunAs", path_str)])
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
#[allow(deprecated)]
fn check_audio_cable() -> bool {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    if let Ok(devices) = host.output_devices() {
        for device in devices {
            if let Ok(name) = device.name() {
                let name_lower = name.to_lowercase();
                if name_lower.contains("cable") || name_lower.contains("virtual") {
                    return true;
                }
            }
        }
    }
    false
}

#[derive(Serialize, Deserialize, Debug)]
struct SetInputDeviceCommand {
    cmd: String,
    device_name: String,
}

#[tauri::command]
async fn set_input_device(device_name: String) -> Result<(), String> {
    let cmd = SetInputDeviceCommand {
        cmd: "SET_INPUT_DEVICE".to_string(),
        device_name,
    };
    
    let json_str = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
    send_zmq_command(json_str).await
}

#[tauri::command]
#[allow(deprecated)]
async fn get_input_devices() -> Vec<String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    
    // 1. Try to get devices from the C++ audio engine via ZMQ IPC (with 1-second timeout)
    let zmq_res = tokio::time::timeout(
        std::time::Duration::from_millis(1000),
        send_zmq_command_with_reply(r#"{"cmd":"GET_INPUT_DEVICES"}"#.to_string())
    ).await;
    
    if let Ok(Ok(reply_str)) = zmq_res {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&reply_str) {
            if let Some(devices_arr) = parsed.get("devices").and_then(|v| v.as_array()) {
                let devices: Vec<String> = devices_arr
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect();
                if !devices.is_empty() {
                    return devices;
                }
            }
        }
    }
    
    // 2. Fallback to cpal local detection if ZMQ failed or returned empty
    let mut names = Vec::new();
    let host = cpal::default_host();
    if let Ok(devices) = host.input_devices() {
        for device in devices {
            if let Ok(name) = device.name() {
                names.push(name);
            }
        }
    }
    // Deduplicate preserving order
    let mut unique_names = Vec::new();
    for name in names {
        if !unique_names.contains(&name) {
            unique_names.push(name);
        }
    }
    unique_names
}
#[tauri::command]
async fn extract_youtube_stream_url(url: String) -> Result<String, String> {
    // Run yt-dlp -g -f "best" <url>
    let output = std::process::Command::new("yt-dlp")
        .args(&["-g", "-f", "best", &url])
        .output()
        .map_err(|e| format!("Failed to execute yt-dlp: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp failed: {}", err));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let urls: Vec<&str> = stdout.trim().lines().collect();
    if urls.is_empty() {
        return Err("No URL returned by yt-dlp".to_string());
    }

    Ok(urls[0].to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            play_sound,
            toggle_voice,
            toggle_hear_myself,
            toggle_satanic_1,
            toggle_satanic_2,
            install_audio_cable,
            get_voice_models,
            import_voice_model,
            save_voice_model,
            import_sound_file,
            set_voice_model,
            get_input_devices,
            set_input_device,
            set_voice_pitch,
            check_audio_cable,
            get_appdata_dir,
            save_config,
            load_config,
            set_voice_control,
            extract_youtube_stream_url,
            trim_sound_file
        ])
        .setup(|app| {
            let core_path = "c:/development/soundboard/build-cpp/Release/SoundboardCore.exe";
            let child = Command::new(core_path)
                .stdin(Stdio::piped())
                .spawn();
            
            match child {
                Ok(c) => {
                    println!("C++ Engine started successfully.");
                    app.manage(EngineState(Mutex::new(Some(c))));
                }
                Err(e) => {
                    println!("Failed to start C++ engine: {}", e);
                    app.manage(EngineState(Mutex::new(None)));
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // When main window closes, kill engine
                if let Ok(mut lock) = window.state::<EngineState>().0.lock() {
                    if let Some(mut child) = lock.take() {
                        println!("Killing C++ engine...");
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
