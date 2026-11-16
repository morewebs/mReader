use std::sync::Arc;

use reqwest::Client;
use tokio::sync::Semaphore;

use crate::db::{ArticleQuery, Database};
use crate::error::AppError;
use crate::feed::{discover_and_fetch_feed, fetch_feed_conditional, stable_id, ConditionalSync};
use crate::models::{
    ArticleDetail, ArticleSummary, Feed, FeedRefreshError, OpmlImportSummary, ReaderSettings,
    RefreshSummary,
};
use crate::opml::{export_opml as build_opml_xml, parse_opml};
use crate::readability::extract_article_html;

pub struct AppState {
    pub db: Database,
    pub client: Client,
}

#[tauri::command]
pub async fn get_feeds(state: tauri::State<'_, AppState>) -> Result<Vec<Feed>, AppError> {
    state.db.list_feeds()
}

#[tauri::command]
pub async fn add_feed(
    url: String,
    folder: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Feed, AppError> {
    let outcome = discover_and_fetch_feed(&state.client, &url).await?;
    let feed_id = stable_id(&[&outcome.parsed.feed_url]);
    let clean_folder = folder.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let (feed, _) = state.db.upsert_feed_with_articles(
        &feed_id,
        &outcome.parsed,
        clean_folder,
        outcome.etag.as_deref(),
        outcome.last_modified.as_deref(),
    )?;
    Ok(feed)
}

#[tauri::command]
pub async fn add_starter_feeds(
    urls: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<OpmlImportSummary, AppError> {
    subscribe_urls(
        &state.db,
        &state.client,
        urls.into_iter().map(|u| (u, None)).collect(),
    )
    .await
}

#[tauri::command]
pub async fn delete_feed(
    feed_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    state.db.delete_feed(&feed_id)
}

#[tauri::command]
pub async fn refresh_feed(
    feed_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RefreshSummary, AppError> {
    let feed = state.db.get_feed(&feed_id)?;
    refresh_feeds_batch(&state.db, &state.client, vec![feed]).await
}

#[tauri::command]
pub async fn refresh_all_feeds(
    state: tauri::State<'_, AppState>,
) -> Result<RefreshSummary, AppError> {
    let feeds = state.db.list_feeds()?;
    refresh_feeds_batch(&state.db, &state.client, feeds).await
}

#[tauri::command]
pub async fn list_articles(
    scope: String,
    feed_id: Option<String>,
    search: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ArticleSummary>, AppError> {
    state.db.query_articles(&ArticleQuery {
        scope,
        feed_id,
        search,
        limit: limit.unwrap_or(150),
        offset: offset.unwrap_or(0),
    })
}

#[tauri::command]
pub async fn get_article(
    article_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<ArticleDetail, AppError> {
    state.db.get_article(&article_id)
}

#[tauri::command]
pub async fn fetch_full_article(
    article_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<ArticleDetail, AppError> {
    let existing = state.db.get_article(&article_id)?;
    if existing.extracted_html.is_some() {
        return Ok(existing);
    }
    let url = existing
        .url
        .as_deref()
        .ok_or_else(|| AppError::InvalidUrl("Article has no source link".into()))?;
    let resp = state.client.get(url).send().await?.error_for_status()?;
    let final_url = resp.url().to_string();
    let html = resp.text().await?;
    let extracted = extract_article_html(&html, &final_url)?;
    state.db.save_extracted_html(
        &article_id,
        &extracted.content_html,
        extracted.reading_minutes,
    )?;
    state.db.get_article(&article_id)
}

#[tauri::command]
pub async fn set_article_read(
    article_id: String,
    is_read: bool,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    state.db.set_article_read(&article_id, is_read)
}

#[tauri::command]
pub async fn set_article_saved(
    article_id: String,
    is_saved: bool,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    state.db.set_article_saved(&article_id, is_saved)
}

#[tauri::command]
pub async fn mark_all_read(
    feed_id: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<usize, AppError> {
    state.db.mark_all_read(feed_id.as_deref())
}

#[tauri::command]
pub async fn import_opml(
    xml: String,
    state: tauri::State<'_, AppState>,
) -> Result<OpmlImportSummary, AppError> {
    let entries = parse_opml(&xml)?;
    let targets = entries
        .into_iter()
        .map(|o| (o.url, o.folder))
        .collect::<Vec<_>>();
    subscribe_urls(&state.db, &state.client, targets).await
}

#[tauri::command]
pub async fn export_opml(state: tauri::State<'_, AppState>) -> Result<String, AppError> {
    let feeds = state.db.list_feeds()?;
    build_opml_xml(&feeds)
}

#[tauri::command]
pub async fn get_settings(state: tauri::State<'_, AppState>) -> Result<ReaderSettings, AppError> {
    state.db.get_settings()
}

#[tauri::command]
pub async fn save_settings(
    settings: ReaderSettings,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    state.db.save_settings(&settings)
}

async fn refresh_feeds_batch(
    db: &Database,
    client: &Client,
    feeds: Vec<Feed>,
) -> Result<RefreshSummary, AppError> {
    let feeds_checked = feeds.len();
    let semaphore = Arc::new(Semaphore::new(6));
    let mut handles = Vec::with_capacity(feeds_checked);

    for feed in feeds {
        let permit = semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let client = client.clone();
        let db = db.clone();

        handles.push(tokio::spawn(async move {
            let _permit = permit;
            match fetch_feed_conditional(
                &client,
                &feed.url,
                feed.etag.as_deref(),
                feed.last_modified.as_deref(),
            )
            .await
            {
                Ok(ConditionalSync::NotModified) => {
                    let _ = db.mark_feed_not_modified(&feed.id);
                    Ok((false, 0usize))
                }
                Ok(ConditionalSync::Updated(outcome)) => {
                    let inserted = db
                        .update_feed_sync_result(
                            &feed.id,
                            &outcome.parsed.items,
                            outcome.parsed.site_url.as_deref(),
                            outcome.parsed.description.as_deref(),
                            outcome.etag.as_deref(),
                            outcome.last_modified.as_deref(),
                        )
                        .map_err(|err| FeedRefreshError {
                            feed_id: feed.id.clone(),
                            feed_title: feed.title.clone(),
                            message: err.to_string(),
                        })?;
                    Ok((true, inserted))
                }
                Err(err) => {
                    let msg = err.to_string();
                    let _ = db.record_feed_error(&feed.id, &msg);
                    Err(FeedRefreshError {
                        feed_id: feed.id,
                        feed_title: feed.title,
                        message: msg,
                    })
                }
            }
        }));
    }

    let mut feeds_updated = 0usize;
    let mut new_articles = 0usize;
    let mut errors = Vec::new();

    for handle in handles {
        match handle.await {
            Ok(Ok((updated, count))) => {
                if updated {
                    feeds_updated += 1;
                }
                new_articles += count;
            }
            Ok(Err(feed_err)) => errors.push(feed_err),
            Err(join_err) => errors.push(FeedRefreshError {
                feed_id: String::new(),
                feed_title: "Sync worker".into(),
                message: join_err.to_string(),
            }),
        }
    }

    Ok(RefreshSummary {
        feeds_checked,
        feeds_updated,
        new_articles,
        errors,
    })
}

async fn subscribe_urls(
    db: &Database,
    client: &Client,
    targets: Vec<(String, Option<String>)>,
) -> Result<OpmlImportSummary, AppError> {
    let existing_urls: std::collections::HashSet<String> =
        db.list_feeds()?.into_iter().map(|f| f.url).collect();

    let semaphore = Arc::new(Semaphore::new(6));
    let mut handles = Vec::new();
    let mut skipped = 0usize;

    for (url, folder) in targets {
        if existing_urls.contains(url.trim()) {
            skipped += 1;
            continue;
        }
        let permit = semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let client = client.clone();
        let db = db.clone();

        handles.push(tokio::spawn(async move {
            let _permit = permit;
            let outcome = discover_and_fetch_feed(&client, &url).await?;
            let feed_id = stable_id(&[&outcome.parsed.feed_url]);
            db.upsert_feed_with_articles(
                &feed_id,
                &outcome.parsed,
                folder.as_deref(),
                outcome.etag.as_deref(),
                outcome.last_modified.as_deref(),
            )?;
            Ok::<(), AppError>(())
        }));
    }

    let mut imported = 0usize;
    let mut errors = Vec::new();
    for handle in handles {
        match handle.await {
            Ok(Ok(())) => imported += 1,
            Ok(Err(err)) => errors.push(err.to_string()),
            Err(join_err) => errors.push(join_err.to_string()),
        }
    }

    Ok(OpmlImportSummary {
        imported,
        skipped,
        errors,
    })
}
