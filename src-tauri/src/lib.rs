mod commands;
mod db;
mod delta_codec;
mod error;
mod feed;
mod models;
mod opml;
mod readability;
mod updates;

use tauri::Manager;

use crate::commands::AppState;
use crate::db::Database;
use crate::feed::build_http_client;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    updates::cleanup_pending_old_binary();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
            let db_path = data_dir.join("mreader.db");
            let db = Database::open(&db_path)?;
            let client = build_http_client()?;
            app.manage(AppState { db, client });
            #[cfg(not(mobile))]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_feeds,
            commands::add_feed,
            commands::add_starter_feeds,
            commands::delete_feed,
            commands::refresh_feed,
            commands::refresh_all_feeds,
            commands::list_articles,
            commands::get_article,
            commands::fetch_full_article,
            commands::set_article_read,
            commands::set_article_saved,
            commands::mark_all_read,
            commands::import_opml,
            commands::export_opml,
            commands::get_settings,
            commands::save_settings,
            updates::get_app_version,
            updates::check_for_update,
            updates::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running mReader");
}
