use std::collections::BTreeMap;
use std::io::Cursor;

use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event};
use quick_xml::{Reader, Writer, XmlVersion};

use crate::error::AppError;
use crate::models::Feed;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpmlOutline {
    pub url: String,
    pub title: Option<String>,
    pub site_url: Option<String>,
    pub folder: Option<String>,
}

pub fn parse_opml(xml: &str) -> Result<Vec<OpmlOutline>, AppError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut folder_stack: Vec<Option<String>> = Vec::new();
    let mut outlines: Vec<OpmlOutline> = Vec::new();
    let mut seen_urls = std::collections::HashSet::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) if e.name().as_ref().eq_ignore_ascii_case("outline") => {
                let attrs = extract_outline_attrs(e)?;
                if let Some(url) = attrs.xml_url {
                    if seen_urls.insert(url.clone()) {
                        let current_folder = folder_stack.iter().rev().flatten().next().cloned();
                        outlines.push(OpmlOutline {
                            url,
                            title: attrs.title,
                            site_url: attrs.html_url,
                            folder: current_folder,
                        });
                    }
                    folder_stack.push(None);
                } else {
                    folder_stack.push(attrs.title);
                }
            }
            Ok(Event::Empty(ref e)) if e.name().as_ref().eq_ignore_ascii_case("outline") => {
                let attrs = extract_outline_attrs(e)?;
                if let Some(url) = attrs.xml_url {
                    if seen_urls.insert(url.clone()) {
                        let current_folder = folder_stack.iter().rev().flatten().next().cloned();
                        outlines.push(OpmlOutline {
                            url,
                            title: attrs.title,
                            site_url: attrs.html_url,
                            folder: current_folder,
                        });
                    }
                }
            }
            Ok(Event::End(ref e)) if e.name().as_ref().eq_ignore_ascii_case("outline") => {
                folder_stack.pop();
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(AppError::Opml(format!("Invalid OPML XML: {err}"))),
            _ => {}
        }
    }

    Ok(outlines)
}

pub fn export_opml(feeds: &[Feed]) -> Result<String, AppError> {
    let mut writer = Writer::new_with_indent(Cursor::new(Vec::new()), b' ', 2);
    writer
        .write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))
        .map_err(|e| AppError::Opml(e.to_string()))?;

    let mut opml = BytesStart::new("opml");
    opml.push_attribute(("version", "2.0"));
    writer
        .write_event(Event::Start(opml))
        .map_err(|e| AppError::Opml(e.to_string()))?;

    writer
        .write_event(Event::Start(BytesStart::new("head")))
        .map_err(|e| AppError::Opml(e.to_string()))?;
    writer
        .write_event(Event::Start(BytesStart::new("title")))
        .map_err(|e| AppError::Opml(e.to_string()))?;
    writer
        .write_event(Event::Text(BytesText::new("mReader Subscriptions")))
        .map_err(|e| AppError::Opml(e.to_string()))?;
    writer
        .write_event(Event::End(BytesEnd::new("title")))
        .map_err(|e| AppError::Opml(e.to_string()))?;
    writer
        .write_event(Event::End(BytesEnd::new("head")))
        .map_err(|e| AppError::Opml(e.to_string()))?;

    writer
        .write_event(Event::Start(BytesStart::new("body")))
        .map_err(|e| AppError::Opml(e.to_string()))?;

    let mut grouped: BTreeMap<Option<String>, Vec<&Feed>> = BTreeMap::new();
    for feed in feeds {
        let folder = feed
            .folder
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned);
        grouped.entry(folder).or_default().push(feed);
    }

    for (folder, group_feeds) in grouped {
        if let Some(folder_name) = &folder {
            let mut folder_el = BytesStart::new("outline");
            folder_el.push_attribute(("text", folder_name.as_str()));
            folder_el.push_attribute(("title", folder_name.as_str()));
            writer
                .write_event(Event::Start(folder_el))
                .map_err(|e| AppError::Opml(e.to_string()))?;
        }

        for feed in group_feeds {
            let mut item = BytesStart::new("outline");
            item.push_attribute(("type", "rss"));
            item.push_attribute(("text", feed.title.as_str()));
            item.push_attribute(("title", feed.title.as_str()));
            item.push_attribute(("xmlUrl", feed.url.as_str()));
            if let Some(site_url) = &feed.site_url {
                item.push_attribute(("htmlUrl", site_url.as_str()));
            }
            writer
                .write_event(Event::Empty(item))
                .map_err(|e| AppError::Opml(e.to_string()))?;
        }

        if folder.is_some() {
            writer
                .write_event(Event::End(BytesEnd::new("outline")))
                .map_err(|e| AppError::Opml(e.to_string()))?;
        }
    }

    writer
        .write_event(Event::End(BytesEnd::new("body")))
        .map_err(|e| AppError::Opml(e.to_string()))?;
    writer
        .write_event(Event::End(BytesEnd::new("opml")))
        .map_err(|e| AppError::Opml(e.to_string()))?;

    String::from_utf8(writer.into_inner().into_inner()).map_err(|e| AppError::Opml(e.to_string()))
}

struct OutlineAttrs {
    xml_url: Option<String>,
    html_url: Option<String>,
    title: Option<String>,
}

fn extract_outline_attrs(element: &BytesStart<'_>) -> Result<OutlineAttrs, AppError> {
    let mut xml_url = None;
    let mut html_url = None;
    let mut title = None;
    let mut text = None;

    for attr_res in element.attributes() {
        let attr = attr_res.map_err(|e| AppError::Opml(e.to_string()))?;
        let key = attr.key.as_ref();
        let val = attr
            .normalized_value(XmlVersion::Implicit1_0)
            .map_err(|e| AppError::Opml(e.to_string()))?
            .trim()
            .to_string();
        if val.is_empty() {
            continue;
        }
        if key.eq_ignore_ascii_case("xmlUrl") {
            xml_url = Some(val);
        } else if key.eq_ignore_ascii_case("htmlUrl") {
            html_url = Some(val);
        } else if key.eq_ignore_ascii_case("title") {
            title = Some(val);
        } else if key.eq_ignore_ascii_case("text") {
            text = Some(val);
        }
    }

    Ok(OutlineAttrs {
        xml_url,
        html_url,
        title: title.or(text),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nested_and_flat_opml_with_dedup() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
        <opml version="2.0">
          <head><title>Feeds</title></head>
          <body>
            <outline text="Engineering" title="Engineering">
              <outline type="rss" text="Simon &amp; Notes" xmlUrl="https://example.com/feed.xml" htmlUrl="https://example.com"/>
              <outline type="rss" text="Duplicate" xmlUrl="https://example.com/feed.xml"/>
            </outline>
            <outline type="rss" title="Top Level" xmlUrl="https://top.example/rss"/>
          </body>
        </opml>"#;

        let parsed = parse_opml(xml).expect("valid opml");
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].url, "https://example.com/feed.xml");
        assert_eq!(parsed[0].title.as_deref(), Some("Simon & Notes"));
        assert_eq!(parsed[0].folder.as_deref(), Some("Engineering"));
        assert_eq!(parsed[1].url, "https://top.example/rss");
        assert_eq!(parsed[1].folder, None);
    }

    #[test]
    fn exports_and_roundtrips_opml() {
        let feeds = vec![
            Feed {
                id: "1".into(),
                url: "https://a.example/feed.xml".into(),
                site_url: Some("https://a.example".into()),
                title: "Alpha & Omega".into(),
                description: None,
                folder: Some("Design".into()),
                etag: None,
                last_modified: None,
                last_fetched_at: None,
                last_error: None,
                unread_count: 0,
                created_at: "2026-01-01T00:00:00Z".into(),
            },
            Feed {
                id: "2".into(),
                url: "https://b.example/rss".into(),
                site_url: None,
                title: "Beta".into(),
                description: None,
                folder: None,
                etag: None,
                last_modified: None,
                last_fetched_at: None,
                last_error: None,
                unread_count: 0,
                created_at: "2026-01-01T00:00:00Z".into(),
            },
        ];

        let xml = export_opml(&feeds).expect("export opml");
        let reparsed = parse_opml(&xml).expect("reparse exported opml");
        assert_eq!(reparsed.len(), 2);
        assert!(reparsed
            .iter()
            .any(|o| o.title.as_deref() == Some("Alpha & Omega")
                && o.folder.as_deref() == Some("Design")));
        assert!(reparsed
            .iter()
            .any(|o| o.title.as_deref() == Some("Beta") && o.folder.is_none()));
    }
}
