import { useState } from "react";
import { Bookmark, Check, Circle } from "lucide-react";

import type { ArticleSummary } from "../types";
import { formatRelativeTime } from "../lib/format";

interface ArticleRowProps {
  article: ArticleSummary;
  rowIndex: number;
  focused: boolean;
  monochromeImages: boolean;
  onOpen: (article: ArticleSummary, index: number) => void;
  onFocusRow: (index: number) => void;
  onToggleRead: (article: ArticleSummary, index: number) => void;
  onToggleSaved: (article: ArticleSummary, index: number) => void;
}

export function ArticleRow({
  article,
  rowIndex,
  focused,
  monochromeImages,
  onOpen,
  onFocusRow,
  onToggleRead,
  onToggleSaved,
}: ArticleRowProps) {
  const [imageBroken, setImageBroken] = useState(false);
  const relative = formatRelativeTime(article.publishedAt);
  const showImage = Boolean(article.imageUrl) && !imageBroken;

  return (
    <article
      className={`group relative border-b border-[var(--line)] transition-colors ${
        focused ? "bg-[var(--bg-hover)]" : "hover:bg-[var(--bg-hover)]/60"
      }`}
    >
      {focused && (
        <span
          aria-hidden="true"
          className="absolute bottom-3 left-0 top-3 w-0.5 rounded-full bg-[var(--fg)]"
        />
      )}

      <div className="flex items-start gap-4 px-2 py-5 sm:gap-5 sm:px-3">
        <button
          type="button"
          data-article-index={rowIndex}
          onClick={() => onOpen(article, rowIndex)}
          onFocus={() => onFocusRow(rowIndex)}
          className="min-w-0 flex-1 text-left focus:outline-none"
        >
          <div className="mb-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-[var(--fg-muted)]">
            {!article.isRead && (
              <span
                aria-label="Unread"
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--fg)]"
              />
            )}
            <span className="truncate font-medium text-[var(--fg-secondary)]">
              {article.feedTitle}
            </span>
            {relative && <span>{relative}</span>}
            <span>{article.readingMinutes} min</span>
          </div>

          <h2
            className={`text-[17px] leading-[1.36] tracking-[-0.015em] line-clamp-2 sm:text-[18px] ${
              article.isRead
                ? "font-normal text-[var(--fg-secondary)]"
                : "font-medium text-[var(--fg)]"
            }`}
          >
            {article.title}
          </h2>

          {article.summary && (
            <p className="mt-1.5 line-clamp-1 text-[14px] leading-[1.5] text-[var(--fg-muted)]">
              {article.summary}
            </p>
          )}
        </button>

        <div className="flex shrink-0 items-center gap-2 pt-1">
          {showImage && (
            <button
              type="button"
              onClick={() => onOpen(article, rowIndex)}
              tabIndex={-1}
              aria-hidden="true"
              className="hidden overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--bg-elevated)] sm:block"
            >
              <img
                src={article.imageUrl!}
                alt=""
                loading="lazy"
                onError={() => setImageBroken(true)}
                className={`h-[64px] w-[92px] object-cover ${
                  monochromeImages ? "mono-thumb" : ""
                }`}
              />
            </button>
          )}

          <div className="flex flex-col gap-1 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSaved(article, rowIndex);
              }}
              title={article.isSaved ? "Remove bookmark (s)" : "Save for later (s)"}
              aria-label={article.isSaved ? "Remove bookmark" : "Save for later"}
              aria-pressed={article.isSaved}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                article.isSaved
                  ? "text-[var(--fg)] opacity-100"
                  : "text-[var(--fg-muted)] hover:bg-[var(--bg-active)] hover:text-[var(--fg)]"
              }`}
            >
              <Bookmark
                className="h-4 w-4"
                strokeWidth={1.7}
                fill={article.isSaved ? "currentColor" : "none"}
              />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleRead(article, rowIndex);
              }}
              title={article.isRead ? "Mark as unread (m)" : "Mark as read (m)"}
              aria-label={article.isRead ? "Mark as unread" : "Mark as read"}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-active)] hover:text-[var(--fg)]"
            >
              {article.isRead ? (
                <Circle className="h-3.5 w-3.5" strokeWidth={1.8} />
              ) : (
                <Check className="h-4 w-4" strokeWidth={1.8} />
              )}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
