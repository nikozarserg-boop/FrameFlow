pub mod camera_engine;
pub mod cursor_smoothing;

// Переэкспортируем новые типы для удобства
pub use cursor_smoothing::{CursorPoint, MotionPattern, analyze_pre_click_pattern};
