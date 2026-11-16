use std::collections::HashSet;

use scraper::{ElementRef, Html, Selector};

use crate::error::AppError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractedArticle {
    pub content_html: String,
    pub summary: String,
    pub reading_minutes: i64,
    pub lead_image: Option<String>,
}

const BOILERPLATE_TERMS: &[&str] = &[
    "sidebar",
    "footer",
    "navbar",
    "nav-",
    "menu",
    "cookie",
    "consent",
    "newsletter",
    "subscribe",
    "social",
    "share-buttons",
    "comment",
    "disqus",
    "related-post",
    "recommended",
    "breadcrumb",
    "promo",
    "advert",
    "sponsor",
    "popup",
    "modal",
];

const POSITIVE_CLASS_TERMS: &[&str] = &[
    "article-body",
    "article-content",
    "entry-content",
    "post-content",
    "post-body",
    "story-body",
    "prose",
    "markdown-body",
    "content-body",
];

pub fn sanitize_article_html(raw_html: &str, base_url: Option<&str>) -> String {
    let mut builder = ammonia::Builder::default();
    let tags: HashSet<&str> = [
        "p",
        "br",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "blockquote",
        "pre",
        "code",
        "em",
        "strong",
        "b",
        "i",
        "u",
        "s",
        "del",
        "a",
        "ul",
        "ol",
        "li",
        "dl",
        "dt",
        "dd",
        "img",
        "figure",
        "figcaption",
        "hr",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
        "sup",
        "sub",
        "span",
        "div",
        "section",
    ]
    .into_iter()
    .collect();
    builder.tags(tags);

    let mut tag_attrs = std::collections::HashMap::new();
    tag_attrs.insert("a", ["href", "title"].into_iter().collect());
    tag_attrs.insert(
        "img",
        ["src", "alt", "title", "width", "height"]
            .into_iter()
            .collect(),
    );
    tag_attrs.insert("th", ["colspan", "rowspan"].into_iter().collect());
    tag_attrs.insert("td", ["colspan", "rowspan"].into_iter().collect());
    builder.tag_attributes(tag_attrs);

    builder.link_rel(Some("noopener noreferrer"));

    if let Some(base) = base_url {
        if let Ok(parsed) = ammonia::Url::parse(base) {
            builder.url_relative(ammonia::UrlRelative::RewriteWithBase(parsed));
        }
    }

    builder.clean(raw_html).to_string()
}

pub fn html_to_plain_text(html: &str) -> String {
    let fragment = Html::parse_fragment(html);
    let mut out = String::new();
    for text in fragment.root_element().text() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            if !out.is_empty() {
                out.push(' ');
            }
            out.push_str(trimmed);
        }
    }
    collapse_whitespace(&out)
}

pub fn make_summary(html_or_text: &str, max_chars: usize) -> String {
    let plain = html_to_plain_text(html_or_text);
    if plain.is_empty() {
        return String::new();
    }
    let char_count = plain.chars().count();
    if char_count <= max_chars {
        return plain;
    }
    let mut cut: String = plain.chars().take(max_chars).collect();
    if let Some(last_space) = cut.rfind(' ') {
        if last_space > max_chars / 2 {
            cut.truncate(last_space);
        }
    }
    cut.push('…');
    cut
}

pub fn estimate_reading_minutes(text: &str) -> i64 {
    let words = text.split_whitespace().count();
    ((words as f64) / 220.0).ceil().clamp(1.0, 120.0) as i64
}

pub fn first_content_image(html: &str, base_url: Option<&str>) -> Option<String> {
    let fragment = Html::parse_fragment(html);
    let sel = Selector::parse("img").ok()?;
    for img in fragment.select(&sel) {
        let src = img.value().attr("src")?.trim();
        if src.is_empty() || src.starts_with("data:") || is_tracking_image(src, &img) {
            continue;
        }
        if let Some(resolved) = resolve_url(src, base_url) {
            return Some(resolved);
        }
    }
    None
}

pub fn resolve_url(raw: &str, base: Option<&str>) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(parsed) = url::Url::parse(trimmed) {
        if matches!(parsed.scheme(), "http" | "https") {
            return Some(parsed.to_string());
        }
        return None;
    }
    let base_url = base.and_then(|b| url::Url::parse(b).ok())?;
    let joined = base_url.join(trimmed).ok()?;
    if matches!(joined.scheme(), "http" | "https") {
        Some(joined.to_string())
    } else {
        None
    }
}

pub fn extract_article_html(html: &str, page_url: &str) -> Result<ExtractedArticle, AppError> {
    let document = Html::parse_document(html);
    let candidate_sel = Selector::parse("article, main, [role='main'], section, div")
        .map_err(|e| AppError::Internal(format!("Invalid selector: {e:?}")))?;

    let mut best_score = 0.0f64;
    let mut best_html: Option<String> = None;

    for el in document.select(&candidate_sel) {
        if has_boilerplate_marker(&el) {
            continue;
        }
        let score = score_candidate(&el);
        if score > best_score {
            best_score = score;
            best_html = Some(strip_nested_boilerplate_html(&el));
        }
    }

    let raw_extracted = match best_html {
        Some(h) if best_score >= 45.0 => h,
        _ => fallback_paragraphs_html(&document),
    };

    let sanitized = sanitize_article_html(&raw_extracted, Some(page_url));
    let plain = html_to_plain_text(&sanitized);
    if plain.split_whitespace().count() < 15 {
        return Err(AppError::Internal(
            "Could not extract readable article body from this page".into(),
        ));
    }

    let summary = make_summary(&plain, 220);
    let reading_minutes = estimate_reading_minutes(&plain);
    let lead_image = first_content_image(&sanitized, Some(page_url));

    Ok(ExtractedArticle {
        content_html: sanitized,
        summary,
        reading_minutes,
        lead_image,
    })
}

fn score_candidate(el: &ElementRef<'_>) -> f64 {
    let tag = el.value().name();
    let mut score = match tag {
        "article" => 360.0,
        "main" => 220.0,
        "section" => 40.0,
        _ => 0.0,
    };

    if el.value().attr("role") == Some("main") {
        score += 220.0;
    }

    let id_class = format!(
        "{} {}",
        el.value().attr("id").unwrap_or_default(),
        el.value().attr("class").unwrap_or_default()
    )
    .to_lowercase();

    if POSITIVE_CLASS_TERMS.iter().any(|t| id_class.contains(t)) {
        score += 240.0;
    }

    let p_sel = match Selector::parse("p") {
        Ok(s) => s,
        Err(_) => return score,
    };
    let a_sel = match Selector::parse("a") {
        Ok(s) => s,
        Err(_) => return score,
    };

    let mut paragraph_chars = 0usize;
    let mut paragraph_count = 0usize;
    let mut comma_bonus = 0usize;

    for p in el.select(&p_sel) {
        if has_boilerplate_ancestor(&p, el) {
            continue;
        }
        let text = collapse_whitespace(&p.text().collect::<Vec<_>>().join(" "));
        let len = text.chars().count();
        if len >= 25 {
            paragraph_chars += len;
            paragraph_count += 1;
            comma_bonus += text.matches(',').count();
        }
    }

    if paragraph_chars == 0 {
        return 0.0;
    }

    let total_text_len = collapse_whitespace(&el.text().collect::<Vec<_>>().join(" "))
        .chars()
        .count()
        .max(1);
    let link_text_len: usize = el
        .select(&a_sel)
        .map(|a| a.text().collect::<String>().chars().count())
        .sum();
    let link_density = (link_text_len as f64) / (total_text_len as f64);

    let text_score = (paragraph_chars as f64).min(8000.0) * 0.25
        + (paragraph_count as f64) * 18.0
        + (comma_bonus as f64) * 6.0;

    let penalty = if link_density > 0.45 {
        0.15
    } else if link_density > 0.25 {
        0.65
    } else {
        1.0
    };

    (score + text_score) * penalty
}

fn has_boilerplate_marker(el: &ElementRef<'_>) -> bool {
    let tag = el.value().name();
    if matches!(
        tag,
        "nav" | "footer" | "aside" | "header" | "form" | "dialog" | "script" | "style" | "noscript"
    ) {
        return true;
    }
    let marker = format!(
        "{} {}",
        el.value().attr("id").unwrap_or_default(),
        el.value().attr("class").unwrap_or_default()
    )
    .to_lowercase();

    BOILERPLATE_TERMS.iter().any(|term| marker.contains(term))
}

fn has_boilerplate_ancestor(node: &ElementRef<'_>, stop_at: &ElementRef<'_>) -> bool {
    let mut current = node.parent();
    while let Some(parent) = current {
        if parent.id() == stop_at.id() {
            break;
        }
        if let Some(el) = ElementRef::wrap(parent) {
            if has_boilerplate_marker(&el) {
                return true;
            }
        }
        current = parent.parent();
    }
    false
}

fn strip_nested_boilerplate_html(container: &ElementRef<'_>) -> String {
    let inner = container.inner_html();
    let fragment = Html::parse_fragment(&inner);
    let block_sel = match Selector::parse(
        "p, h1, h2, h3, h4, h5, h6, blockquote, pre, ul, ol, figure, table, hr",
    ) {
        Ok(s) => s,
        Err(_) => return inner,
    };

    let mut chunks = Vec::new();
    for el in fragment.select(&block_sel) {
        // Only emit top-level blocks relative to fragment root or non-nested inside another emitted block
        let parent_is_block = el.ancestors().skip(1).any(|anc| {
            ElementRef::wrap(anc).is_some_and(|p| {
                matches!(
                    p.value().name(),
                    "p" | "blockquote" | "pre" | "ul" | "ol" | "figure" | "table"
                )
            })
        });
        if parent_is_block {
            continue;
        }
        let in_boilerplate = el
            .ancestors()
            .any(|anc| ElementRef::wrap(anc).is_some_and(|p| has_boilerplate_marker(&p)));
        if in_boilerplate || has_boilerplate_marker(&el) {
            continue;
        }
        chunks.push(el.html());
    }

    if chunks.is_empty() {
        inner
    } else {
        chunks.join("\n")
    }
}

fn fallback_paragraphs_html(document: &Html) -> String {
    let Ok(sel) = Selector::parse("p, h1, h2, h3, blockquote, pre") else {
        return String::new();
    };
    let mut out = Vec::new();
    for el in document.select(&sel) {
        let in_boilerplate = el
            .ancestors()
            .any(|anc| ElementRef::wrap(anc).is_some_and(|p| has_boilerplate_marker(&p)));
        if in_boilerplate {
            continue;
        }
        let text = collapse_whitespace(&el.text().collect::<Vec<_>>().join(" "));
        if text.chars().count() >= 25 || el.value().name().starts_with('h') {
            out.push(el.html());
        }
    }
    out.join("\n")
}

fn is_tracking_image(src: &str, img: &ElementRef<'_>) -> bool {
    let lower = src.to_lowercase();
    if lower.contains("feedburner.com/~r/")
        || lower.contains("pixel.")
        || lower.contains("/1x1")
        || lower.contains("spacer.gif")
    {
        return true;
    }
    matches!(img.value().attr("width"), Some("1" | "0"))
        || matches!(img.value().attr("height"), Some("1" | "0"))
}

fn collapse_whitespace(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_main_article_strips_scripts_and_resolves_relative_urls() {
        let html = r#"
        <!doctype html>
        <html>
          <body>
            <header><nav><a href="/home">Home</a><a href="/about">About</a></nav></header>
            <aside class="sidebar">
              <a href="/1">Link 1</a><a href="/2">Link 2</a><a href="/3">Link 3</a>
            </aside>
            <article>
              <h1>Calm Reading Systems</h1>
              <p>Designing software that respects attention starts by removing visual clutter and noisy chrome from every screen.</p>
              <p>When typography carries the hierarchy, readers stay focused on ideas rather than scanning dense toolbars and unread counts.</p>
              <figure>
                <img src="/assets/diagram.png" alt="Layout diagram"/>
              </figure>
              <script>window.evil = true;</script>
              <div class="newsletter-box"><p>Subscribe to our daily newsletter right now!</p></div>
            </article>
            <footer><p>Copyright 2026</p></footer>
          </body>
        </html>"#;

        let extracted =
            extract_article_html(html, "https://journal.example/posts/calm").expect("extract");
        assert!(extracted.content_html.contains("Calm Reading Systems"));
        assert!(extracted
            .content_html
            .contains("https://journal.example/assets/diagram.png"));
        assert!(!extracted.content_html.contains("window.evil"));
        assert!(!extracted.content_html.contains("Subscribe to our daily"));
        assert!(!extracted.content_html.contains("Copyright 2026"));
        assert_eq!(
            extracted.lead_image.as_deref(),
            Some("https://journal.example/assets/diagram.png")
        );
        assert!(extracted.reading_minutes >= 1);
    }

    #[test]
    fn sanitizes_xss_payloads_from_feed_html() {
        let dirty = r#"<p>Hello <a href="javascript:alert(1)" onclick="hack()">bad</a> <a href="/good">good</a></p><script>alert(1)</script><img src="https://img.example/pic.jpg" onerror="alert(2)">"#;
        let clean = sanitize_article_html(dirty, Some("https://site.example/post"));
        assert!(!clean.contains("script"));
        assert!(!clean.contains("javascript:"));
        assert!(!clean.contains("onclick"));
        assert!(!clean.contains("onerror"));
        assert!(clean.contains("https://site.example/good"));
        assert!(clean.contains("https://img.example/pic.jpg"));
    }
}
