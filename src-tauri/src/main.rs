// Предотвращает появление дополнительного окна консоли на Windows в релизе, НЕ УДАЛЯТЬ!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    neuroscreencaster_lib::run();
}
