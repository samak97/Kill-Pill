use tauri::{AppHandle, Emitter};
use serde::Serialize;
use rusqlite::{Connection, OpenFlags};
use std::path::PathBuf;
use std::time::Duration;
use std::fs;

#[derive(Clone, Serialize, Default, Debug)]
pub struct NotificationPayload {
    pub id: u32,
    pub app_name: String,
    pub title: String,
    pub body: String,
}

pub fn start_notification_listener(app: AppHandle) {
    std::thread::spawn(move || {
        poll_notification_db(app);
    });
}

fn get_db_path() -> Option<PathBuf> {
    let localappdata = std::env::var("LOCALAPPDATA").ok()?;
    let path = PathBuf::from(localappdata)
        .join("Microsoft")
        .join("Windows")
        .join("Notifications")
        .join("wpndatabase.db");
    if path.exists() { Some(path) } else { None }
}

/// Copy all three WAL-mode SQLite files so we see the latest committed data.
fn copy_db(source: &PathBuf) -> Option<PathBuf> {
    let tmp_dir = std::env::temp_dir().join("ghost_shell_notif");
    let _ = fs::create_dir_all(&tmp_dir);

    let dest = tmp_dir.join("wpndatabase.db");
    fs::copy(source, &dest).ok()?;

    for ext in &["-wal", "-shm"] {
        let src_extra = source.with_file_name(format!("wpndatabase.db{}", ext));
        let dst_extra = dest.with_file_name(format!("wpndatabase.db{}", ext));
        if src_extra.exists() {
            let _ = fs::copy(&src_extra, &dst_extra);
        }
    }

    Some(dest)
}

fn extract_app_name(primary_id: &str) -> String {
    if primary_id.is_empty() {
        return "Notification".to_string();
    }
    let base = primary_id
        .split('_').next().unwrap_or(primary_id)
        .split('!').next().unwrap_or(primary_id)
        .split('.').last().unwrap_or(primary_id)
        .trim_end_matches(".exe");

    let mut name = String::new();
    for (i, ch) in base.chars().enumerate() {
        if i > 0 && ch.is_uppercase() && !name.ends_with(' ') {
            name.push(' ');
        }
        name.push(ch);
    }
    if name.is_empty() { "Notification".to_string() } else { name }
}

fn extract_texts_from_xml(xml: &str) -> Vec<String> {
    let mut texts = Vec::new();
    let mut haystack = xml;
    while let Some(open) = haystack.find("<text") {
        let rest = &haystack[open..];
        if let Some(tag_end) = rest.find('>') {
            let content = &rest[tag_end + 1..];
            if let Some(close) = content.find("</text>") {
                let t = content[..close].trim().to_string();
                if !t.is_empty() {
                    texts.push(t);
                }
                haystack = &content[close..];
            } else {
                break;
            }
        } else {
            break;
        }
    }
    texts
}

fn poll_notification_db(app: AppHandle) {
    let db_path = match get_db_path() {
        Some(p) => p,
        None => {
            eprintln!("[GhostShell] wpndatabase.db not found – notifications disabled.");
            return;
        }
    };

    let mut last_seen_id: i64 = 0;

    // Seed with current max ID so we skip old notifications on startup
    if let Some(tmp) = copy_db(&db_path) {
        if let Ok(conn) = Connection::open_with_flags(&tmp, OpenFlags::SQLITE_OPEN_READ_ONLY) {
            if let Ok(max) = conn.query_row(
                "SELECT COALESCE(MAX(Id), 0) FROM Notification",
                [],
                |row| row.get::<_, i64>(0),
            ) {
                last_seen_id = max;
                println!("[GhostShell] Notification listener ready. Seeded at ID: {}", last_seen_id);
            }
        }
    }

    loop {
        std::thread::sleep(Duration::from_millis(750));

        let tmp = match copy_db(&db_path) {
            Some(p) => p,
            None => continue,
        };

        let conn = match Connection::open_with_flags(&tmp, OpenFlags::SQLITE_OPEN_READ_ONLY) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[GhostShell] DB open error: {}", e);
                continue;
            }
        };

        // Query new toasts — Payload is a BLOB so read as Vec<u8>
        let mut stmt = match conn.prepare(
            "SELECT n.Id, n.Type, n.Payload, nh.PrimaryId
             FROM Notification n
             LEFT JOIN NotificationHandler nh ON n.HandlerId = nh.RecordId
             WHERE n.Id > ?1
             ORDER BY n.Id ASC"
        ) {
            Ok(s) => s,
            Err(e) => { eprintln!("[GhostShell] DB prepare error: {}", e); continue; }
        };

        let rows: Vec<_> = match stmt.query_map([last_seen_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,           // Id (INTEGER)
                row.get::<_, Option<String>>(1)?, // Type (TEXT)
                row.get::<_, Option<Vec<u8>>>(2)?, // Payload (BLOB!)
                row.get::<_, Option<String>>(3)?, // PrimaryId (TEXT)
            ))
        }) {
            Ok(r) => r.filter_map(|x| x.ok()).collect(),
            Err(e) => { eprintln!("[GhostShell] DB query error: {}", e); continue; }
        };

        for (id, notif_type, payload_blob, primary_id) in rows {
            last_seen_id = id;

            // Only process toast notifications (skip tile, badge, etc.)
            let ntype = notif_type.unwrap_or_default();
            if ntype != "toast" {
                continue;
            }

            // Convert BLOB payload to UTF-8 string
            let xml = match payload_blob {
                Some(bytes) => String::from_utf8_lossy(&bytes).to_string(),
                None => continue,
            };

            let app_name = extract_app_name(&primary_id.unwrap_or_default());
            let texts = extract_texts_from_xml(&xml);

            if texts.is_empty() { continue; }

            let title = texts.get(0).cloned().unwrap_or_default();
            let body = texts.get(1).cloned().unwrap_or_default();

            let notif = NotificationPayload {
                id: id as u32,
                app_name: app_name.clone(),
                title: title.clone(),
                body: body.clone(),
            };

            println!("[GhostShell] 🔔 {} → {} – {}", app_name, title, body);
            let _ = app.emit("notification_received", notif);
        }
    }
}
