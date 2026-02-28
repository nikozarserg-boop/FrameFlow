//! Состояние активной записи экрана.

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::models::events::InputEvent;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum AutoZoomTriggerMode {
    #[default]
    SingleClick,
    MultiClickWindow,
    CtrlClick,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum RecordingAudioMode {
    #[default]
    NoAudio,
    SystemOnly,
    MicrophoneOnly,
    MicrophoneAndSystem,
}

pub enum AudioCaptureBackend {
    FfmpegChild(std::process::Child),
    NativeLoopback {
        stop_flag: Arc<AtomicBool>,
        join_handle: std::thread::JoinHandle<Result<(), String>>,
    },
}

pub struct AudioCaptureProcess {
    pub backend: AudioCaptureBackend,
    pub output_path: PathBuf,
}

pub struct AudioCaptureSession {
    pub system_capture: Option<AudioCaptureProcess>,
    pub microphone_capture: Option<AudioCaptureProcess>,
}

/// Данные для одной активной сессии записи.
pub struct ActiveRecording {
    pub recording_id: String,
    /// Общий сигнал остановки используемый callback-ом захвата.
    pub stop_flag: Arc<AtomicBool>,
    /// Общий сигнал паузы используемый путём кодировщика/мультиплексера.
    pub pause_flag: Arc<AtomicBool>,
    /// Поток захвата WGC; выходит когда флаг остановки зафиксирован.
    pub capture_thread: std::thread::JoinHandle<Result<(), String>>,
    /// Папка проекта: `{Videos}/FrameFlow/{recording_id}/`
    pub output_dir: PathBuf,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    /// Unix временная метка в мс когда запись началась.
    pub start_ms: u64,
    /// Активная временная метка начала паузы (абсолютная Unix мс); `None` когда не на паузе.
    pub pause_started_at_ms: Option<u64>,
    /// Закрытые диапазоны пауз (абсолютная Unix мс).
    pub pause_ranges_ms: Vec<(u64, u64)>,
    /// Режим активации автозума выбранный до начала записи.
    pub auto_zoom_trigger_mode: AutoZoomTriggerMode,
    /// Режим захвата аудио выбранный до начала записи.
    pub audio_mode: RecordingAudioMode,
    /// Имя выбранного устройства ввода микрофона (если требуется режимом).
    pub microphone_device: Option<String>,
    /// Опциональная сессия захвата живого аудио.
    pub audio_capture_session: Option<AudioCaptureSession>,
    /// Поток телеметрии процессор (возвращает все собранные события при присоединении).
    pub telemetry_processor: std::thread::JoinHandle<Vec<InputEvent>>,
}

/// Управляемое Tauri состояние рекордера.
pub struct RecorderState(pub Arc<Mutex<Option<ActiveRecording>>>);

impl RecorderState {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(None)))
    }
}
