use std::time::Duration;

use chrono::Utc;
use reqwest::header::{ETAG, IF_MODIFIED_SINCE, IF_NONE_MATCH, LAST_MODIFIED};
use reqwest::{Client, StatusCode};
use scraper::{Html, Selector};
use sha2::{Digest, Sha256};
use url::Url;

use crate::error::AppError;
use crate::models::{NewArticleRecord, ParsedFeedData};
use crate::readability::{
    estimate_reading_minutes, first_content_image, make_summary, resolve_url, sanitize_article_html,
};

pub fn build_http_client() -> Result<Client, AppError> {
    Client::builder()
        .user_agent("mReader/0.1 (+https://github.com/morewebs/mReader)")
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(Into::into)
}

pub fn normalize_input_url(raw: &str) -> Result<Url, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidUrl("URL cannot be empty".into()));
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let parsed =
        Url::parse(&with_scheme).map_err(|e| AppError::InvalidUrl(format!("{trimmed}: {e}")))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::InvalidUrl(format!(
            "Unsupported scheme: {}",
            parsed.scheme()
        )));
    }
    Ok(parsed)
}

pub fn stable_id(parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part.as_bytes());
        hasher.update(b"\x1f");
    }
    let digest = hasher.finalize();
    digest.iter().take(16).map(|b| format!("{b:02x}")).collect()
}

pub fn parse_feed_bytes(bytes: &[u8], feed_url: &str) -> Result<ParsedFeedData, AppError> {
    let parsed = feed_rs::parser::Builder::new()
        .base_uri(Some(feed_url))
        .build()
        .parse(bytes)
        .map_err(|e| AppError::FeedParse(e.to_string()))?;

    let site_url = parsed
        .links
        .iter()
        .find(|l| {
            let is_alt = l.rel.as_deref() == Some("alternate") || l.rel.is_none();
            let is_html = l.media_type.as_deref().is_none_or(|m| m.contains("html"));
            is_alt && is_html && l.href != feed_url
        })
        .or_else(|| parsed.links.iter().find(|l| l.href != feed_url))
        .and_then(|l| resolve_url(&l.href, Some(feed_url)));

    let title = parsed
        .title
        .map(|t| t.content.trim().to_string())
        .filter(|t| !t.is_empty())
        .or_else(|| {
            Url::parse(feed_url)
                .ok()
                .and_then(|u| u.host_str().map(ToOwned::to_owned))
        })
        .unwrap_or_else(|| "Untitled Feed".to_string());

    let description = parsed
        .description
        .map(|d| make_summary(&d.content, 240))
        .filter(|d| !d.is_empty());

    let fallback_base = site_url.as_deref().unwrap_or(feed_url);
    let mut items = Vec::with_capacity(parsed.entries.len());

    for entry in parsed.entries {
        let entry_url = entry
            .links
            .iter()
            .find(|l| l.rel.as_deref() == Some("alternate") || l.rel.is_none())
            .or_else(|| entry.links.first())
            .and_then(|l| resolve_url(&l.href, Some(fallback_base)));

        let entry_title = entry
            .title
            .map(|t| crate::readability::html_to_plain_text(&t.content))
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| "Untitled".to_string());

        let published_at = entry
            .published
            .or(entry.updated)
            .unwrap_or_else(Utc::now)
            .to_rfc3339();

        let guid = if !entry.id.trim().is_empty() {
            entry.id.trim().to_string()
        } else if let Some(ref u) = entry_url {
            u.clone()
        } else {
            format!("{entry_title}::{published_at}")
        };

        let author = entry
            .authors
            .into_iter()
            .filter_map(|p| p.name.map(|n| n.trim().to_string()))
            .find(|n| !n.is_empty());

        let base_for_entry = entry_url.as_deref().unwrap_or(fallback_base);
        let raw_content = entry
            .content
            .as_ref()
            .and_then(|c| c.body.as_deref())
            .filter(|s| !s.trim().is_empty())
            .or_else(|| {
                entry
                    .summary
                    .as_ref()
                    .map(|s| s.content.as_str())
                    .filter(|s| !s.trim().is_empty())
            })
            .unwrap_or("");

        let content_html = sanitize_article_html(raw_content, Some(base_for_entry));
        let summary_source = entry
            .summary
            .as_ref()
            .map(|s| s.content.as_str())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(&content_html);

        let mut summary = make_summary(summary_source, 200);
        if summary == entry_title {
            summary.clear();
        }

        let plain_for_time = crate::readability::html_to_plain_text(&content_html);
        let reading_minutes = estimate_reading_minutes(&plain_for_time);

        let media_image = entry.media.iter().find_map(|m| {
            m.thumbnails
                .first()
                .and_then(|t| resolve_url(&t.image.uri, Some(base_for_entry)))
                .or_else(|| {
                    m.content.iter().find_map(|c| {
                        let is_img = c.content_type.as_ref().is_some_and(|ct| ct.ty() == "image");
                        if is_img {
                            c.url
                                .as_ref()
                                .and_then(|u| resolve_url(u.as_str(), Some(base_for_entry)))
                        } else {
                            None
                        }
                    })
                })
        });
        let image_url =
            media_image.or_else(|| first_content_image(&content_html, Some(base_for_entry)));

        let article_id = stable_id(&[feed_url, &guid]);
        items.push(NewArticleRecord {
            id: article_id,
            guid,
            url: entry_url,
            title: entry_title,
            author,
            summary,
            content_html,
            image_url,
            published_at,
            reading_minutes,
        });
    }

    Ok(ParsedFeedData {
        feed_url: feed_url.to_string(),
        site_url,
        title,
        description,
        items,
    })
}

pub fn discover_feed_urls_from_html(html: &str, page_url: &str) -> Vec<String> {
    let document = Html::parse_document(html);
    let Ok(link_sel) = Selector::parse("link[rel~='alternate'][href]") else {
        return Vec::new();
    };

    let mut ranked: Vec<(u8, String)> = Vec::new();
    for link in document.select(&link_sel) {
        let Some(href) = link.value().attr("href") else {
            continue;
        };
        let mime = link.value().attr("type").unwrap_or_default().to_lowercase();
        let priority =
            if mime.contains("application/rss+xml") || mime.contains("application/atom+xml") {
                0
            } else if mime.contains("application/feed+json") || mime.contains("application/json") {
                1
            } else if mime.contains("xml") {
                2
            } else {
                continue;
            };
        if let Some(resolved) = resolve_url(href, Some(page_url)) {
            ranked.push((priority, resolved));
        }
    }

    ranked.sort_by_key(|(p, _)| *p);
    let mut seen = std::collections::HashSet::new();
    ranked
        .into_iter()
        .filter_map(|(_, u)| {
            if seen.insert(u.clone()) {
                Some(u)
            } else {
                None
            }
        })
        .collect()
}

pub struct FetchOutcome {
    pub parsed: ParsedFeedData,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

pub async fn discover_and_fetch_feed(
    client: &Client,
    raw_input: &str,
) -> Result<FetchOutcome, AppError> {
    let initial_url = normalize_input_url(raw_input)?;
    let resp = client
        .get(initial_url.clone())
        .send()
        .await?
        .error_for_status()?;
    let final_url = resp.url().to_string();
    let etag = header_str(resp.headers(), ETAG);
    let last_modified = header_str(resp.headers(), LAST_MODIFIED);
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_lowercase();
    let bytes = resp.bytes().await?;

    if !content_type.contains("text/html") {
        if let Ok(parsed) = parse_feed_bytes(&bytes, &final_url) {
            return Ok(FetchOutcome {
                parsed,
                etag,
                last_modified,
            });
        }
    }

    let html = String::from_utf8_lossy(&bytes);
    let mut candidates = discover_feed_urls_from_html(&html, &final_url);

    if candidates.is_empty() {
        if let Ok(base) = Url::parse(&final_url) {
            for suffix in ["/feed.xml", "/rss.xml", "/feed", "/atom.xml", "/index.xml"] {
                if let Ok(candidate) = base.join(suffix) {
                    candidates.push(candidate.to_string());
                }
            }
        }
    }

    for candidate in candidates.into_iter().take(6) {
        let Ok(resp) = client.get(&candidate).send().await else {
            continue;
        };
        if !resp.status().is_success() {
            continue;
        }
        let resolved_url = resp.url().to_string();
        let c_etag = header_str(resp.headers(), ETAG);
        let c_last_mod = header_str(resp.headers(), LAST_MODIFIED);
        let Ok(c_bytes) = resp.bytes().await else {
            continue;
        };
        if let Ok(parsed) = parse_feed_bytes(&c_bytes, &resolved_url) {
            return Ok(FetchOutcome {
                parsed,
                etag: c_etag,
                last_modified: c_last_mod,
            });
        }
    }

    // Final fallback in case server sent feed XML with text/html content-type
    if let Ok(parsed) = parse_feed_bytes(&bytes, &final_url) {
        return Ok(FetchOutcome {
            parsed,
            etag,
            last_modified,
        });
    }

    Err(AppError::NoFeedFound(final_url))
}

pub enum ConditionalSync {
    NotModified,
    Updated(FetchOutcome),
}

pub async fn fetch_feed_conditional(
    client: &Client,
    feed_url: &str,
    etag: Option<&str>,
    last_modified: Option<&str>,
) -> Result<ConditionalSync, AppError> {
    let mut req = client.get(feed_url);
    if let Some(tag) = etag.filter(|s| !s.is_empty()) {
        req = req.header(IF_NONE_MATCH, tag);
    }
    if let Some(lm) = last_modified.filter(|s| !s.is_empty()) {
        req = req.header(IF_MODIFIED_SINCE, lm);
    }

    let resp = req.send().await?;
    if resp.status() == StatusCode::NOT_MODIFIED {
        return Ok(ConditionalSync::NotModified);
    }
    let resp = resp.error_for_status()?;
    let new_etag = header_str(resp.headers(), ETAG);
    let new_last_modified = header_str(resp.headers(), LAST_MODIFIED);
    let bytes = resp.bytes().await?;
    let parsed = parse_feed_bytes(&bytes, feed_url)?;
    Ok(ConditionalSync::Updated(FetchOutcome {
        parsed,
        etag: new_etag,
        last_modified: new_last_modified,
    }))
}

fn header_str(
    headers: &reqwest::header::HeaderMap,
    name: reqwest::header::HeaderName,
) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_urls_and_rejects_bad_schemes() {
        assert_eq!(
            normalize_input_url("simonwillison.net").unwrap().as_str(),
            "https://simonwillison.net/"
        );
        assert!(normalize_input_url("javascript:alert(1)").is_err());
        assert!(normalize_input_url("  ").is_err());
    }

    #[test]
    fn parses_rss_and_json_feeds_with_clean_summaries() {
        let rss = br#"<?xml version="1.0" encoding="UTF-8" ?>
        <rss version="2.0">
          <channel>
            <title>Calm Web</title>
            <link>https://calm.example</link>
            <description>Essays on clarity</description>
            <item>
              <guid>post-42</guid>
              <title>Quiet &amp; Intentional UI</title>
              <link>/posts/quiet-ui</link>
              <pubDate>Mon, 16 Nov 2026 08:00:00 GMT</pubDate>
              <description><![CDATA[<p>Interfaces feel calm when whitespace carries structure instead of borders.</p><img src="/cover.png"/>]]></description>
            </item>
          </channel>
        </rss>"#;

        let parsed = parse_feed_bytes(rss, "https://calm.example/rss.xml").expect("rss");
        assert_eq!(parsed.title, "Calm Web");
        assert_eq!(parsed.items.len(), 1);
        let item = &parsed.items[0];
        assert_eq!(item.title, "Quiet & Intentional UI");
        assert_eq!(
            item.url.as_deref(),
            Some("https://calm.example/posts/quiet-ui")
        );
        assert_eq!(
            item.image_url.as_deref(),
            Some("https://calm.example/cover.png")
        );
        assert!(!item.summary.contains('<'));
        assert!(item.summary.contains("whitespace carries structure"));
    }

    #[test]
    fn discovers_alternate_feed_links_from_html() {
        let html = r#"
        <html><head>
          <link rel="alternate" type="text/html" href="/es/" />
          <link rel="alternate" type="application/atom+xml" title="Atom" href="/atom.xml" />
          <link rel="alternate" type="application/rss+xml" title="RSS" href="https://blog.example/feed.xml" />
        </head></html>"#;

        let found = discover_feed_urls_from_html(html, "https://blog.example/posts/1");
        assert_eq!(
            found,
            vec![
                "https://blog.example/atom.xml".to_string(),
                "https://blog.example/feed.xml".to_string()
            ]
        );
    }
}
