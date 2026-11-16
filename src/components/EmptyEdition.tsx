import { useState, type ChangeEvent, type FormEvent } from "react";
import { Check, Plus, Upload } from "lucide-react";

import { STARTER_FEEDS } from "../lib/starterFeeds";

interface EmptyEditionProps {
  onSubscribeUrl: (url: string) => Promise<void>;
  onSubscribeStarter: (urls: string[]) => Promise<void>;
  onImportOpml: (xml: string) => Promise<void>;
  busy: boolean;
  error: string | null;
}

export function EmptyEdition({
  onSubscribeUrl,
  onSubscribeStarter,
  onImportOpml,
  busy,
  error,
}: EmptyEditionProps) {
  const [url, setUrl] = useState("");
  const [selectedUrls, setSelectedUrls] = useState<string[]>([
    STARTER_FEEDS[0].url,
    STARTER_FEEDS[1].url,
    STARTER_FEEDS[2].url,
  ]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim() || busy) return;
    await onSubscribeUrl(url.trim());
    setUrl("");
  };

  const toggleStarter = (feedUrl: string) => {
    setSelectedUrls((prev) =>
      prev.includes(feedUrl) ? prev.filter((u) => u !== feedUrl) : [...prev, feedUrl]
    );
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    await onImportOpml(text);
    e.target.value = "";
  };

  return (
    <div className="mx-auto w-full max-w-[580px] px-5 py-12 sm:py-16">
      <h1 className="text-[30px] font-semibold tracking-[-0.03em] text-[var(--fg)] sm:text-[36px]">
        A quiet place to read.
      </h1>
      <p className="mt-2.5 text-[15px] leading-[1.6] text-[var(--fg-secondary)]">
        Subscribe to any website or feed URL, import your OPML archive, or pick a few publications below to begin.
      </p>

      <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-2.5 sm:flex-row">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="simonwillison.net or https://example.com/feed.xml"
          disabled={busy}
          className="h-11 flex-1 rounded-xl border border-[var(--line-strong)] bg-[var(--bg-elevated)] px-4 text-[14px] text-[var(--fg)] placeholder:text-[var(--fg-muted)] focus:border-[var(--fg)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--pill-bg)] px-5 text-[13.5px] font-medium text-[var(--pill-fg)] transition-opacity hover:opacity-90 disabled:opacity-45"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          <span>{busy ? "Adding..." : "Subscribe"}</span>
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-3 text-[13px] text-[var(--fg-secondary)]">
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--line)] px-3.5 py-2 text-[13px] text-[var(--fg-secondary)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]">
          <Upload className="h-3.5 w-3.5" strokeWidth={1.8} />
          <span>Import OPML</span>
          <input
            type="file"
            accept=".opml,.xml,text/xml,application/xml"
            onChange={handleFileChange}
            disabled={busy}
            className="sr-only"
          />
        </label>
      </div>

      <div className="mt-10 border-t border-[var(--line)] pt-7">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13.5px] font-medium text-[var(--fg)]">Starter publications</h2>
          <button
            type="button"
            disabled={busy || selectedUrls.length === 0}
            onClick={() => onSubscribeStarter(selectedUrls)}
            className="rounded-full border border-[var(--line-strong)] px-3.5 py-1.5 text-[12.5px] font-medium text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40"
          >
            Add selected ({selectedUrls.length})
          </button>
        </div>

        <ul className="divide-y divide-[var(--line)]">
          {STARTER_FEEDS.map((item) => {
            const checked = selectedUrls.includes(item.url);
            return (
              <li key={item.url}>
                <button
                  type="button"
                  onClick={() => toggleStarter(item.url)}
                  aria-pressed={checked}
                  className="flex w-full items-start justify-between gap-4 py-3.5 text-left transition-colors hover:bg-[var(--bg-hover)]/50"
                >
                  <div className="min-w-0">
                    <div className="text-[14.5px] font-medium text-[var(--fg)]">{item.title}</div>
                    <div className="mt-0.5 text-[13px] text-[var(--fg-muted)]">{item.note}</div>
                  </div>
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                      checked
                        ? "border-[var(--pill-bg)] bg-[var(--pill-bg)] text-[var(--pill-fg)]"
                        : "border-[var(--line-strong)] text-transparent"
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
