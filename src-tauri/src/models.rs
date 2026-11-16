use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Feed {
    pub id: String,
    pub url: String,
    pub site_url: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub folder: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub last_fetched_at: Option<String>,
    pub last_error: Option<String>,
    pub unread_count: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArticleSummary {
    pub id: String,
    pub feed_id: String,
    pub feed_title: String,
    pub url: Option<String>,
    pub title: String,
    pub author: Option<String>,
    pub summary: String,
    pub image_url: Option<String>,
    pub published_at: String,
    pub reading_minutes: i64,
    pub is_read: bool,
    pub is_saved: bool,
    pub has_extracted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArticleDetail {
    pub id: String,
    pub feed_id: String,
    pub feed_title: String,
    pub url: Option<String>,
    pub title: String,
    pub author: Option<String>,
    pub summary: String,
    pub content_html: String,
    pub extracted_html: Option<String>,
    pub image_url: Option<String>,
    pub published_at: String,
    pub fetched_at: String,
    pub reading_minutes: i64,
    pub is_read: bool,
    pub is_saved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeedRefreshError {
    pub feed_id: String,
    pub feed_title: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RefreshSummary {
    pub feeds_checked: usize,
    pub feeds_updated: usize,
    pub new_articles: usize,
    pub errors: Vec<FeedRefreshError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpmlImportSummary {
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReaderSettings {
    pub theme: String,
    pub font_family: String,
    pub font_size: String,
    pub monochrome_images: bool,
}

impl Default for ReaderSettings {
    fn default() -> Self {
        Self {
            theme: "ink".to_string(),
            font_family: "serif".to_string(),
            font_size: "md".to_string(),
            monochrome_images: true,
        }
    }
}

#[derive(Debug, Clone)]
pub struct NewArticleRecord {
    pub id: String,
    pub guid: String,
    pub url: Option<String>,
    pub title: String,
    pub author: Option<String>,
    pub summary: String,
    pub content_html: String,
    pub image_url: Option<String>,
    pub published_at: String,
    pub reading_minutes: i64,
}

#[derive(Debug, Clone)]
pub struct ParsedFeedData {
    pub feed_url: String,
    pub site_url: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub items: Vec<NewArticleRecord>,
}
