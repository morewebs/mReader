use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Network request failed: {0}")]
    Network(#[from] reqwest::Error),

    #[error("Could not parse feed: {0}")]
    FeedParse(String),

    #[error("Invalid URL: {0}")]
    InvalidUrl(String),

    #[error("No RSS, Atom, or JSON feed found at {0}")]
    NoFeedFound(String),

    #[error("OPML error: {0}")]
    Opml(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Internal(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
