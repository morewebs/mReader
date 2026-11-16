import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  FileText,
  Loader2,
  Type,
} from "lucide-react";

import type {
  ArticleDetail,
  ReaderFontFamily,
  ReaderFontSize,
  ReaderSettings,
} from "../types";
import { formatFullDate, getHostLabel } from "../lib/format";
import { openExternalUrl } from "../lib/api";

interface ReaderSheetProps {
  article: ArticleDetail;
  settings: ReaderSettings;
  hasPrev: boolean;
  hasNext: boolean;
  hasNextUnread: boolean;
  isExtracting: boolean;
  extractError: string | null;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleRead: () => void;
  onToggleSaved: () => void;
  onFetchFullArticle: () => void;
  onUpdateSettings: (next: ReaderSettings) => void;
  onNextUnread: () => void;
}

const SIZE_MAP: Record<ReaderFontSize, string> = {
  sm: "16.5px",
  md: "18.5px",
  lg: "20.5px",
};

export function ReaderSheet({
  article,
  settings,
  hasPrev,
  hasNext,
  hasNextUnread,
  isExtracting,
  extractError,
  onClose,
  onPrev,
  onNext,
  onToggleRead,
  onToggleSaved,
  onFetchFullArticle,
  onUpdateSettings,
  onNextUnread,
}: ReaderSheetProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [showAppearance, setShowAppearance] = useState(false);
  const [preferFull, setPreferFull] = useState(Boolean(article.extractedHtml));

  useEffect(() => {
    setPreferFull(Boolean(article.extractedHtml));
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      scrollRef.current.focus({ preventScroll: true });
    }
    setProgress(0);
  }, [article.id, article.extractedHtml]);

  // Close the typography popover on Escape before closing the reader itself.
  useEffect(() => {
    if (!showAppearance) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setShowAppearance(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [showAppearance]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 0) {
      setProgress(100);
      return;
    }
    setProgress(Math.min(100, Math.max(0, (el.scrollTop / maxScroll) * 100)));
  };

  const handleProseClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest("a");
    if (!target) return;
    const href = target.getAttribute("href");
    if (!href) return;
    e.preventDefault();
    void openExternalUrl(href);
  };

  const handleFullToggle = () => {
    if (article.extractedHtml) {
      setPreferFull((prev) => !prev);
      return;
    }
    setPreferFull(true);
    onFetchFullArticle();
  };

  const activeHtml =
    preferFull && article.extractedHtml ? article.extractedHtml : article.contentHtml;
  const host = getHostLabel(article.url);
  const fontClass =
    settings.fontFamily === "serif" ? "font-editorial" : "font-ui";

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-[var(--bg)]"
      role="dialog"
      aria-modal="true"
      aria-label={article.title}
    >
      {/* Subtle 1.5px reading progress hairline */}
      <div className="h-[2px] w-full bg-[var(--line)]">
        <div
          className="h-full bg-[var(--fg)] transition-[width] duration-100"
          style={{ width: `${progress}%` }}
        />
      </div>

      <header className="safe-top shrink-0 border-b border-[var(--line)] bg-[var(--bg-backdrop)] backdrop-blur-md">
        <div className="flex h-14 w-full items-center justify-between gap-2 px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              title="Back to stream (Esc)"
              aria-label="Back to stream"
              className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13.5px] font-medium text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={1.8} />
              <span className="hidden sm:inline">Back</span>
            </button>
            <span className="truncate text-[13px] text-[var(--fg-muted)]">
              {article.feedTitle}
            </span>
          </div>

          <div className="relative flex items-center gap-1">
            <button
              type="button"
              onClick={onPrev}
              disabled={!hasPrev}
              title="Previous story (k / ←)"
              aria-label="Previous story"
              className="hidden h-9 w-8 items-center justify-center rounded-lg text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] disabled:opacity-30 sm:flex"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
            </button>

            <button
              type="button"
              onClick={onNext}
              disabled={!hasNext}
              title="Next story (j / →)"
              aria-label="Next story"
              className="hidden h-9 w-8 items-center justify-center rounded-lg text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] disabled:opacity-30 sm:flex"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.8} />
            </button>

            {article.url && (
              <button
                type="button"
                onClick={handleFullToggle}
                disabled={isExtracting}
                aria-pressed={preferFull && Boolean(article.extractedHtml)}
                title="Load full article text (f)"
                className={`flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors ${
                  preferFull && article.extractedHtml
                    ? "bg-[var(--bg-active)] text-[var(--fg)]"
                    : "text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
                }`}
              >
                {isExtracting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileText className="h-3.5 w-3.5" strokeWidth={1.8} />
                )}
                <span className="hidden sm:inline">
                  {preferFull && article.extractedHtml ? "Feed view" : "Full text"}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={onToggleSaved}
              title={article.isSaved ? "Remove bookmark (s)" : "Save for later (s)"}
              aria-label={article.isSaved ? "Remove bookmark" : "Save for later"}
              aria-pressed={article.isSaved}
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                article.isSaved
                  ? "text-[var(--fg)]"
                  : "text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
              }`}
            >
              <Bookmark
                className="h-4 w-4"
                strokeWidth={1.8}
                fill={article.isSaved ? "currentColor" : "none"}
              />
            </button>

            <button
              type="button"
              onClick={onToggleRead}
              title={article.isRead ? "Mark as unread (m)" : "Mark as read (m)"}
              aria-label={article.isRead ? "Mark as unread" : "Mark as read"}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
            >
              {article.isRead ? (
                <Circle className="h-4 w-4" strokeWidth={1.8} />
              ) : (
                <Check className="h-4 w-4" strokeWidth={1.8} />
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowAppearance((prev) => !prev)}
              title="Typography and theme"
              aria-label="Typography and theme"
              aria-expanded={showAppearance}
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                showAppearance
                  ? "bg-[var(--bg-active)] text-[var(--fg)]"
                  : "text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
              }`}
            >
              <Type className="h-4 w-4" strokeWidth={1.8} />
            </button>

            {article.url && (
              <button
                type="button"
                onClick={() => void openExternalUrl(article.url!)}
                title="Open original article (o)"
                aria-label="Open original article in browser"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
              >
                <ArrowUpRight className="h-4 w-4" strokeWidth={1.8} />
              </button>
            )}

            {showAppearance && (
              <div className="absolute right-0 top-11 z-50 w-64 rounded-2xl border border-[var(--line-strong)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-sheet)]">
                <div className="space-y-4">
                  <div>
                    <div className="mb-2 text-[12px] font-medium text-[var(--fg-muted)]">
                      Typeface
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(["serif", "sans"] as ReaderFontFamily[]).map((fam) => (
                        <button
                          key={fam}
                          type="button"
                          onClick={() => onUpdateSettings({ ...settings, fontFamily: fam })}
                          className={`rounded-lg border py-1.5 text-[13px] font-medium transition-colors ${
                            settings.fontFamily === fam
                              ? "border-[var(--pill-bg)] bg-[var(--pill-bg)] text-[var(--pill-fg)]"
                              : "border-[var(--line)] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]"
                          }`}
                        >
                          {fam === "serif" ? "Serif" : "Sans"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-[12px] font-medium text-[var(--fg-muted)]">
                      Size
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(["sm", "md", "lg"] as ReaderFontSize[]).map((sz) => (
                        <button
                          key={sz}
                          type="button"
                          onClick={() => onUpdateSettings({ ...settings, fontSize: sz })}
                          className={`rounded-lg border py-1.5 text-[12.5px] font-medium transition-colors ${
                            settings.fontSize === sz
                              ? "border-[var(--pill-bg)] bg-[var(--pill-bg)] text-[var(--pill-fg)]"
                              : "border-[var(--line)] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]"
                          }`}
                        >
                          {sz === "sm" ? "Small" : sz === "md" ? "Medium" : "Large"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-[12px] font-medium text-[var(--fg-muted)]">
                      Surface
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(["ink", "paper"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => onUpdateSettings({ ...settings, theme: t })}
                          className={`rounded-lg border py-1.5 text-[12.5px] font-medium transition-colors ${
                            settings.theme === t
                              ? "border-[var(--pill-bg)] bg-[var(--pill-bg)] text-[var(--pill-fg)]"
                              : "border-[var(--line)] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]"
                          }`}
                        >
                          {t === "ink" ? "Ink" : "Paper"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[12.5px] text-[var(--fg-secondary)]">
                      Monochrome photos
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings.monochromeImages}
                      onClick={() =>
                        onUpdateSettings({
                          ...settings,
                          monochromeImages: !settings.monochromeImages,
                        })
                      }
                      className={`flex h-6 w-11 items-center rounded-full border p-0.5 transition-colors ${
                        settings.monochromeImages
                          ? "justify-end border-[var(--pill-bg)] bg-[var(--pill-bg)]"
                          : "justify-start border-[var(--line-strong)] bg-[var(--bg)]"
                      }`}
                    >
                      <span
                        className={`h-4 w-4 rounded-full ${
                          settings.monochromeImages ? "bg-[var(--pill-fg)]" : "bg-[var(--fg-muted)]"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <div
        ref={scrollRef}
        tabIndex={-1}
        onScroll={handleScroll}
        onClick={() => showAppearance && setShowAppearance(false)}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-10 focus:outline-none sm:px-8 sm:py-14"
      >
        <article className="mx-auto max-w-[64ch]">
          <header className="mb-9 border-b border-[var(--line)] pb-7">
            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--fg-muted)]">
              <span className="font-medium text-[var(--fg-secondary)]">
                {article.feedTitle}
              </span>
              {host && <span>{host}</span>}
              <span>{formatFullDate(article.publishedAt)}</span>
              <span>{article.readingMinutes} min read</span>
            </div>

            <h1
              className={`${fontClass} text-[28px] font-semibold leading-[1.18] tracking-[-0.028em] text-[var(--fg)] sm:text-[36px]`}
            >
              {article.title}
            </h1>

            {article.author && (
              <p className="mt-4 text-[14px] text-[var(--fg-secondary)]">
                By {article.author}
              </p>
            )}
          </header>

          {extractError && (
            <div className="mb-6 rounded-xl border border-[var(--line-strong)] bg-[var(--bg-elevated)] px-4 py-3 text-[13.5px] text-[var(--fg-secondary)]">
              Could not extract full page text ({extractError}). Showing feed content instead.
            </div>
          )}

          {activeHtml ? (
            <div
              onClick={handleProseClick}
              style={{ ["--reader-font-size" as string]: SIZE_MAP[settings.fontSize] }}
              className={`reader-prose ${fontClass} ${
                settings.monochromeImages ? "mono-media" : ""
              }`}
              dangerouslySetInnerHTML={{ __html: activeHtml }}
            />
          ) : (
            <div className="py-6 text-[15px] leading-[1.7] text-[var(--fg-secondary)]">
              <p>{article.summary || "This feed entry did not include article text."}</p>
              {article.url && (
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleFullToggle}
                    className="h-9 rounded-full bg-[var(--pill-bg)] px-4 text-[13px] font-medium text-[var(--pill-fg)]"
                  >
                    Load full article
                  </button>
                  <button
                    type="button"
                    onClick={() => void openExternalUrl(article.url!)}
                    className="h-9 rounded-full border border-[var(--line)] px-4 text-[13px] text-[var(--fg)]"
                  >
                    Open in browser
                  </button>
                </div>
              )}
            </div>
          )}

          <footer className="safe-bottom mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-7">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-10 rounded-full border border-[var(--line)] px-4 text-[13px] font-medium text-[var(--fg-secondary)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
              >
                Back to stream
              </button>
              {hasPrev && (
                <button
                  type="button"
                  onClick={onPrev}
                  className="flex h-10 items-center gap-1.5 rounded-full border border-[var(--line)] px-4 text-[13px] font-medium text-[var(--fg-secondary)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
                >
                  <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
                  <span>Previous</span>
                </button>
              )}
            </div>

            {hasNextUnread ? (
              <button
                type="button"
                onClick={onNextUnread}
                className="flex h-10 items-center gap-2 rounded-full bg-[var(--pill-bg)] px-5 text-[13px] font-medium text-[var(--pill-fg)] transition-opacity hover:opacity-90"
              >
                <span>Next unread</span>
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            ) : (
              hasNext && (
                <button
                  type="button"
                  onClick={onNext}
                  className="flex h-10 items-center gap-2 rounded-full bg-[var(--pill-bg)] px-5 text-[13px] font-medium text-[var(--pill-fg)] transition-opacity hover:opacity-90"
                >
                  <span>Next story</span>
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              )
            )}
          </footer>
        </article>
      </div>
    </div>
  );
}
