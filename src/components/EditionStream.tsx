import { useEffect, useRef } from "react";
import { CheckCheck } from "lucide-react";

import type { ArticleSummary, StreamScope } from "../types";
import { groupArticlesByDay } from "../lib/format";
import { ArticleRow } from "./ArticleRow";

interface EditionStreamProps {
  articles: ArticleSummary[];
  scope: StreamScope;
  feedTitle: string | null;
  feedCount: number;
  searchQuery: string;
  focusedIndex: number;
  keyboardFocusSignal: number;
  monochromeImages: boolean;
  onOpenArticle: (article: ArticleSummary, index: number) => void;
  onFocusRow: (index: number) => void;
  onToggleRead: (article: ArticleSummary, index: number) => void;
  onToggleSaved: (article: ArticleSummary, index: number) => void;
  onMarkAllRead: () => void;
  onShowEverything: () => void;
  onRefresh: () => void;
  onOpenShortcuts: () => void;
}

const SCOPE_HEADINGS: Record<StreamScope, string> = {
  unread: "Unread",
  all: "Everything",
  saved: "Saved",
};

export function EditionStream({
  articles,
  scope,
  feedTitle,
  feedCount,
  searchQuery,
  focusedIndex,
  keyboardFocusSignal,
  monochromeImages,
  onOpenArticle,
  onFocusRow,
  onToggleRead,
  onToggleSaved,
  onMarkAllRead,
  onShowEverything,
  onRefresh,
  onOpenShortcuts,
}: EditionStreamProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const groups = groupArticlesByDay(articles);
  const unreadInView = articles.filter((a) => !a.isRead).length;
  const heading = feedTitle ?? SCOPE_HEADINGS[scope];

  useEffect(() => {
    if (keyboardFocusSignal === 0 || focusedIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-article-index="${focusedIndex}"]`
    );
    if (!el) return;
    el.focus({ preventScroll: true });
    if (typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focusedIndex, keyboardFocusSignal]);

  let runningIndex = -1;

  return (
    <div ref={listRef} className="mx-auto w-full max-w-[720px] px-4 pb-20 pt-8 sm:px-6 sm:pt-10">
      <div className="mb-6 flex items-end justify-between gap-4 border-b border-[var(--line)] pb-5">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-[var(--fg)] sm:text-[32px]">
            {heading}
          </h1>
          <p className="mt-1 text-[13.5px] text-[var(--fg-muted)]">
            {searchQuery
              ? `${articles.length} matching ${articles.length === 1 ? "story" : "stories"}`
              : articles.length === 0
                ? scope === "unread"
                  ? "Nothing waiting for you"
                  : scope === "saved"
                    ? "No saved articles yet"
                    : "No stories stored yet"
                : `${articles.length} ${articles.length === 1 ? "story" : "stories"} across ${feedCount} ${feedCount === 1 ? "source" : "sources"}`}
          </p>
        </div>

        {unreadInView > 0 && scope !== "saved" && (
          <button
            type="button"
            onClick={onMarkAllRead}
            title="Mark all read (Shift+M)"
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[var(--line)] px-3.5 text-[12.5px] font-medium text-[var(--fg-secondary)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
          >
            <CheckCheck className="h-3.5 w-3.5" strokeWidth={1.8} />
            <span>Mark all read</span>
          </button>
        )}
      </div>

      {articles.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-[16px] font-medium text-[var(--fg)]">
            {searchQuery
              ? "No stories match that query."
              : scope === "unread"
                ? "You are caught up."
                : scope === "saved"
                  ? "Bookmark any article to keep it here."
                  : "No articles available right now."}
          </p>
          <p className="mt-1.5 text-[13.5px] text-[var(--fg-muted)]">
            {scope === "unread" && !searchQuery
              ? "Check for new dispatches or browse earlier reading."
              : "Try another filter or refresh your sources."}
          </p>
          {!searchQuery && (
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={onRefresh}
                className="h-9 rounded-full bg-[var(--pill-bg)] px-4 text-[13px] font-medium text-[var(--pill-fg)] transition-opacity hover:opacity-90"
              >
                Refresh feeds
              </button>
              {scope === "unread" && (
                <button
                  type="button"
                  onClick={onShowEverything}
                  className="h-9 rounded-full border border-[var(--line)] px-4 text-[13px] font-medium text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
                >
                  Browse everything
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <h2 className="px-2 pb-2 text-[12.5px] font-medium text-[var(--fg-muted)] sm:px-3">
                {group.label}
              </h2>
              <div>
                {group.articles.map((article) => {
                  runningIndex += 1;
                  return (
                    <ArticleRow
                      key={article.id}
                      article={article}
                      rowIndex={runningIndex}
                      focused={runningIndex === focusedIndex}
                      monochromeImages={monochromeImages}
                      onOpen={onOpenArticle}
                      onFocusRow={onFocusRow}
                      onToggleRead={onToggleRead}
                      onToggleSaved={onToggleSaved}
                    />
                  );
                })}
              </div>
            </section>
          ))}

          <div className="hidden justify-center pt-4 sm:flex">
            <button
              type="button"
              onClick={onOpenShortcuts}
              className="rounded-lg px-2.5 py-1 text-[12px] text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
            >
              Press ? for keyboard shortcuts
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
