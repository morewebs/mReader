use std::path::Path;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppError;
use crate::models::{
    ArticleDetail, ArticleSummary, Feed, NewArticleRecord, ParsedFeedData, ReaderSettings,
};

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

#[derive(Debug, Clone)]
pub struct ArticleQuery {
    pub scope: String,
    pub feed_id: Option<String>,
    pub search: Option<String>,
    pub limit: i64,
    pub offset: i64,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, AppError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init()?;
        Ok(db)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, AppError> {
        let conn = Connection::open_in_memory()?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init()?;
        Ok(db)
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, AppError> {
        self.conn
            .lock()
            .map_err(|e| AppError::Internal(format!("Database lock poisoned: {e}")))
    }

    fn init(&self) -> Result<(), AppError> {
        let conn = self.lock()?;
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS feeds (
                id TEXT PRIMARY KEY,
                url TEXT NOT NULL UNIQUE,
                site_url TEXT,
                title TEXT NOT NULL,
                description TEXT,
                folder TEXT,
                etag TEXT,
                last_modified TEXT,
                last_fetched_at TEXT,
                last_error TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS articles (
                id TEXT PRIMARY KEY,
                feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
                guid TEXT NOT NULL,
                url TEXT,
                title TEXT NOT NULL,
                author TEXT,
                summary TEXT NOT NULL,
                content_html TEXT NOT NULL,
                extracted_html TEXT,
                image_url TEXT,
                published_at TEXT NOT NULL,
                fetched_at TEXT NOT NULL,
                reading_minutes INTEGER NOT NULL DEFAULT 1,
                is_read INTEGER NOT NULL DEFAULT 0,
                is_saved INTEGER NOT NULL DEFAULT 0,
                UNIQUE(feed_id, guid)
            );

            CREATE INDEX IF NOT EXISTS idx_articles_published
                ON articles(published_at DESC, id DESC);
            CREATE INDEX IF NOT EXISTS idx_articles_feed_unread
                ON articles(feed_id, is_read);
            CREATE INDEX IF NOT EXISTS idx_articles_saved
                ON articles(is_saved, published_at DESC);

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            ",
        )?;
        Ok(())
    }

    pub fn list_feeds(&self) -> Result<Vec<Feed>, AppError> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "
            SELECT
                f.id, f.url, f.site_url, f.title, f.description, f.folder,
                f.etag, f.last_modified, f.last_fetched_at, f.last_error, f.created_at,
                COALESCE(SUM(CASE WHEN a.is_read = 0 THEN 1 ELSE 0 END), 0) AS unread_count
            FROM feeds f
            LEFT JOIN articles a ON a.feed_id = f.id
            GROUP BY f.id
            ORDER BY LOWER(f.title) ASC
            ",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(Feed {
                id: row.get(0)?,
                url: row.get(1)?,
                site_url: row.get(2)?,
                title: row.get(3)?,
                description: row.get(4)?,
                folder: row.get(5)?,
                etag: row.get(6)?,
                last_modified: row.get(7)?,
                last_fetched_at: row.get(8)?,
                last_error: row.get(9)?,
                created_at: row.get(10)?,
                unread_count: row.get(11)?,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn get_feed(&self, feed_id: &str) -> Result<Feed, AppError> {
        let conn = self.lock()?;
        conn.query_row(
            "
            SELECT
                f.id, f.url, f.site_url, f.title, f.description, f.folder,
                f.etag, f.last_modified, f.last_fetched_at, f.last_error, f.created_at,
                COALESCE(SUM(CASE WHEN a.is_read = 0 THEN 1 ELSE 0 END), 0) AS unread_count
            FROM feeds f
            LEFT JOIN articles a ON a.feed_id = f.id
            WHERE f.id = ?1
            GROUP BY f.id
            ",
            params![feed_id],
            |row| {
                Ok(Feed {
                    id: row.get(0)?,
                    url: row.get(1)?,
                    site_url: row.get(2)?,
                    title: row.get(3)?,
                    description: row.get(4)?,
                    folder: row.get(5)?,
                    etag: row.get(6)?,
                    last_modified: row.get(7)?,
                    last_fetched_at: row.get(8)?,
                    last_error: row.get(9)?,
                    created_at: row.get(10)?,
                    unread_count: row.get(11)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("Feed {feed_id}")))
    }

    pub fn upsert_feed_with_articles(
        &self,
        feed_id: &str,
        parsed: &ParsedFeedData,
        folder: Option<&str>,
        etag: Option<&str>,
        last_modified: Option<&str>,
    ) -> Result<(Feed, usize), AppError> {
        let now = Utc::now().to_rfc3339();
        {
            let mut conn = self.lock()?;
            let tx = conn.transaction()?;

            let existing_id: Option<String> = tx
                .query_row(
                    "SELECT id FROM feeds WHERE url = ?1",
                    params![parsed.feed_url],
                    |row| row.get(0),
                )
                .optional()?;

            let target_feed_id = existing_id.unwrap_or_else(|| feed_id.to_string());

            tx.execute(
                "
                INSERT INTO feeds (
                    id, url, site_url, title, description, folder,
                    etag, last_modified, last_fetched_at, last_error, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?9)
                ON CONFLICT(url) DO UPDATE SET
                    site_url = COALESCE(excluded.site_url, feeds.site_url),
                    title = excluded.title,
                    description = COALESCE(excluded.description, feeds.description),
                    folder = COALESCE(excluded.folder, feeds.folder),
                    etag = COALESCE(excluded.etag, feeds.etag),
                    last_modified = COALESCE(excluded.last_modified, feeds.last_modified),
                    last_fetched_at = excluded.last_fetched_at,
                    last_error = NULL
                ",
                params![
                    target_feed_id,
                    parsed.feed_url,
                    parsed.site_url,
                    parsed.title,
                    parsed.description,
                    folder,
                    etag,
                    last_modified,
                    now,
                ],
            )?;

            let inserted = Self::insert_articles_tx(&tx, &target_feed_id, &parsed.items, &now)?;
            tx.commit()?;
            drop(conn);
            let feed = self.get_feed(&target_feed_id)?;
            Ok((feed, inserted))
        }
    }

    pub fn update_feed_sync_result(
        &self,
        feed_id: &str,
        items: &[NewArticleRecord],
        site_url: Option<&str>,
        description: Option<&str>,
        etag: Option<&str>,
        last_modified: Option<&str>,
    ) -> Result<usize, AppError> {
        let now = Utc::now().to_rfc3339();
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;

        tx.execute(
            "
            UPDATE feeds SET
                site_url = COALESCE(?2, site_url),
                description = COALESCE(?3, description),
                etag = COALESCE(?4, etag),
                last_modified = COALESCE(?5, last_modified),
                last_fetched_at = ?6,
                last_error = NULL
            WHERE id = ?1
            ",
            params![feed_id, site_url, description, etag, last_modified, now],
        )?;

        let inserted = Self::insert_articles_tx(&tx, feed_id, items, &now)?;
        tx.commit()?;
        Ok(inserted)
    }

    pub fn mark_feed_not_modified(&self, feed_id: &str) -> Result<(), AppError> {
        let now = Utc::now().to_rfc3339();
        let conn = self.lock()?;
        conn.execute(
            "UPDATE feeds SET last_fetched_at = ?2, last_error = NULL WHERE id = ?1",
            params![feed_id, now],
        )?;
        Ok(())
    }

    pub fn record_feed_error(&self, feed_id: &str, error_msg: &str) -> Result<(), AppError> {
        let now = Utc::now().to_rfc3339();
        let conn = self.lock()?;
        conn.execute(
            "UPDATE feeds SET last_fetched_at = ?2, last_error = ?3 WHERE id = ?1",
            params![feed_id, now, error_msg],
        )?;
        Ok(())
    }

    fn insert_articles_tx(
        tx: &rusqlite::Transaction<'_>,
        feed_id: &str,
        items: &[NewArticleRecord],
        now: &str,
    ) -> Result<usize, AppError> {
        let mut inserted = 0usize;
        let mut stmt = tx.prepare(
            "
            INSERT INTO articles (
                id, feed_id, guid, url, title, author, summary,
                content_html, image_url, published_at, fetched_at, reading_minutes
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            ON CONFLICT(feed_id, guid) DO UPDATE SET
                url = COALESCE(excluded.url, articles.url),
                title = excluded.title,
                author = COALESCE(excluded.author, articles.author),
                summary = CASE WHEN excluded.summary != '' THEN excluded.summary ELSE articles.summary END,
                content_html = CASE WHEN LENGTH(excluded.content_html) > LENGTH(articles.content_html)
                    THEN excluded.content_html ELSE articles.content_html END,
                image_url = COALESCE(excluded.image_url, articles.image_url),
                reading_minutes = CASE WHEN excluded.reading_minutes > articles.reading_minutes
                    THEN excluded.reading_minutes ELSE articles.reading_minutes END
            ",
        )?;

        for item in items {
            let exists: Option<i64> = tx
                .query_row(
                    "SELECT 1 FROM articles WHERE feed_id = ?1 AND guid = ?2",
                    params![feed_id, item.guid],
                    |row| row.get(0),
                )
                .optional()?;

            stmt.execute(params![
                item.id,
                feed_id,
                item.guid,
                item.url,
                item.title,
                item.author,
                item.summary,
                item.content_html,
                item.image_url,
                item.published_at,
                now,
                item.reading_minutes,
            ])?;

            if exists.is_none() {
                inserted += 1;
            }
        }
        Ok(inserted)
    }

    pub fn query_articles(&self, query: &ArticleQuery) -> Result<Vec<ArticleSummary>, AppError> {
        let conn = self.lock()?;
        let mut sql = String::from(
            "
            SELECT
                a.id, a.feed_id, f.title, a.url, a.title, a.author,
                a.summary, a.image_url, a.published_at, a.reading_minutes,
                a.is_read, a.is_saved, (a.extracted_html IS NOT NULL) AS has_extracted
            FROM articles a
            INNER JOIN feeds f ON f.id = a.feed_id
            WHERE 1 = 1
            ",
        );

        let mut bind_values: Vec<rusqlite::types::Value> = Vec::new();
        match query.scope.as_str() {
            "unread" => sql.push_str(" AND a.is_read = 0"),
            "saved" => sql.push_str(" AND a.is_saved = 1"),
            _ => {}
        }

        if let Some(feed_id) = query.feed_id.as_deref().filter(|s| !s.is_empty()) {
            bind_values.push(feed_id.to_string().into());
            sql.push_str(&format!(" AND a.feed_id = ?{}", bind_values.len()));
        }

        if let Some(search) = query
            .search
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let pattern = format!("%{}%", search.to_lowercase());
            bind_values.push(pattern.into());
            let idx = bind_values.len();
            sql.push_str(&format!(
                " AND (LOWER(a.title) LIKE ?{idx} OR LOWER(a.summary) LIKE ?{idx} OR LOWER(f.title) LIKE ?{idx})"
            ));
        }

        bind_values.push(query.limit.clamp(1, 500).into());
        let limit_idx = bind_values.len();
        bind_values.push(query.offset.max(0).into());
        let offset_idx = bind_values.len();
        sql.push_str(&format!(
            " ORDER BY a.published_at DESC, a.id DESC LIMIT ?{limit_idx} OFFSET ?{offset_idx}"
        ));

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(bind_values), |row| {
            Ok(ArticleSummary {
                id: row.get(0)?,
                feed_id: row.get(1)?,
                feed_title: row.get(2)?,
                url: row.get(3)?,
                title: row.get(4)?,
                author: row.get(5)?,
                summary: row.get(6)?,
                image_url: row.get(7)?,
                published_at: row.get(8)?,
                reading_minutes: row.get(9)?,
                is_read: row.get::<_, i64>(10)? != 0,
                is_saved: row.get::<_, i64>(11)? != 0,
                has_extracted: row.get::<_, i64>(12)? != 0,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn get_article(&self, article_id: &str) -> Result<ArticleDetail, AppError> {
        let conn = self.lock()?;
        conn.query_row(
            "
            SELECT
                a.id, a.feed_id, f.title, a.url, a.title, a.author,
                a.summary, a.content_html, a.extracted_html, a.image_url,
                a.published_at, a.fetched_at, a.reading_minutes, a.is_read, a.is_saved
            FROM articles a
            INNER JOIN feeds f ON f.id = a.feed_id
            WHERE a.id = ?1
            ",
            params![article_id],
            |row| {
                Ok(ArticleDetail {
                    id: row.get(0)?,
                    feed_id: row.get(1)?,
                    feed_title: row.get(2)?,
                    url: row.get(3)?,
                    title: row.get(4)?,
                    author: row.get(5)?,
                    summary: row.get(6)?,
                    content_html: row.get(7)?,
                    extracted_html: row.get(8)?,
                    image_url: row.get(9)?,
                    published_at: row.get(10)?,
                    fetched_at: row.get(11)?,
                    reading_minutes: row.get(12)?,
                    is_read: row.get::<_, i64>(13)? != 0,
                    is_saved: row.get::<_, i64>(14)? != 0,
                })
            },
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("Article {article_id}")))
    }

    pub fn save_extracted_html(
        &self,
        article_id: &str,
        extracted_html: &str,
        reading_minutes: i64,
    ) -> Result<(), AppError> {
        let conn = self.lock()?;
        conn.execute(
            "
            UPDATE articles
            SET extracted_html = ?2,
                reading_minutes = CASE WHEN ?3 > reading_minutes THEN ?3 ELSE reading_minutes END
            WHERE id = ?1
            ",
            params![article_id, extracted_html, reading_minutes],
        )?;
        Ok(())
    }

    pub fn set_article_read(&self, article_id: &str, is_read: bool) -> Result<(), AppError> {
        let conn = self.lock()?;
        let affected = conn.execute(
            "UPDATE articles SET is_read = ?2 WHERE id = ?1",
            params![article_id, i64::from(is_read)],
        )?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("Article {article_id}")));
        }
        Ok(())
    }

    pub fn set_article_saved(&self, article_id: &str, is_saved: bool) -> Result<(), AppError> {
        let conn = self.lock()?;
        let affected = conn.execute(
            "UPDATE articles SET is_saved = ?2 WHERE id = ?1",
            params![article_id, i64::from(is_saved)],
        )?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("Article {article_id}")));
        }
        Ok(())
    }

    pub fn mark_all_read(&self, feed_id: Option<&str>) -> Result<usize, AppError> {
        let conn = self.lock()?;
        let count = if let Some(fid) = feed_id.filter(|s| !s.is_empty()) {
            conn.execute(
                "UPDATE articles SET is_read = 1 WHERE feed_id = ?1 AND is_read = 0",
                params![fid],
            )?
        } else {
            conn.execute("UPDATE articles SET is_read = 1 WHERE is_read = 0", [])?
        };
        Ok(count)
    }

    pub fn delete_feed(&self, feed_id: &str) -> Result<(), AppError> {
        let conn = self.lock()?;
        let affected = conn.execute("DELETE FROM feeds WHERE id = ?1", params![feed_id])?;
        if affected == 0 {
            return Err(AppError::NotFound(format!("Feed {feed_id}")));
        }
        Ok(())
    }

    pub fn get_settings(&self) -> Result<ReaderSettings, AppError> {
        let conn = self.lock()?;
        let raw: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'reader_settings'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        match raw {
            Some(json) => Ok(serde_json::from_str(&json).unwrap_or_default()),
            None => Ok(ReaderSettings::default()),
        }
    }

    pub fn save_settings(&self, settings: &ReaderSettings) -> Result<(), AppError> {
        let conn = self.lock()?;
        let json =
            serde_json::to_string(settings).map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "
            INSERT INTO settings (key, value) VALUES ('reader_settings', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            ",
            params![json],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_parsed(title: &str, guid: &str) -> ParsedFeedData {
        ParsedFeedData {
            feed_url: "https://example.com/feed.xml".into(),
            site_url: Some("https://example.com".into()),
            title: title.into(),
            description: Some("Notes".into()),
            items: vec![NewArticleRecord {
                id: format!("art-{guid}"),
                guid: guid.into(),
                url: Some(format!("https://example.com/{guid}")),
                title: format!("Title {guid}"),
                author: Some("Author".into()),
                summary: "Short summary".into(),
                content_html: "<p>Body content</p>".into(),
                image_url: None,
                published_at: "2026-11-16T08:00:00Z".into(),
                reading_minutes: 3,
            }],
        }
    }

    #[test]
    fn upserts_and_preserves_read_saved_flags_across_sync() {
        let db = Database::open_in_memory().expect("in-memory db");
        let parsed = sample_parsed("Example", "g1");
        let (feed, inserted) = db
            .upsert_feed_with_articles("f1", &parsed, Some("Tech"), Some("\"e1\""), None)
            .expect("insert feed");
        assert_eq!(inserted, 1);
        assert_eq!(feed.unread_count, 1);

        db.set_article_read("art-g1", true).expect("mark read");
        db.set_article_saved("art-g1", true).expect("mark saved");

        let refreshed = sample_parsed("Example", "g1");
        let inserted_again = db
            .update_feed_sync_result(&feed.id, &refreshed.items, None, None, None, None)
            .expect("sync");
        assert_eq!(inserted_again, 0);

        let detail = db.get_article("art-g1").expect("detail");
        assert!(detail.is_read);
        assert!(detail.is_saved);

        let unread = db
            .query_articles(&ArticleQuery {
                scope: "unread".into(),
                feed_id: None,
                search: None,
                limit: 50,
                offset: 0,
            })
            .expect("unread query");
        assert!(unread.is_empty());

        let saved = db
            .query_articles(&ArticleQuery {
                scope: "saved".into(),
                feed_id: None,
                search: None,
                limit: 50,
                offset: 0,
            })
            .expect("saved query");
        assert_eq!(saved.len(), 1);
    }

    #[test]
    fn cascades_delete_and_filters_search() {
        let db = Database::open_in_memory().expect("db");
        let parsed = sample_parsed("Design Log", "post-1");
        let (feed, _) = db
            .upsert_feed_with_articles("f1", &parsed, None, None, None)
            .expect("insert");

        let found = db
            .query_articles(&ArticleQuery {
                scope: "all".into(),
                feed_id: None,
                search: Some("post-1".into()),
                limit: 50,
                offset: 0,
            })
            .expect("search");
        assert_eq!(found.len(), 1);

        db.delete_feed(&feed.id).expect("delete");
        assert!(db.list_feeds().expect("feeds").is_empty());
        assert!(db
            .query_articles(&ArticleQuery {
                scope: "all".into(),
                feed_id: None,
                search: None,
                limit: 50,
                offset: 0,
            })
            .expect("articles")
            .is_empty());
    }
}
