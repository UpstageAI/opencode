// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// borrowed from https://github.com/skyline69/balatro-mod-manager
#[cfg(target_os = "linux")]
fn configure_display_backend() -> Option<String> {
    use std::env;

    let set_env_if_absent = |key: &str, value: &str| {
        if env::var_os(key).is_none() {
            // Safety: called during startup before any threads are spawned, so mutating the
            // process environment is safe.
            unsafe { env::set_var(key, value) };
        }
    };

    let on_wayland = env::var_os("WAYLAND_DISPLAY").is_some()
        || matches!(
            env::var("XDG_SESSION_TYPE"),
            Ok(v) if v.eq_ignore_ascii_case("wayland")
        );
    if !on_wayland {
        return None;
    }

    // Allow users to explicitly keep Wayland if they know their setup is stable.
    let allow_wayland = matches!(
        env::var("OC_ALLOW_WAYLAND"),
        Ok(v) if matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes")
    );
    if allow_wayland {
        return Some("Wayland session detected; respecting OC_ALLOW_WAYLAND=1".into());
    }

    // Prefer XWayland when available to avoid Wayland protocol errors seen during startup.
    if env::var_os("DISPLAY").is_some() {
        set_env_if_absent("WINIT_UNIX_BACKEND", "x11");
        set_env_if_absent("GDK_BACKEND", "x11");
        set_env_if_absent("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        return Some(
            "Wayland session detected; forcing X11 backend to avoid compositor protocol errors. \
               Set OC_ALLOW_WAYLAND=1 to keep native Wayland."
                .into(),
        );
    }

    set_env_if_absent("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    Some(
        "Wayland session detected without X11; leaving Wayland enabled (set WINIT_UNIX_BACKEND/GDK_BACKEND manually if needed)."
            .into(),
    )
}

#[cfg(unix)]
fn askpass_stream(socket: &str) -> Result<Box<dyn std::io::Read + std::io::Write>, String> {
    if let Some(addr) = socket.strip_prefix("tcp:") {
        let stream = std::net::TcpStream::connect(addr)
            .map_err(|e| format!("askpass connect failed: {e}"))?;
        let boxed: Box<dyn std::io::Read + std::io::Write> = Box::new(stream);
        return Ok(boxed);
    }

    use std::os::unix::net::UnixStream;
    let stream = UnixStream::connect(socket).map_err(|e| format!("askpass connect failed: {e}"))?;
    let boxed: Box<dyn std::io::Read + std::io::Write> = Box::new(stream);
    Ok(boxed)
}

#[cfg(not(unix))]
fn askpass_stream(socket: &str) -> Result<Box<dyn std::io::Read + std::io::Write>, String> {
    let addr = socket
        .strip_prefix("tcp:")
        .ok_or_else(|| "askpass socket is not tcp on this platform".to_string())?;
    let stream =
        std::net::TcpStream::connect(addr).map_err(|e| format!("askpass connect failed: {e}"))?;
    let boxed: Box<dyn std::io::Read + std::io::Write> = Box::new(stream);
    Ok(boxed)
}

fn main() {
    if let Ok(socket) = std::env::var("OPENCODE_SSH_ASKPASS_SOCKET") {
        use std::io::{Read as _, Write as _};
        use std::process::exit;

        let args = std::env::args().collect::<Vec<_>>();
        let prompt = if let Some(pos) = args.iter().position(|a| a == "--ssh-askpass") {
            args.iter()
                .skip(pos + 2)
                .cloned()
                .collect::<Vec<_>>()
                .join(" ")
        } else {
            args.iter().skip(1).cloned().collect::<Vec<_>>().join(" ")
        };

        let mut stream = match askpass_stream(&socket) {
            Ok(v) => v,
            Err(err) => {
                eprintln!("{err}");
                exit(1);
            }
        };

        let bytes = prompt.as_bytes();
        let len = u32::try_from(bytes.len()).unwrap_or(0);
        if stream.write_all(&len.to_be_bytes()).is_err() || stream.write_all(bytes).is_err() {
            eprintln!("askpass write failed");
            exit(1);
        }

        let mut len_buf = [0u8; 4];
        if stream.read_exact(&mut len_buf).is_err() {
            eprintln!("askpass read failed");
            exit(1);
        }
        let reply_len = u32::from_be_bytes(len_buf) as usize;
        let mut reply = vec![0u8; reply_len];
        if stream.read_exact(&mut reply).is_err() {
            eprintln!("askpass read failed");
            exit(1);
        }

        let _ = std::io::stdout().write_all(&reply);
        let _ = std::io::stdout().write_all(b"\n");
        return;
    }

    // Ensure loopback connections are never sent through proxy settings.
    // Some VPNs/proxies set HTTP_PROXY/HTTPS_PROXY/ALL_PROXY without excluding localhost.
    const LOOPBACK: [&str; 3] = ["127.0.0.1", "localhost", "::1"];

    let upsert = |key: &str| {
        let mut items = std::env::var(key)
            .unwrap_or_default()
            .split(',')
            .map(|v| v.trim())
            .filter(|v| !v.is_empty())
            .map(|v| v.to_string())
            .collect::<Vec<_>>();

        for host in LOOPBACK {
            if items.iter().any(|v| v.eq_ignore_ascii_case(host)) {
                continue;
            }
            items.push(host.to_string());
        }

        // Safety: called during startup before any threads are spawned.
        unsafe { std::env::set_var(key, items.join(",")) };
    };

    upsert("NO_PROXY");
    upsert("no_proxy");

    #[cfg(target_os = "linux")]
    {
        if let Some(backend_note) = configure_display_backend() {
            eprintln!("{backend_note:?}");
        }
    }

    opencode_lib::run()
}
