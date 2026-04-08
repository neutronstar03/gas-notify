use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};

const TOGGLE_MENU_ID: &str = "toggle-widget";
const PAUSE_MENU_ID: &str = "pause-monitor";
const RESUME_MENU_ID: &str = "resume-monitor";
const QUIT_MENU_ID: &str = "quit-app";

fn toggle_widget<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible()? {
            window.hide()?;
        } else {
            window.show()?;
            window.set_focus()?;
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let toggle_item =
                MenuItemBuilder::with_id(TOGGLE_MENU_ID, "Show / Hide widget").build(app)?;
            let pause_item =
                MenuItemBuilder::with_id(PAUSE_MENU_ID, "Pause monitoring").build(app)?;
            let resume_item =
                MenuItemBuilder::with_id(RESUME_MENU_ID, "Resume monitoring").build(app)?;
            let quit_item = MenuItemBuilder::with_id(QUIT_MENU_ID, "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&toggle_item, &pause_item, &resume_item, &quit_item])
                .build()?;

            let icon = app
                .default_window_icon()
                .cloned()
                .expect("default icon should be available");

            TrayIconBuilder::with_id("gas-notify-tray")
                .icon(icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let _ = toggle_widget(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            TOGGLE_MENU_ID => {
                let _ = toggle_widget(app);
            }
            PAUSE_MENU_ID => {
                let _ = app.emit("monitor-control", "pause");
            }
            RESUME_MENU_ID => {
                let _ = app.emit("monitor-control", "resume");
            }
            QUIT_MENU_ID => {
                app.exit(0);
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
