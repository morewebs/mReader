import { type KeyboardEvent } from "react";
import { AlertCircle, HelpCircle, Rss, Trash2, Upload, X } from "lucide-react";

import type { Feed } from "../types";
import { groupFeedsByFolder } from "../lib/format";

interface SourcesDrawerProps {
  open: boolean;
  onClose: () => void;
  feeds: Feed[];
  selectedFeedId: string | null;
  onSelectFeed: (feedId: string | null) => void;
  onDeleteFeed: (feedId: string) => void;
  onOpenAdd: () => void;
  onOpenShortcuts: () => void;
  appVersion: string;
  checkingUpdate: boolean;
  onCheckUpdate: () => void;
}

export function SourcesDrawer({
  open,
  onClose,
  feeds,
  selectedFeedId,
  onSelectFeed,
  onDeleteFeed,
  onOpenAdd,
  onOpenShortcuts,
  appVersion,
  checkingUpdate,
  onCheckUpdate,
}: SourcesDrawerProps) {
  if (!open) return null;

  const totalUnread = feeds.reduce((sum, f) => sum + f.unreadCount, 0);
  const groups = groupFeedsByFolder(feeds);

  const handleNavKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const target = e.target as HTMLElement | null;
    if (!target?.hasAttribute("data-source-item")) return;

    const buttons = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-source-item='true']")
    );
    const idx = buttons.indexOf(target as HTMLButtonElement);
    if (idx === -1) return;

    e.preventDefault();
    e.stopPropagation();
    const nextIdx =
      e.key === "ArrowDown"
        ? Math.min(buttons.length - 1, idx + 1)
        : Math.max(0, idx - 1);
    buttons[nextIdx]?.focus();
  };

  const content = (
    <div className="flex h-full flex-col justify-between px-3 py-4">
      <div
        data-sources-nav="true"
        onKeyDown={handleNavKeyDown}
        className="min-h-0 flex-1 overflow-y-auto pr-1"
      >
        <div className="mb-3 flex items-center justify-between px-2.5 lg:hidden">
          <span className="text-[13px] font-medium text-[var(--fg-secondary)]">Sources</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sources"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <button
          type="button"
          data-source-item="true"
          onClick={() => {
            onSelectFeed(null);
            if (window.innerWidth < 1024) onClose();
          }}
          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13.5px] transition-colors ${
            selectedFeedId === null
              ? "bg-[var(--bg-active)] font-medium text-[var(--fg)]"
              : "text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
          }`}
        >
          <span className="flex items-center gap-2.5">
            <Rss className="h-3.5 w-3.5 text-[var(--fg-muted)]" strokeWidth={1.8} />
            <span>All feeds</span>
          </span>
          {totalUnread > 0 && (
            <span className="font-mono-ui text-[11.5px] tabular-nums text-[var(--fg-muted)]">
              {totalUnread}
            </span>
          )}
        </button>

        <div className="mt-5 space-y-5">
          {groups.map((group) => (
            <div key={group.folder || "__ungrouped"}>
              {group.folder && (
                <div className="mb-1.5 px-2.5 text-[12px] font-medium text-[var(--fg-muted)]">
                  {group.folder}
                </div>
              )}
              <ul className="space-y-0.5">
                {group.feeds.map((feed) => {
                  const active = selectedFeedId === feed.id;
                  return (
                    <li key={feed.id} className="group flex items-center gap-1">
                      <button
                        type="button"
                        data-source-item="true"
                        onClick={() => {
                          onSelectFeed(feed.id);
                          if (window.innerWidth < 1024) onClose();
                        }}
                        className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13.5px] transition-colors ${
                          active
                            ? "bg-[var(--bg-active)] font-medium text-[var(--fg)]"
                            : "text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate">{feed.title}</span>
                          {feed.lastError && (
                            <span title={feed.lastError} className="shrink-0 text-[var(--fg-muted)]">
                              <AlertCircle className="h-3.5 w-3.5" />
                            </span>
                          )}
                        </span>
                        {feed.unreadCount > 0 && (
                          <span className="font-mono-ui shrink-0 text-[11.5px] tabular-nums text-[var(--fg-muted)]">
                            {feed.unreadCount}
                          </span>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => onDeleteFeed(feed.id)}
                        aria-label={`Unsubscribe from ${feed.title}`}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--fg-faint)] opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] focus:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="safe-bottom mt-4 flex items-center justify-between border-t border-[var(--line)] pt-3">
        <button
          type="button"
          onClick={onOpenAdd}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
        >
          <Upload className="h-3.5 w-3.5" strokeWidth={1.7} />
          <span>OPML</span>
        </button>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onCheckUpdate}
            disabled={checkingUpdate}
            title="Check for updates"
            className="font-mono-ui rounded-lg px-2 py-1 text-[11.5px] text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] disabled:opacity-50"
          >
            {checkingUpdate ? "Checking..." : `v${appVersion}`}
          </button>

          <button
            type="button"
            onClick={onOpenShortcuts}
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
          >
            <HelpCircle className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-30 bg-black/60 backdrop-blur-[2px] lg:hidden"
        onClick={onClose}
      />
      <aside
        aria-label="Sources"
        className="safe-top fixed inset-y-0 left-0 z-30 w-72 max-w-[85vw] shrink-0 border-r border-[var(--line)] bg-[var(--bg)] shadow-[var(--shadow-sheet)] lg:static lg:z-auto lg:w-60 lg:pt-0 lg:shadow-none"
      >
        {content}
      </aside>
    </>
  );
}
