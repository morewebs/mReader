import { useEffect, useRef } from "react";
import { Moon, PanelLeft, Plus, RefreshCw, Search, Sun, X } from "lucide-react";

import type { StreamScope, ThemePolarity } from "../types";

interface TopBarProps {
  scope: StreamScope;
  onScopeChange: (scope: StreamScope) => void;
  activeFeedTitle: string | null;
  sourcesOpen: boolean;
  onToggleSources: () => void;
  searchOpen: boolean;
  searchQuery: string;
  onToggleSearch: () => void;
  onSearchChange: (q: string) => void;
  onSearchToStream: () => void;
  onCloseSearch: () => void;
  isRefreshing: boolean;
  onRefresh: () => void;
  onOpenAdd: () => void;
  theme: ThemePolarity;
  onToggleTheme: () => void;
  hasUnread: boolean;
}

const SCOPES: { id: StreamScope; label: string; keyHint: string }[] = [
  { id: "unread", label: "Unread", keyHint: "1" },
  { id: "all", label: "Everything", keyHint: "2" },
  { id: "saved", label: "Saved", keyHint: "3" },
];

export function TopBar({
  scope,
  onScopeChange,
  activeFeedTitle,
  sourcesOpen,
  onToggleSources,
  searchOpen,
  searchQuery,
  onToggleSearch,
  onSearchChange,
  onSearchToStream,
  onCloseSearch,
  isRefreshing,
  onRefresh,
  onOpenAdd,
  theme,
  onToggleTheme,
  hasUnread,
}: TopBarProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  return (
    <header className="safe-top sticky top-0 z-20 shrink-0 border-b border-[var(--line)] bg-[var(--bg-backdrop)] backdrop-blur-md">
      <div className="flex h-14 w-full items-center justify-between gap-3 px-3 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:px-4">
        <div className="flex min-w-0 items-center justify-self-start gap-2">
          <button
            type="button"
            onClick={onToggleSources}
            title={sourcesOpen ? "Hide sources (b)" : "Show sources (b)"}
            aria-label={sourcesOpen ? "Hide sources" : "Show sources"}
            aria-expanded={sourcesOpen}
            className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
          >
            <PanelLeft className="h-[18px] w-[18px]" strokeWidth={1.7} />
            {hasUnread && !sourcesOpen && (
              <span
                aria-hidden="true"
                className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[var(--fg)]"
              />
            )}
          </button>

          <div className="flex min-w-0 items-baseline gap-2.5">
            <span className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--fg)]">
              mReader
            </span>
            {activeFeedTitle && (
              <span className="hidden truncate text-[13px] text-[var(--fg-muted)] sm:inline">
                {activeFeedTitle}
              </span>
            )}
          </div>
        </div>

        <nav
          aria-label="Reading scope"
          className="hidden items-center justify-self-center gap-1 rounded-full border border-[var(--line)] bg-[var(--bg-elevated)] p-0.5 sm:flex"
        >
          {SCOPES.map((item) => {
            const active = scope === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onScopeChange(item.id)}
                title={`${item.label} (${item.keyHint})`}
                aria-pressed={active}
                className={`rounded-full px-3.5 py-1 text-[12.5px] font-medium tracking-[-0.01em] transition-colors ${
                  active
                    ? "bg-[var(--pill-bg)] text-[var(--pill-fg)]"
                    : "text-[var(--fg-muted)] hover:text-[var(--fg)]"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center justify-self-end gap-1">
          <button
            type="button"
            onClick={onToggleSearch}
            title="Search stories (/)"
            aria-label={searchOpen ? "Close search" : "Search articles"}
            aria-expanded={searchOpen}
            className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
              searchOpen || searchQuery
                ? "bg-[var(--bg-active)] text-[var(--fg)]"
                : "text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
            }`}
          >
            <Search className="h-[17px] w-[17px]" strokeWidth={1.7} />
          </button>

          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Refresh feeds (r)"
            aria-label="Refresh feeds"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] disabled:opacity-50"
          >
            <RefreshCw
              className={`h-[17px] w-[17px] ${isRefreshing ? "animate-spin" : ""}`}
              strokeWidth={1.7}
            />
          </button>

          <button
            type="button"
            onClick={onOpenAdd}
            title="Add source (a)"
            aria-label="Add feed or import OPML"
            className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)]"
          >
            <Plus className="h-[17px] w-[17px]" strokeWidth={1.8} />
            <span className="hidden md:inline">Add</span>
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            title="Switch theme (t)"
            aria-label={theme === "ink" ? "Switch to Paper light mode" : "Switch to Ink dark mode"}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
          >
            {theme === "ink" ? (
              <Sun className="h-[17px] w-[17px]" strokeWidth={1.7} />
            ) : (
              <Moon className="h-[17px] w-[17px]" strokeWidth={1.7} />
            )}
          </button>
        </div>
      </div>

      {/* Mobile scope pills */}
      <div className="flex items-center justify-center border-t border-[var(--line)] px-4 py-2 sm:hidden">
        <nav
          aria-label="Reading scope mobile"
          className="flex w-full max-w-xs items-center rounded-full border border-[var(--line)] bg-[var(--bg-elevated)] p-0.5"
        >
          {SCOPES.map((item) => {
            const active = scope === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onScopeChange(item.id)}
                aria-pressed={active}
                className={`flex-1 rounded-full py-1.5 text-[12.5px] font-medium transition-colors ${
                  active
                    ? "bg-[var(--pill-bg)] text-[var(--pill-fg)]"
                    : "text-[var(--fg-muted)] hover:text-[var(--fg)]"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>

      {searchOpen && (
        <div className="border-t border-[var(--line)] bg-[var(--bg)]">
          <div className="mx-auto flex h-11 max-w-[720px] items-center gap-2.5 px-4 sm:px-6">
            <Search className="h-4 w-4 shrink-0 text-[var(--fg-muted)]" strokeWidth={1.7} />
            <input
              ref={searchInputRef}
              type="search"
              autoFocus
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "Enter") {
                  e.preventDefault();
                  onSearchToStream();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onCloseSearch();
                }
              }}
              placeholder="Search headlines, notes, or publications..."
              className="w-full bg-transparent text-[14px] text-[var(--fg)] placeholder:text-[var(--fg-muted)] focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                aria-label="Clear search"
                className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
