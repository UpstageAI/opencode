use std::{
    collections::HashMap,
    net::TcpListener,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter as _, Manager};
use tokio::{
    io::{AsyncBufReadExt as _, AsyncReadExt as _, AsyncWriteExt as _, BufReader},
    process::{Child, Command},
    sync::{Mutex, oneshot},
};

#[cfg(unix)]
use tokio::net::UnixListener;

#[cfg(not(unix))]
use tokio::net::TcpListener;

use crate::server;

fn log(line: impl AsRef<str>) {
    eprintln!("[SSH] {}", line.as_ref());
}

#[derive(Clone, serde::Serialize, specta::Type, Debug)]
pub struct SshConnectData {
    pub key: String,
    pub url: String,
    pub password: String,
    pub destination: String,
}

#[derive(Clone, serde::Serialize, specta::Type, Debug)]
pub struct SshPrompt {
    pub id: String,
    pub prompt: String,
}

#[derive(Default)]
pub struct SshState {
    session: Mutex<Option<SshSession>>,
    prompts: Mutex<HashMap<String, oneshot::Sender<String>>>,
}

struct SshSession {
    key: String,
    destination: String,
    dir: PathBuf,
    askpass_task: tokio::task::JoinHandle<()>,
    socket_path: Option<PathBuf>,
    master: Option<Child>,
    forward: Child,
    server: Child,
}

#[derive(Debug, Clone)]
struct Spec {
    destination: String,
    args: Vec<String>,
}

#[derive(Clone, Debug)]
struct Askpass {
    socket: String,
    exe: PathBuf,
}

#[derive(Clone, Copy, Debug)]
enum ControlMode {
    Master,
    Client,
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("Failed to bind to find free port")
        .local_addr()
        .expect("Failed to get local address")
        .port()
}

fn parse_ssh_command(input: &str) -> Result<Spec, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("SSH command is empty".to_string());
    }

    let without_prefix = trimmed.strip_prefix("ssh ").unwrap_or(trimmed);
    let tokens =
        shell_words::split(without_prefix).map_err(|e| format!("Invalid SSH command: {e}"))?;
    if tokens.is_empty() {
        return Err("SSH command is empty".to_string());
    }

    const ALLOWED_OPTS: &[&str] = &[
        "-4", "-6", "-A", "-a", "-C", "-K", "-k", "-X", "-x", "-Y", "-y",
    ];
    const ALLOWED_ARGS: &[&str] = &[
        "-B", "-b", "-c", "-D", "-F", "-I", "-i", "-J", "-l", "-m", "-o", "-P", "-p", "-w",
    ];

    // Disallowed: -E, -e, -f, -G, -g, -M, -N, -n, -O, -q, -S, -s, -T, -t, -V, -v, -W, -L, -R
    let mut args = Vec::<String>::new();
    let mut i = 0;
    let mut destination: Option<String> = None;

    while i < tokens.len() {
        let tok = &tokens[i];

        if destination.is_some() {
            return Err(
                "SSH command cannot include a remote command; only destination + options are supported"
                    .to_string(),
            );
        }

        if ALLOWED_OPTS.contains(&tok.as_str()) {
            args.push(tok.clone());
            i += 1;
            continue;
        }

        if tok == "-L" || tok.starts_with("-L") || tok == "-R" || tok.starts_with("-R") {
            return Err("SSH port forwarding flags (-L/-R) are not supported yet".to_string());
        }

        if tok.starts_with('-') {
            let mut matched = false;
            for opt in ALLOWED_ARGS {
                if tok == opt {
                    matched = true;
                    args.push(tok.clone());
                    i += 1;
                    if i < tokens.len() {
                        args.push(tokens[i].clone());
                        i += 1;
                    }
                    break;
                }
                if tok.starts_with(opt) {
                    matched = true;
                    args.push(tok.clone());
                    i += 1;
                    break;
                }
            }
            if matched {
                continue;
            }
            return Err(format!("Unsupported ssh argument: {tok}"));
        }

        destination = Some(tok.clone());
        i += 1;
    }

    let Some(destination) = destination else {
        return Err("Missing ssh destination (e.g. user@host)".to_string());
    };

    Ok(Spec { destination, args })
}

fn sh_quote(input: &str) -> String {
    let escaped = input.replace('\'', "'\\'''");
    format!("'{}'", escaped)
}

fn exe_path(app: &AppHandle) -> Result<PathBuf, String> {
    tauri::process::current_binary(&app.env())
        .map_err(|e| format!("Failed to locate current binary: {e}"))
}

async fn ensure_ssh_available() -> Result<(), String> {
    let res = Command::new("ssh")
        .arg("-V")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await;

    if res.is_err() {
        if cfg!(windows) {
            return Err(
                "ssh.exe was not found on PATH. Install Windows OpenSSH or Git for Windows and ensure ssh.exe is on PATH."
                    .to_string(),
            );
        }
        return Err("ssh was not found on PATH".to_string());
    }

    Ok(())
}

fn ssh_command(askpass: &Askpass, args: Vec<String>) -> Command {
    let mut cmd = Command::new("ssh");
    cmd.args(args);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    cmd.env("SSH_ASKPASS_REQUIRE", "force");
    cmd.env("SSH_ASKPASS", &askpass.exe);
    cmd.env("OPENCODE_SSH_ASKPASS_SOCKET", &askpass.socket);

    if std::env::var_os("DISPLAY").is_none() {
        cmd.env("DISPLAY", "1");
    }

    // keep behavior consistent even if ssh wants a tty.
    cmd.env("TERM", "dumb");
    cmd
}

fn ssh_spawn_bg(askpass: &Askpass, args: Vec<String>) -> Command {
    let mut cmd = Command::new("ssh");
    cmd.args(args);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::piped());

    cmd.env("SSH_ASKPASS_REQUIRE", "force");
    cmd.env("SSH_ASKPASS", &askpass.exe);
    cmd.env("OPENCODE_SSH_ASKPASS_SOCKET", &askpass.socket);

    if std::env::var_os("DISPLAY").is_none() {
        cmd.env("DISPLAY", "1");
    }

    cmd.env("TERM", "dumb");
    cmd
}

async fn ssh_output(askpass: &Askpass, args: Vec<String>) -> Result<String, String> {
    let out = ssh_command(askpass, args)
        .output()
        .await
        .map_err(|e| format!("Failed to run ssh: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let msg = stderr.trim();
        if msg.is_empty() {
            return Err("SSH command failed".to_string());
        }
        return Err(msg.to_string());
    }

    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn control_supported() -> bool {
    cfg!(unix)
}

fn control_args(socket_path: Option<&Path>, mode: ControlMode) -> Vec<String> {
    if !control_supported() {
        return Vec::new();
    }

    let Some(socket_path) = socket_path else {
        return Vec::new();
    };

    let mut args = Vec::new();
    match mode {
        ControlMode::Master => {
            args.push("-o".into());
            args.push("ControlMaster=yes".into());
            args.push("-o".into());
            args.push("ControlPersist=no".into());
        }
        ControlMode::Client => {
            args.push("-o".into());
            args.push("ControlMaster=no".into());
        }
    }

    args.push("-o".into());
    args.push(format!("ControlPath={}", socket_path.display()));
    args
}

async fn wait_master_ready(askpass: &Askpass, spec: &Spec, socket_path: &Path) -> Result<(), String> {
    let start = Instant::now();
    loop {
        if start.elapsed() > Duration::from_secs(30) {
            return Err("Timed out waiting for SSH connection".to_string());
        }

        let res = ssh_command(
            askpass,
            [
                control_args(Some(socket_path), ControlMode::Client),
                vec!["-O".into(), "check".into(), spec.destination.clone()],
            ]
            .concat(),
        )
        .output()
        .await;

        if let Ok(out) = res {
            if out.status.success() {
                return Ok(());
            }
        }

        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn ensure_remote_opencode(
    app: &AppHandle,
    askpass: &Askpass,
    spec: &Spec,
    socket_path: Option<&Path>,
) -> Result<(), String> {
    let version = app.package_info().version.to_string();

    let installed = ssh_output(
        askpass,
        [
            spec.args.clone(),
            control_args(socket_path, ControlMode::Client),
            vec![
                spec.destination.clone(),
                "cd; ~/.opencode/bin/opencode --version".into(),
            ],
        ]
        .concat(),
    )
    .await
    .ok()
    .map(|v| v.trim().to_string());

    match installed.as_deref() {
        Some(version) => log(format!("Remote opencode detected: {version}")),
        None => log("Remote opencode not found"),
    }

    if installed.as_deref() == Some(version.as_str()) {
        return Ok(());
    }

    log("Starting remote install");
    let cmd = format!(
        "cd; bash -lc {}",
        sh_quote(&format!(
            "curl -fsSL https://opencode.ai/install | bash -s -- --version {version} --no-modify-path"
        ))
    );

    ssh_output(
        askpass,
        [
            spec.args.clone(),
            control_args(socket_path, ControlMode::Client),
            vec![spec.destination.clone(), cmd],
        ]
        .concat(),
    )
    .await
    .map(|_| ())?;

    log("Remote install finished");

    Ok(())
}

async fn spawn_master(
    askpass: &Askpass,
    spec: &Spec,
    socket_path: &Path,
) -> Result<Child, String> {
    let mut child = ssh_spawn_bg(
        askpass,
        [
            spec.args.clone(),
            vec!["-N".into()],
            control_args(Some(socket_path), ControlMode::Master),
            vec![spec.destination.clone()],
        ]
        .concat(),
    )
    .spawn()
    .map_err(|e| format!("Failed to start ssh: {e}"))?;

    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut err = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = err.next_line().await {
                if !line.trim().is_empty() {
                    log(format!("[master] {line}"));
                }
            }
        });
    }

    Ok(child)
}

fn parse_listening_port(line: &str) -> Option<u16> {
    let needle = "opencode server listening on http://";
    let rest = line.trim();
    let rest = rest.strip_prefix(needle)?;
    let hostport = rest.split_whitespace().next().unwrap_or(rest);
    let port = hostport.rsplit(':').next()?;
    port.trim().parse().ok()
}

async fn spawn_remote_server(
    askpass: &Askpass,
    spec: &Spec,
    socket_path: Option<&Path>,
    password: &str,
) -> Result<(Child, u16), String> {
    let cmd = format!(
        "cd; env OPENCODE_SERVER_USERNAME=opencode OPENCODE_SERVER_PASSWORD={password} OPENCODE_CLIENT=desktop ~/.opencode/bin/opencode serve --hostname 127.0.0.1 --port 0"
    );

    let mut child = ssh_command(
        askpass,
        [
            spec.args.clone(),
            control_args(socket_path, ControlMode::Client),
            vec![spec.destination.clone(), cmd],
        ]
        .concat(),
    )
    .spawn()
    .map_err(|e| format!("Failed to start remote server: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture remote server stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture remote server stderr".to_string())?;

    let (tx, mut rx) = tokio::sync::mpsc::channel::<u16>(1);
    tokio::spawn(async move {
        let mut out = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = out.next_line().await {
            if !line.trim().is_empty() {
                log(format!("[server] {line}"));
            }
            if let Some(port) = parse_listening_port(&line) {
                let _ = tx.try_send(port);
            }
        }
    });
    tokio::spawn(async move {
        let mut err = BufReader::new(stderr).lines();
        while let Ok(Some(_line)) = err.next_line().await {
            if !_line.trim().is_empty() {
                log(format!("[server] {_line}"));
            }
        }
    });

    let port = tokio::time::timeout(Duration::from_secs(30), rx.recv())
        .await
        .map_err(|_| "Timed out waiting for remote server to start".to_string())?
        .ok_or_else(|| "Remote server exited before becoming ready".to_string())?;

    Ok((child, port))
}

async fn spawn_forward(
    _app: &AppHandle,
    askpass: &Askpass,
    spec: &Spec,
    socket_path: Option<&Path>,
    local_port: u16,
    remote_port: u16,
) -> Result<Child, String> {
    let forward = format!("127.0.0.1:{local_port}:127.0.0.1:{remote_port}");
    let mut child = ssh_spawn_bg(
        askpass,
        [
            spec.args.clone(),
            vec![
                "-N".into(),
                "-L".into(),
                forward,
                "-o".into(),
                "ExitOnForwardFailure=yes".into(),
            ],
            control_args(socket_path, ControlMode::Client),
            vec![spec.destination.clone()],
        ]
        .concat(),
    )
    .spawn()
    .map_err(|e| format!("Failed to start port forward: {e}"))?;

    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut err = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = err.next_line().await {
                if !line.trim().is_empty() {
                    log(format!("[forward] {line}"));
                }
            }
        });
    }

    Ok(child)
}

async fn disconnect_session(mut session: SshSession) {
    let _ = session.forward.kill().await;
    let _ = session.server.kill().await;
    if let Some(mut master) = session.master {
        let _ = master.kill().await;
    }

    session.askpass_task.abort();
    let _ = std::fs::remove_dir_all(session.dir);
}

async fn read_prompt<S: AsyncReadExt + Unpin>(stream: &mut S) -> Result<String, String> {
    let mut len_buf = [0u8; 4];
    stream
        .read_exact(&mut len_buf)
        .await
        .map_err(|e| format!("Failed to read prompt length: {e}"))?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > 64 * 1024 {
        return Err("Askpass prompt too large".to_string());
    }
    let mut buf = vec![0u8; len];
    stream
        .read_exact(&mut buf)
        .await
        .map_err(|e| format!("Failed to read prompt: {e}"))?;
    let prompt = String::from_utf8(buf).map_err(|_| "Askpass prompt was not UTF-8".to_string())?;
    Ok(prompt)
}

async fn write_reply<S: AsyncWriteExt + Unpin>(stream: &mut S, value: &str) -> Result<(), String> {
    let bytes = value.as_bytes();
    let len = u32::try_from(bytes.len()).map_err(|_| "Askpass reply too large".to_string())?;
    stream
        .write_all(&len.to_be_bytes())
        .await
        .map_err(|e| format!("Failed to write reply length: {e}"))?;
    stream
        .write_all(bytes)
        .await
        .map_err(|e| format!("Failed to write reply: {e}"))?;
    Ok(())
}

async fn spawn_askpass_server(
    app: AppHandle,
    dir: &Path,
) -> Result<(tokio::task::JoinHandle<()>, String), String> {
    #[cfg(unix)]
    {
        let socket = dir.join("askpass.sock");
        let listener = UnixListener::bind(&socket)
            .map_err(|e| format!("Failed to bind askpass socket {}: {e}", socket.display()))?;
        let location = socket.to_string_lossy().to_string();

        log(format!("Askpass listening on {}", socket.display()));

        let task = tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    return;
                };

                let app = app.clone();
                tokio::spawn(async move {
                    let prompt = match read_prompt(&mut stream).await {
                        Ok(v) => v,
                        Err(_) => return,
                    };

                    log(format!("Prompt received: {}", prompt.replace('\n', "\\n")));

                    let id = uuid::Uuid::new_v4().to_string();
                    let (tx, rx) = oneshot::channel::<String>();

                    {
                        let state = app.state::<SshState>();
                        state.prompts.lock().await.insert(id.clone(), tx);
                    }

                    match app.emit(
                        "ssh_prompt",
                        SshPrompt {
                            id: id.clone(),
                            prompt,
                        },
                    ) {
                        Ok(()) => log(format!("Prompt emitted: {id}")),
                        Err(e) => log(format!("Prompt emit failed: {id}: {e}")),
                    };

                    let value = tokio::time::timeout(Duration::from_secs(120), rx)
                        .await
                        .ok()
                        .and_then(|r| r.ok())
                        .unwrap_or_default();

                    if value.is_empty() {
                        log(format!("Prompt reply empty/timeout: {id}"));
                    } else {
                        log(format!("Prompt reply received: {id}"));
                    }

                    {
                        let state = app.state::<SshState>();
                        state.prompts.lock().await.remove(&id);
                    }

                    let _ = write_reply(&mut stream, &value).await;
                });
            }
        });

        return Ok((task, location));
    }

    #[cfg(not(unix))]
    {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind askpass listener: {e}"))?;
        let addr = listener
            .local_addr()
            .map_err(|e| format!("Failed to read askpass address: {e}"))?;
        let location = format!("tcp:{addr}");

        log(format!("Askpass listening on {addr}"));

        let task = tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    return;
                };

                let app = app.clone();
                tokio::spawn(async move {
                    let prompt = match read_prompt(&mut stream).await {
                        Ok(v) => v,
                        Err(_) => return,
                    };

                    log(format!("Prompt received: {}", prompt.replace('\n', "\\n")));

                    let id = uuid::Uuid::new_v4().to_string();
                    let (tx, rx) = oneshot::channel::<String>();

                    {
                        let state = app.state::<SshState>();
                        state.prompts.lock().await.insert(id.clone(), tx);
                    }

                    match app.emit(
                        "ssh_prompt",
                        SshPrompt {
                            id: id.clone(),
                            prompt,
                        },
                    ) {
                        Ok(()) => log(format!("Prompt emitted: {id}")),
                        Err(e) => log(format!("Prompt emit failed: {id}: {e}")),
                    };

                    let value = tokio::time::timeout(Duration::from_secs(120), rx)
                        .await
                        .ok()
                        .and_then(|r| r.ok())
                        .unwrap_or_default();

                    if value.is_empty() {
                        log(format!("Prompt reply empty/timeout: {id}"));
                    } else {
                        log(format!("Prompt reply received: {id}"));
                    }

                    {
                        let state = app.state::<SshState>();
                        state.prompts.lock().await.remove(&id);
                    }

                    let _ = write_reply(&mut stream, &value).await;
                });
            }
        });

        return Ok((task, location));
    }
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_prompt_reply(app: AppHandle, id: String, value: String) -> Result<(), String> {
    log(format!(
        "Prompt reply from UI: {id} ({} chars)",
        value.len()
    ));
    let state = app.state::<SshState>();
    let tx = state.prompts.lock().await.remove(&id);
    let Some(tx) = tx else {
        return Ok(());
    };
    let _ = tx.send(value);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_disconnect(app: AppHandle, key: String) -> Result<(), String> {
    let state = app.state::<SshState>();
    let session = {
        let mut lock = state.session.lock().await;
        if lock.as_ref().is_some_and(|s| s.key == key) {
            lock.take()
        } else {
            None
        }
    };

    if let Some(session) = session {
        tokio::spawn(async move {
            disconnect_session(session).await;
        });
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_connect(app: AppHandle, command: String) -> Result<SshConnectData, String> {
    async {
        ensure_ssh_available().await?;
        let spec = parse_ssh_command(&command)?;

        log(format!("Connect requested: {}", spec.destination));

        // Disconnect any existing session.
        {
            let state = app.state::<SshState>();
            if let Some(session) = state.session.lock().await.take() {
                disconnect_session(session).await;
            }
        }

        let key = uuid::Uuid::new_v4().to_string();
        let password = uuid::Uuid::new_v4().to_string();
        let local_port = free_port();
        let url = format!("http://127.0.0.1:{local_port}");

        // Unix domain sockets (and OpenSSH ControlPath) have strict length limits on macOS.
        // Avoid long per-user temp dirs like /var/folders/... by using /tmp.
        let dir = if control_supported() {
            PathBuf::from("/tmp").join(format!("opencode-ssh-{key}"))
        } else {
            std::env::temp_dir().join(format!("opencode-ssh-{key}"))
        };
        std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create temp dir: {e}"))?;

        let socket_path = control_supported().then(|| dir.join("ssh.sock"));
        let (askpass_task, askpass_socket) = spawn_askpass_server(app.clone(), &dir).await?;
        let askpass = Askpass {
            socket: askpass_socket,
            exe: exe_path(&app)?,
        };

        log(format!("Session dir: {}", dir.display()));
        if let Some(path) = socket_path.as_ref() {
            log(format!("ControlPath: {}", path.display()));
        }
        log(format!("Askpass socket: {}", askpass.socket));

        let master = if let Some(path) = socket_path.as_ref() {
            log("Starting SSH master");
            let master = spawn_master(&askpass, &spec, path).await?;
            log("Waiting for master ready");
            wait_master_ready(&askpass, &spec, path).await?;
            log("Master ready");
            Some(master)
        } else {
            None
        };

        log("Ensuring remote opencode");
        ensure_remote_opencode(&app, &askpass, &spec, socket_path.as_deref()).await?;
        log("Remote opencode ready");

        log("Starting remote opencode server");
        let (server_child, remote_port) =
            spawn_remote_server(&askpass, &spec, socket_path.as_deref(), &password).await?;

        log(format!("Remote server port: {remote_port}"));
        log(format!("Starting port forward to {url}"));
        let forward_child = spawn_forward(
            &app,
            &askpass,
            &spec,
            socket_path.as_deref(),
            local_port,
            remote_port,
        )
        .await?;

        log("Waiting for forwarded health");
        let start = Instant::now();
        loop {
            if start.elapsed() > Duration::from_secs(30) {
                return Err("Timed out waiting for forwarded server health".to_string());
            }
            if server::check_health(&url, Some(&password)).await {
                log("Forwarded health OK");
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        let session = SshSession {
            key: key.clone(),
            destination: spec.destination.clone(),
            dir: dir.clone(),
            socket_path,
            askpass_task,
            master,
            forward: forward_child,
            server: server_child,
        };

        app.state::<SshState>()
            .session
            .lock()
            .await
            .replace(session);

        Ok(SshConnectData {
            key,
            url,
            password,
            destination: spec.destination,
        })
    }
    .await
}

pub fn shutdown(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<SshState>();
        if let Some(session) = state.session.lock().await.take() {
            disconnect_session(session).await;
        }
    });
}
