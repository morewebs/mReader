import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ArticleDetail,
  ArticleSummary,
  AvailableUpdate,
  Feed,
  ReaderSettings,
  StreamScope,
  UpdateProgressEvent,
} from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { api, openExternalUrl, syncWindowTheme } from "./lib/api";
import { groupFeedsByFolder } from "./lib/format";
import { TopBar } from "./components/TopBar";
import { SourcesDrawer } from "./components/SourcesDrawer";
import { EditionStream } from "./components/EditionStream";
import { EmptyEdition } from "./components/EmptyEdition";
import { ReaderSheet } from "./components/ReaderSheet";
import { AddFeedModal } from "./components/AddFeedModal";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { UpdatePill } from "./components/UpdatePill";

export function App() {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [activeArticle, setActiveArticle] = useState<ArticleDetail | null>(null);
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);

  const [scope, setScope] = useState<StreamScope>("unread");
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [sourcesOpen, setSourcesOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1120 : true
  );
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [keyboardFocusSignal, setKeyboardFocusSignal] = useState(0);
  const didInitialLoadRef = useRef(false);

  const [appVersion, setAppVersion] = useState("0.1.0");
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<UpdateProgressEvent | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const orderedFeedIds = useMemo(
    () => groupFeedsByFolder(feeds).flatMap((g) => g.feeds.map((f) => f.id)),
    [feeds]
  );

  const loadFeedsAndArticles = useCallback(
    async (
      nextScope: StreamScope = scope,
      nextFeedId: string | null = selectedFeedId,
      nextSearch: string = searchQuery
    ) => {
      const [fetchedFeeds, fetchedArticles] = await Promise.all([
        api.getFeeds(),
        api.listArticles({
          scope: nextScope,
          feedId: nextFeedId,
          search: nextSearch,
        }),
      ]);
      setFeeds(fetchedFeeds);
      setArticles(fetchedArticles);
      setFocusedIndex((prev) =>
        fetchedArticles.length === 0 ? -1 : Math.min(prev, fetchedArticles.length - 1)
      );
    },
    [scope, selectedFeedId, searchQuery]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const savedSettings = await api.getSettings();
        if (!cancelled) {
          setSettings(savedSettings);
          document.documentElement.setAttribute("data-theme", savedSettings.theme);
          void syncWindowTheme(savedSettings.theme);
        }
        await loadFeedsAndArticles("unread", null, "");
      } catch (err) {
        if (!cancelled) {
          setNotice(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          didInitialLoadRef.current = true;
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Initial hydration only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!didInitialLoadRef.current) return;
    const handle = window.setTimeout(() => {
      void loadFeedsAndArticles(scope, selectedFeedId, searchQuery).catch((err) => {
        setNotice(err instanceof Error ? err.message : String(err));
      });
    }, 80);
    return () => window.clearTimeout(handle);
    // Re-fetch when filter inputs change after initial mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, selectedFeedId, searchQuery]);

  const updateSettings = useCallback(async (next: ReaderSettings) => {
    setSettings(next);
    document.documentElement.setAttribute("data-theme", next.theme);
    void syncWindowTheme(next.theme);
    try {
      await api.saveSettings(next);
    } catch {
      // Ignore persistence hiccups while keeping active state smooth.
    }
  }, []);

  const handleToggleTheme = useCallback(() => {
    const nextTheme = settings.theme === "ink" ? "paper" : "ink";
    void updateSettings({ ...settings, theme: nextTheme });
  }, [settings, updateSettings]);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setNotice(null);
    try {
      const summary = selectedFeedId
        ? await api.refreshFeed(selectedFeedId)
        : await api.refreshAllFeeds();
      await loadFeedsAndArticles();
      if (summary.errors.length > 0 && summary.newArticles === 0) {
        setNotice(
          `${summary.errors[0].feedTitle}: ${summary.errors[0].message}`
        );
      } else if (summary.newArticles > 0) {
        setNotice(
          `${summary.newArticles} new ${summary.newArticles === 1 ? "story" : "stories"}`
        );
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, selectedFeedId, loadFeedsAndArticles]);

  const handleOpenArticle = useCallback(
    async (summary: ArticleSummary, index?: number) => {
      setExtractError(null);
      const resolvedIndex =
        index ?? articles.findIndex((item) => item.id === summary.id);
      if (resolvedIndex >= 0) {
        setFocusedIndex(resolvedIndex);
      }
      try {
        const detail = await api.getArticle(summary.id);
        setActiveArticle(detail);
        if (!detail.isRead) {
          await api.setArticleRead(detail.id, true);
          setActiveArticle((curr) =>
            curr && curr.id === detail.id ? { ...curr, isRead: true } : curr
          );
          setArticles((prev) =>
            prev.map((a) => (a.id === detail.id ? { ...a, isRead: true } : a))
          );
          setFeeds((prev) =>
            prev.map((f) =>
              f.id === detail.feedId
                ? { ...f, unreadCount: Math.max(0, f.unreadCount - 1) }
                : f
            )
          );
        }
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      }
    },
    [articles]
  );

  const handleCloseReader = useCallback(() => {
    setActiveArticle(null);
    setExtractError(null);
    void loadFeedsAndArticles().finally(() => {
      setKeyboardFocusSignal((n) => n + 1);
    });
  }, [loadFeedsAndArticles]);

  const handleToggleRead = useCallback(
    async (target: { id: string; feedId: string; isRead: boolean }) => {
      const nextRead = !target.isRead;
      await api.setArticleRead(target.id, nextRead);
      setArticles((prev) =>
        prev.map((a) => (a.id === target.id ? { ...a, isRead: nextRead } : a))
      );
      setActiveArticle((prev) =>
        prev && prev.id === target.id ? { ...prev, isRead: nextRead } : prev
      );
      setFeeds((prev) =>
        prev.map((f) =>
          f.id === target.feedId
            ? { ...f, unreadCount: Math.max(0, f.unreadCount + (nextRead ? -1 : 1)) }
            : f
        )
      );
    },
    []
  );

  const handleToggleSaved = useCallback(
    async (target: { id: string; isSaved: boolean }) => {
      const nextSaved = !target.isSaved;
      await api.setArticleSaved(target.id, nextSaved);
      setArticles((prev) =>
        prev.map((a) => (a.id === target.id ? { ...a, isSaved: nextSaved } : a))
      );
      setActiveArticle((prev) =>
        prev && prev.id === target.id ? { ...prev, isSaved: nextSaved } : prev
      );
    },
    []
  );

  const handleFetchFullArticle = useCallback(async () => {
    if (!activeArticle || extracting) return;
    setExtracting(true);
    setExtractError(null);
    try {
      const updated = await api.fetchFullArticle(activeArticle.id);
      setActiveArticle(updated);
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : String(err));
    } finally {
      setExtracting(false);
    }
  }, [activeArticle, extracting]);

  const handleAddFeed = useCallback(
    async (url: string, folder = "") => {
      setOnboardingBusy(true);
      setNotice(null);
      try {
        await api.addFeed(url, folder || undefined);
        await loadFeedsAndArticles();
      } finally {
        setOnboardingBusy(false);
      }
    },
    [loadFeedsAndArticles]
  );

  const handleSubscribeStarter = useCallback(
    async (urls: string[]) => {
      setOnboardingBusy(true);
      setNotice(null);
      try {
        const res = await api.addStarterFeeds(urls);
        await loadFeedsAndArticles();
        if (res.errors.length > 0 && res.imported === 0) {
          setNotice(res.errors[0]);
        }
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      } finally {
        setOnboardingBusy(false);
      }
    },
    [loadFeedsAndArticles]
  );

  const handleImportOpml = useCallback(
    async (xml: string) => {
      setOnboardingBusy(true);
      setNotice(null);
      try {
        const summary = await api.importOpml(xml);
        await loadFeedsAndArticles();
        setNotice(
          `Imported ${summary.imported} ${summary.imported === 1 ? "feed" : "feeds"}${
            summary.skipped > 0 ? ` (${summary.skipped} existing)` : ""
          }`
        );
      } finally {
        setOnboardingBusy(false);
      }
    },
    [loadFeedsAndArticles]
  );

  const handleDeleteFeed = useCallback(
    async (feedId: string) => {
      await api.deleteFeed(feedId);
      if (selectedFeedId === feedId) {
        setSelectedFeedId(null);
      }
      await loadFeedsAndArticles(
        scope,
        selectedFeedId === feedId ? null : selectedFeedId,
        searchQuery
      );
    },
    [selectedFeedId, scope, searchQuery, loadFeedsAndArticles]
  );

  const handleMarkAllRead = useCallback(async () => {
    const count = await api.markAllRead(selectedFeedId);
    await loadFeedsAndArticles();
    if (count > 0) {
      setNotice(`Marked ${count} ${count === 1 ? "story" : "stories"} read`);
    }
  }, [selectedFeedId, loadFeedsAndArticles]);

  const activeStreamIndex = activeArticle
    ? articles.findIndex((a) => a.id === activeArticle.id)
    : -1;
  const prevArticle =
    activeStreamIndex > 0 ? articles[activeStreamIndex - 1] : null;
  const nextArticle =
    activeStreamIndex >= 0 && activeStreamIndex < articles.length - 1
      ? articles[activeStreamIndex + 1]
      : null;
  const nextUnread = activeArticle
    ? articles.find((a) => a.id !== activeArticle.id && !a.isRead) ?? null
    : null;

  const moveStreamFocus = useCallback(
    (nextIndex: number) => {
      if (articles.length === 0) return;
      const clamped = Math.max(0, Math.min(articles.length - 1, nextIndex));
      setFocusedIndex(clamped);
      setKeyboardFocusSignal((n) => n + 1);
    },
    [articles.length]
  );

  const stepSelectedFeed = useCallback(
    (delta: -1 | 1) => {
      if (orderedFeedIds.length === 0) return;
      const allOptions: (string | null)[] = [null, ...orderedFeedIds];
      const currIdx = allOptions.indexOf(selectedFeedId);
      const safeIdx = currIdx === -1 ? 0 : currIdx;
      const nextIdx =
        (safeIdx + delta + allOptions.length) % allOptions.length;
      setSelectedFeedId(allOptions[nextIdx]);
      setFocusedIndex(-1);
    },
    [orderedFeedIds, selectedFeedId]
  );

  // Unified keyboard navigation & shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const targetEl = e.target instanceof Element ? e.target : null;
      const inInput =
        targetEl instanceof HTMLElement &&
        (targetEl.tagName === "INPUT" ||
          targetEl.tagName === "TEXTAREA" ||
          targetEl.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (activeArticle) {
          setActiveArticle(null);
          setExtractError(null);
        }
        setAddModalOpen(false);
        setShortcutsOpen(false);
        setSearchOpen(true);
        return;
      }

      if (e.key === "Escape") {
        if (shortcutsOpen) {
          setShortcutsOpen(false);
          return;
        }
        if (addModalOpen) {
          setAddModalOpen(false);
          return;
        }
        if (activeArticle) {
          handleCloseReader();
          return;
        }
        if (searchOpen) {
          setSearchOpen(false);
          setSearchQuery("");
          return;
        }
      }

      if (inInput || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
        return;
      }

      if (shortcutsOpen || addModalOpen) return;

      if (activeArticle) {
        if (e.key === "j" || e.key === "ArrowRight") {
          if (nextArticle) {
            e.preventDefault();
            void handleOpenArticle(nextArticle);
          }
        } else if (e.key === "k" || e.key === "ArrowLeft") {
          if (prevArticle) {
            e.preventDefault();
            void handleOpenArticle(prevArticle);
          }
        } else if (e.key === "n" && nextUnread) {
          e.preventDefault();
          void handleOpenArticle(nextUnread);
        } else if (e.key === "s") {
          e.preventDefault();
          void handleToggleSaved(activeArticle);
        } else if (e.key === "m") {
          e.preventDefault();
          void handleToggleRead(activeArticle);
        } else if (e.key === "f" && activeArticle.url) {
          e.preventDefault();
          void handleFetchFullArticle();
        } else if (e.key === "o" && activeArticle.url) {
          e.preventDefault();
          void openExternalUrl(activeArticle.url);
        } else if (e.key === "t") {
          e.preventDefault();
          handleToggleTheme();
        }
        return;
      }

      const isNonArticleControl =
        targetEl !== null &&
        (targetEl.tagName === "BUTTON" || targetEl.tagName === "A") &&
        !targetEl.hasAttribute("data-article-index");

      const inSourcesNav = Boolean(targetEl?.closest("[data-sources-nav='true']"));

      if (e.key === "/") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "b") {
        e.preventDefault();
        setSourcesOpen((prev) => !prev);
      } else if (e.key === "a") {
        e.preventDefault();
        setAddModalOpen(true);
      } else if (e.key === "r") {
        e.preventDefault();
        void handleRefresh();
      } else if (e.key === "t") {
        e.preventDefault();
        handleToggleTheme();
      } else if (e.key === "1") {
        e.preventDefault();
        setScope("unread");
      } else if (e.key === "2") {
        e.preventDefault();
        setScope("all");
      } else if (e.key === "3") {
        e.preventDefault();
        setScope("saved");
      } else if (e.key === "[") {
        e.preventDefault();
        stepSelectedFeed(-1);
      } else if (e.key === "]") {
        e.preventDefault();
        stepSelectedFeed(1);
      } else if (e.key === "0") {
        e.preventDefault();
        setSelectedFeedId(null);
        setFocusedIndex(-1);
      } else if (e.key === "M" && e.shiftKey) {
        e.preventDefault();
        void handleMarkAllRead();
      } else if (e.key === "j" || (e.key === "ArrowDown" && !inSourcesNav)) {
        if (articles.length > 0) {
          e.preventDefault();
          moveStreamFocus(focusedIndex < 0 ? 0 : focusedIndex + 1);
        }
      } else if (e.key === "k" || (e.key === "ArrowUp" && !inSourcesNav)) {
        if (articles.length > 0) {
          e.preventDefault();
          moveStreamFocus(focusedIndex < 0 ? 0 : focusedIndex - 1);
        }
      } else if (e.key === "Home" && articles.length > 0) {
        e.preventDefault();
        moveStreamFocus(0);
      } else if (e.key === "End" && articles.length > 0) {
        e.preventDefault();
        moveStreamFocus(articles.length - 1);
      } else if (
        e.key === "Enter" &&
        !isNonArticleControl &&
        focusedIndex >= 0 &&
        articles[focusedIndex]
      ) {
        e.preventDefault();
        void handleOpenArticle(articles[focusedIndex], focusedIndex);
      } else if (e.key === "m" && focusedIndex >= 0 && articles[focusedIndex]) {
        e.preventDefault();
        void handleToggleRead(articles[focusedIndex]);
      } else if (e.key === "s" && focusedIndex >= 0 && articles[focusedIndex]) {
        e.preventDefault();
        void handleToggleSaved(articles[focusedIndex]);
      } else if (
        e.key === "o" &&
        focusedIndex >= 0 &&
        articles[focusedIndex]?.url
      ) {
        e.preventDefault();
        void openExternalUrl(articles[focusedIndex].url!);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeArticle,
    addModalOpen,
    shortcutsOpen,
    searchOpen,
    articles,
    focusedIndex,
    prevArticle,
    nextArticle,
    nextUnread,
    handleCloseReader,
    handleFetchFullArticle,
    handleMarkAllRead,
    handleOpenArticle,
    handleRefresh,
    handleToggleRead,
    handleToggleSaved,
    handleToggleTheme,
    moveStreamFocus,
    stepSelectedFeed,
  ]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const handleCheckUpdate = useCallback(async (quiet = false) => {
    setCheckingUpdate(true);
    setUpdateError(null);
    try {
      const res = await api.checkForUpdate();
      setAppVersion(res.currentVersion);
      if (res.available) {
        setAvailableUpdate(res.available);
        setUpdateDismissed(false);
      } else if (!quiet) {
        setNotice(
          res.enabled
            ? `Up to date (v${res.currentVersion})`
            : `v${res.currentVersion} (unsigned dev build)`
        );
      }
    } catch (err) {
      if (!quiet) {
        setNotice(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

  const handleInstallUpdate = useCallback(async () => {
    if (installingUpdate) return;
    setInstallingUpdate(true);
    setUpdateError(null);
    setUpdateProgress(null);
    try {
      await api.installUpdate();
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err));
      setInstallingUpdate(false);
    }
  }, [installingUpdate]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void api.getAppVersion().then(setAppVersion).catch(() => {});
    void api
      .onUpdateProgress((ev) => setUpdateProgress(ev))
      .then((fn) => {
        unlisten = fn;
      });
    const timer = window.setTimeout(() => {
      void handleCheckUpdate(true);
    }, 2500);
    return () => {
      window.clearTimeout(timer);
      unlisten?.();
    };
  }, [handleCheckUpdate]);

  const activeFeed = feeds.find((f) => f.id === selectedFeedId) ?? null;
  const hasUnread = feeds.some((f) => f.unreadCount > 0);

  return (
    <div className="flex h-full flex-col bg-[var(--bg)] text-[var(--fg)]">
      <TopBar
        scope={scope}
        onScopeChange={setScope}
        activeFeedTitle={activeFeed?.title ?? null}
        sourcesOpen={sourcesOpen}
        onToggleSources={() => setSourcesOpen((prev) => !prev)}
        searchOpen={searchOpen}
        searchQuery={searchQuery}
        onToggleSearch={() => {
          setSearchOpen((prev) => {
            if (prev) setSearchQuery("");
            return !prev;
          });
        }}
        onSearchChange={setSearchQuery}
        onSearchToStream={() => {
          if (articles.length > 0) {
            moveStreamFocus(0);
          }
        }}
        onCloseSearch={() => {
          setSearchOpen(false);
          setSearchQuery("");
        }}
        isRefreshing={refreshing}
        onRefresh={() => void handleRefresh()}
        onOpenAdd={() => setAddModalOpen(true)}
        theme={settings.theme}
        onToggleTheme={handleToggleTheme}
        hasUnread={hasUnread}
      />

      <div className="flex min-h-0 flex-1">
        <SourcesDrawer
          open={sourcesOpen && feeds.length > 0}
          onClose={() => setSourcesOpen(false)}
          feeds={feeds}
          selectedFeedId={selectedFeedId}
          onSelectFeed={(id) => {
            setSelectedFeedId(id);
            setFocusedIndex(-1);
          }}
          onDeleteFeed={(id) => void handleDeleteFeed(id)}
          onOpenAdd={() => setAddModalOpen(true)}
          onOpenShortcuts={() => setShortcutsOpen(true)}
          appVersion={appVersion}
          checkingUpdate={checkingUpdate}
          onCheckUpdate={() => void handleCheckUpdate(false)}
        />

        <main className="min-w-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="mx-auto max-w-[720px] px-6 py-16 text-[14px] text-[var(--fg-muted)]">
              Loading edition...
            </div>
          ) : feeds.length === 0 ? (
            <EmptyEdition
              onSubscribeUrl={(u) => handleAddFeed(u)}
              onSubscribeStarter={handleSubscribeStarter}
              onImportOpml={handleImportOpml}
              busy={onboardingBusy}
              error={notice}
            />
          ) : (
            <EditionStream
              articles={articles}
              scope={scope}
              feedTitle={activeFeed?.title ?? null}
              feedCount={activeFeed ? 1 : feeds.length}
              searchQuery={searchQuery}
              focusedIndex={focusedIndex}
              keyboardFocusSignal={keyboardFocusSignal}
              monochromeImages={settings.monochromeImages}
              onOpenArticle={(a, idx) => void handleOpenArticle(a, idx)}
              onFocusRow={(idx) => setFocusedIndex(idx)}
              onToggleRead={(a, idx) => {
                setFocusedIndex(idx);
                void handleToggleRead(a);
              }}
              onToggleSaved={(a, idx) => {
                setFocusedIndex(idx);
                void handleToggleSaved(a);
              }}
              onMarkAllRead={() => void handleMarkAllRead()}
              onShowEverything={() => setScope("all")}
              onRefresh={() => void handleRefresh()}
              onOpenShortcuts={() => setShortcutsOpen(true)}
            />
          )}
        </main>
      </div>

      {notice && feeds.length > 0 && (
        <div
          role="status"
          className="safe-bottom pointer-events-none fixed bottom-5 left-1/2 z-30 -translate-x-1/2 rounded-full border border-[var(--line-strong)] bg-[var(--bg-elevated)] px-4 py-2 text-[12.5px] text-[var(--fg)] shadow-[var(--shadow-sheet)]"
        >
          {notice}
        </div>
      )}

      {activeArticle && (
        <ReaderSheet
          article={activeArticle}
          settings={settings}
          hasPrev={Boolean(prevArticle)}
          hasNext={Boolean(nextArticle)}
          hasNextUnread={Boolean(nextUnread)}
          isExtracting={extracting}
          extractError={extractError}
          onClose={handleCloseReader}
          onPrev={() => {
            if (prevArticle) void handleOpenArticle(prevArticle);
          }}
          onNext={() => {
            if (nextArticle) void handleOpenArticle(nextArticle);
          }}
          onToggleRead={() => void handleToggleRead(activeArticle)}
          onToggleSaved={() => void handleToggleSaved(activeArticle)}
          onFetchFullArticle={() => void handleFetchFullArticle()}
          onUpdateSettings={(next) => void updateSettings(next)}
          onNextUnread={() => {
            if (nextUnread) void handleOpenArticle(nextUnread);
          }}
        />
      )}

      <AddFeedModal
        open={addModalOpen}
        hasFeeds={feeds.length > 0}
        onClose={() => setAddModalOpen(false)}
        onAddFeed={handleAddFeed}
        onImportOpml={handleImportOpml}
        onExportOpml={api.exportOpml}
      />

      <ShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      {availableUpdate && !updateDismissed && (
        <UpdatePill
          update={availableUpdate}
          installing={installingUpdate}
          progress={updateProgress}
          error={updateError}
          onInstall={() => void handleInstallUpdate()}
          onDismiss={() => setUpdateDismissed(true)}
        />
      )}
    </div>
  );
}

export default App;
