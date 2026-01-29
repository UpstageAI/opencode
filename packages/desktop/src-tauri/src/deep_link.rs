use std::collections::BTreeMap;

#[derive(serde::Serialize, Clone, tauri_specta::Event, specta::Type)]
pub enum DeepLinkAction {
    OpenProject {
        directory: String,
        session: Option<String>,
    },
}

impl DeepLinkAction {
    pub fn from_url(url: url::Url) -> Option<Self> {
        if url.scheme() != "opencode" {
            return None;
        }

        let action = url.path().trim_start_matches('/');
        let mut query_pairs: BTreeMap<_, _> = url.query_pairs().collect();

        match action {
            "open-project" => Some(DeepLinkAction::OpenProject {
                directory: query_pairs.remove("directory")?.to_string(),
                session: query_pairs.remove("session").map(|v| v.to_string()),
            }),
            _ => None,
        }
    }
}
