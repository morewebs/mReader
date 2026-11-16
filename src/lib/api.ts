import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";

import type {
  ArticleDetail,
  ArticleSummary,
  Feed,
  OpmlImportSummary,
  ReaderSettings,
  RefreshSummary,
  StreamScope,
  ThemePolarity,
  UpdateCheckResult,
  UpdateProgressEvent,
} from "../types";
import { DEFAULT_SETTINGS } from "../types";

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)
  );
}

export async function syncWindowTheme(theme: ThemePolarity): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await getCurrentWindow().setTheme(theme === "ink" ? "dark" : "light");
  } catch {
    // Mobile or unsupported desktop environments ignore window theme updates cleanly.
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriRuntime()) {
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

// Browser-only preview state so `npm run dev` in a web browser works cleanly without Tauri IPC.
const previewNow = Date.now();
const INITIAL_PREVIEW_FEEDS: Feed[] = [
  {
    id: "preview-1",
    url: "https://simonwillison.net/atom/everything/",
    siteUrl: "https://simonwillison.net",
    title: "Simon Willison's Weblog",
    description: "Notes on software, SQLite, and engineering tools",
    folder: "Engineering",
    etag: null,
    lastModified: null,
    lastFetchedAt: new Date(previewNow - 18 * 60_000).toISOString(),
    lastError: null,
    unreadCount: 2,
    createdAt: new Date(previewNow - 7 * 86_400_000).toISOString(),
  },
  {
    id: "preview-2",
    url: "https://www.smashingmagazine.com/feed/",
    siteUrl: "https://www.smashingmagazine.com",
    title: "Smashing Magazine",
    description: "Interface design and typography",
    folder: "Design",
    etag: null,
    lastModified: null,
    lastFetchedAt: new Date(previewNow - 2 * 3600_000).toISOString(),
    lastError: null,
    unreadCount: 1,
    createdAt: new Date(previewNow - 10 * 86_400_000).toISOString(),
  },
];

const INITIAL_PREVIEW_ARTICLES: ArticleDetail[] = [
  {
    id: "pa-1",
    feedId: "preview-1",
    feedTitle: "Simon Willison's Weblog",
    url: "https://simonwillison.net",
    title: "Designing interfaces that stay quiet while you think",
    author: "Simon Willison",
    summary: "Removing badges, side-by-side panes, and redundant chrome restores focus to long-form reading.",
    contentHtml:
      "<p>Most feed readers turn curiosity into an inbox chore. When every source shouts an unread counter and every headline competes inside a cramped three-column grid, reading stops feeling restorative.</p><h2>Why restraint scales better than density</h2><p>A single generous reading column lets typography carry hierarchy through weight, spacing, and luminance rather than boxes and borders. You scan headlines naturally and commit to one piece at a time.</p><blockquote><p>Whitespace is not empty space; it is the structure that lets the eye rest between thoughts.</p></blockquote><p>Local-first storage in SQLite means opening an article is instantaneous across desktop and mobile, even offline.</p>",
    extractedHtml: null,
    imageUrl: null,
    publishedAt: new Date(previewNow - 45 * 60_000).toISOString(),
    fetchedAt: new Date(previewNow - 18 * 60_000).toISOString(),
    readingMinutes: 4,
    isRead: false,
    isSaved: true,
  },
  {
    id: "pa-2",
    feedId: "preview-2",
    feedTitle: "Smashing Magazine",
    url: "https://www.smashingmagazine.com",
    title: "Monochrome hierarchy: luminance, hairlines, and typographic scale",
    author: "Elena Vance",
    summary: "Without hue to fall back on, contrast ratios and vertical rhythm do all the heavy lifting.",
    contentHtml:
      "<p>Stripping color out of a reading instrument forces every state transition to earn its keep through contrast, scale, and quiet geometry.</p><p>An unread article stands forward through high-contrast ink; once read, its headline recedes softly so finished items never distract from what remains.</p>",
    extractedHtml: null,
    imageUrl: null,
    publishedAt: new Date(previewNow - 27 * 3600_000).toISOString(),
    fetchedAt: new Date(previewNow - 2 * 3600_000).toISOString(),
    readingMinutes: 6,
    isRead: false,
    isSaved: false,
  },
  {
    id: "pa-3",
    feedId: "preview-1",
    feedTitle: "Simon Willison's Weblog",
    url: "https://simonwillison.net",
    title: "Local-first SQLite sync patterns for cross-platform apps",
    author: "Simon Willison",
    summary: "Conditional HTTP requests with ETag and Last-Modified keep background refreshes near-zero cost.",
    contentHtml:
      "<p>Conditional GET headers let desktop and mobile clients poll dozens of feeds in under a second while transferring almost no redundant bytes.</p><pre><code>If-None-Match: \"v1-feed-etag\"</code></pre><p>Combined with transactional SQLite upserts, your read and saved states survive every refresh cleanly.</p>",
    extractedHtml: null,
    imageUrl: null,
    publishedAt: new Date(previewNow - 3 * 86_400_000).toISOString(),
    fetchedAt: new Date(previewNow - 3 * 86_400_000).toISOString(),
    readingMinutes: 5,
    isRead: true,
    isSaved: false,
  },
];

let previewFeeds: Feed[] = INITIAL_PREVIEW_FEEDS.map((f) => ({ ...f }));
let previewArticles: ArticleDetail[] = INITIAL_PREVIEW_ARTICLES.map((a) => ({ ...a }));
let previewSettings: ReaderSettings = { ...DEFAULT_SETTINGS };

export function resetPreviewState(): void {
  previewFeeds = INITIAL_PREVIEW_FEEDS.map((f) => ({ ...f }));
  previewArticles = INITIAL_PREVIEW_ARTICLES.map((a) => ({ ...a }));
  previewSettings = { ...DEFAULT_SETTINGS };
}

function recomputePreviewCounts() {
  previewFeeds = previewFeeds.map((f) => ({
    ...f,
    unreadCount: previewArticles.filter((a) => a.feedId === f.id && !a.isRead).length,
  }));
}

export const api = {
  async getFeeds(): Promise<Feed[]> {
    if (isTauriRuntime()) return invoke<Feed[]>("get_feeds");
    recomputePreviewCounts();
    return [...previewFeeds];
  },

  async addFeed(url: string, folder?: string): Promise<Feed> {
    if (isTauriRuntime()) return invoke<Feed>("add_feed", { url, folder: folder || null });
    const id = `preview-${Date.now()}`;
    const feed: Feed = {
      id,
      url,
      siteUrl: url,
      title: url.replace(/^https?:\/\//, "").split("/")[0] || "Feed",
      description: null,
      folder: folder || null,
      etag: null,
      lastModified: null,
      lastFetchedAt: new Date().toISOString(),
      lastError: null,
      unreadCount: 0,
      createdAt: new Date().toISOString(),
    };
    previewFeeds = [...previewFeeds, feed];
    return feed;
  },

  async addStarterFeeds(urls: string[]): Promise<OpmlImportSummary> {
    if (isTauriRuntime()) return invoke<OpmlImportSummary>("add_starter_feeds", { urls });
    for (const u of urls) {
      await api.addFeed(u);
    }
    return { imported: urls.length, skipped: 0, errors: [] };
  },

  async deleteFeed(feedId: string): Promise<void> {
    if (isTauriRuntime()) return invoke<void>("delete_feed", { feedId });
    previewFeeds = previewFeeds.filter((f) => f.id !== feedId);
    previewArticles = previewArticles.filter((a) => a.feedId !== feedId);
  },

  async refreshAllFeeds(): Promise<RefreshSummary> {
    if (isTauriRuntime()) return invoke<RefreshSummary>("refresh_all_feeds");
    return {
      feedsChecked: previewFeeds.length,
      feedsUpdated: 0,
      newArticles: 0,
      errors: [],
    };
  },

  async refreshFeed(feedId: string): Promise<RefreshSummary> {
    if (isTauriRuntime()) return invoke<RefreshSummary>("refresh_feed", { feedId });
    return { feedsChecked: 1, feedsUpdated: 0, newArticles: 0, errors: [] };
  },

  async listArticles(params: {
    scope: StreamScope;
    feedId: string | null;
    search: string;
    limit?: number;
    offset?: number;
  }): Promise<ArticleSummary[]> {
    if (isTauriRuntime()) {
      return invoke<ArticleSummary[]>("list_articles", {
        scope: params.scope,
        feedId: params.feedId,
        search: params.search || null,
        limit: params.limit ?? 150,
        offset: params.offset ?? 0,
      });
    }
    const q = params.search.trim().toLowerCase();
    return previewArticles
      .filter((a) => {
        if (params.scope === "unread" && a.isRead) return false;
        if (params.scope === "saved" && !a.isSaved) return false;
        if (params.feedId && a.feedId !== params.feedId) return false;
        if (
          q &&
          !a.title.toLowerCase().includes(q) &&
          !a.summary.toLowerCase().includes(q) &&
          !a.feedTitle.toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      .map((a) => ({
        id: a.id,
        feedId: a.feedId,
        feedTitle: a.feedTitle,
        url: a.url,
        title: a.title,
        author: a.author,
        summary: a.summary,
        imageUrl: a.imageUrl,
        publishedAt: a.publishedAt,
        readingMinutes: a.readingMinutes,
        isRead: a.isRead,
        isSaved: a.isSaved,
        hasExtracted: a.extractedHtml !== null,
      }));
  },

  async getArticle(articleId: string): Promise<ArticleDetail> {
    if (isTauriRuntime()) return invoke<ArticleDetail>("get_article", { articleId });
    const found = previewArticles.find((a) => a.id === articleId);
    if (!found) throw new Error("Article not found");
    return { ...found };
  },

  async fetchFullArticle(articleId: string): Promise<ArticleDetail> {
    if (isTauriRuntime()) return invoke<ArticleDetail>("fetch_full_article", { articleId });
    const found = previewArticles.find((a) => a.id === articleId);
    if (!found) throw new Error("Article not found");
    found.extractedHtml =
      found.extractedHtml ??
      `${found.contentHtml}<p>Full article content extracted cleanly in reader mode without navigation chrome or clutter.</p>`;
    return { ...found };
  },

  async setArticleRead(articleId: string, isRead: boolean): Promise<void> {
    if (isTauriRuntime()) return invoke<void>("set_article_read", { articleId, isRead });
    previewArticles = previewArticles.map((a) => (a.id === articleId ? { ...a, isRead } : a));
  },

  async setArticleSaved(articleId: string, isSaved: boolean): Promise<void> {
    if (isTauriRuntime()) return invoke<void>("set_article_saved", { articleId, isSaved });
    previewArticles = previewArticles.map((a) => (a.id === articleId ? { ...a, isSaved } : a));
  },

  async markAllRead(feedId: string | null): Promise<number> {
    if (isTauriRuntime()) return invoke<number>("mark_all_read", { feedId });
    let count = 0;
    previewArticles = previewArticles.map((a) => {
      if (!a.isRead && (!feedId || a.feedId === feedId)) {
        count += 1;
        return { ...a, isRead: true };
      }
      return a;
    });
    return count;
  },

  async importOpml(xml: string): Promise<OpmlImportSummary> {
    if (isTauriRuntime()) return invoke<OpmlImportSummary>("import_opml", { xml });
    return { imported: 0, skipped: 0, errors: [] };
  },

  async exportOpml(): Promise<string> {
    if (isTauriRuntime()) return invoke<string>("export_opml");
    return `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head><title>mReader Subscriptions</title></head><body></body></opml>`;
  },

  async getSettings(): Promise<ReaderSettings> {
    if (isTauriRuntime()) return invoke<ReaderSettings>("get_settings");
    return { ...previewSettings };
  },

  async saveSettings(settings: ReaderSettings): Promise<void> {
    if (isTauriRuntime()) return invoke<void>("save_settings", { settings });
    previewSettings = { ...settings };
  },

  async getAppVersion(): Promise<string> {
    if (isTauriRuntime()) return invoke<string>("get_app_version");
    return "0.1.0";
  },

  async checkForUpdate(): Promise<UpdateCheckResult> {
    if (isTauriRuntime()) return invoke<UpdateCheckResult>("check_for_update");
    return { enabled: false, currentVersion: "0.1.0", available: null };
  },

  async installUpdate(): Promise<void> {
    if (isTauriRuntime()) return invoke<void>("install_update");
  },

  async onUpdateProgress(
    handler: (event: UpdateProgressEvent) => void
  ): Promise<() => void> {
    if (!isTauriRuntime()) return () => {};
    return listen<UpdateProgressEvent>("update-progress", (e) => handler(e.payload));
  },
};
