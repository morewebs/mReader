import { useState, type ChangeEvent, type FormEvent } from "react";
import { Download, Plus, Upload, X } from "lucide-react";

interface AddFeedModalProps {
  open: boolean;
  hasFeeds: boolean;
  onClose: () => void;
  onAddFeed: (url: string, folder: string) => Promise<void>;
  onImportOpml: (xml: string) => Promise<void>;
  onExportOpml: () => Promise<string>;
}

export function AddFeedModal({
  open,
  hasFeeds,
  onClose,
  onAddFeed,
  onImportOpml,
  onExportOpml,
}: AddFeedModalProps) {
  const [tab, setTab] = useState<"url" | "opml">("url");
  const [url, setUrl] = useState("");
  const [folder, setFolder] = useState("");
  const [opmlText, setOpmlText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await onAddFeed(url.trim(), folder.trim());
      setUrl("");
      setFolder("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleOpmlFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const xml = await file.text();
      await onImportOpml(xml);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  const handleOpmlPaste = async (e: FormEvent) => {
    e.preventDefault();
    if (!opmlText.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onImportOpml(opmlText);
      setOpmlText("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    setError(null);
    try {
      const xml = await onExportOpml();
      const blob = new Blob([xml], { type: "text/xml;charset=utf-8" });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "mreader-subscriptions.opml";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
      setStatus("Exported mreader-subscriptions.opml");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add publication or manage OPML"
    >
      <div
        className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <div className="relative w-full max-w-md rounded-2xl border border-[var(--line-strong)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-sheet)]">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--fg)]">
            Add source
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex gap-1 rounded-full border border-[var(--line)] bg-[var(--bg)] p-0.5">
          <button
            type="button"
            onClick={() => {
              setTab("url");
              setError(null);
            }}
            className={`flex-1 rounded-full py-1.5 text-[12.5px] font-medium transition-colors ${
              tab === "url"
                ? "bg-[var(--pill-bg)] text-[var(--pill-fg)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]"
            }`}
          >
            Website or feed URL
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("opml");
              setError(null);
            }}
            className={`flex-1 rounded-full py-1.5 text-[12.5px] font-medium transition-colors ${
              tab === "opml"
                ? "bg-[var(--pill-bg)] text-[var(--pill-fg)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]"
            }`}
          >
            OPML import & export
          </button>
        </div>

        {tab === "url" ? (
          <form onSubmit={handleAdd} className="mt-5 space-y-4">
            <div>
              <label className="mb-1.5 block text-[12.5px] text-[var(--fg-secondary)]">
                URL
              </label>
              <input
                type="text"
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com or feed.xml"
                disabled={busy}
                className="h-10 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--bg)] px-3.5 text-[14px] text-[var(--fg)] placeholder:text-[var(--fg-muted)] focus:border-[var(--fg)] focus:outline-none"
              />
              <p className="mt-1.5 text-[12px] text-[var(--fg-muted)]">
                Supports RSS, Atom, JSON Feed, or automatic discovery from any site.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-[12.5px] text-[var(--fg-secondary)]">
                Folder (optional)
              </label>
              <input
                type="text"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="Engineering, Design, Essays..."
                disabled={busy}
                className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3.5 text-[14px] text-[var(--fg)] placeholder:text-[var(--fg-muted)] focus:border-[var(--fg)] focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-full border border-[var(--line)] px-4 text-[13px] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !url.trim()}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--pill-bg)] px-4 text-[13px] font-medium text-[var(--pill-fg)] disabled:opacity-45"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                <span>{busy ? "Subscribing..." : "Subscribe"}</span>
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap gap-2.5">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[var(--pill-bg)] px-4 py-2 text-[13px] font-medium text-[var(--pill-fg)]">
                <Upload className="h-3.5 w-3.5" strokeWidth={2} />
                <span>{busy ? "Importing..." : "Choose OPML file"}</span>
                <input
                  type="file"
                  accept=".opml,.xml,text/xml,application/xml"
                  onChange={handleOpmlFile}
                  disabled={busy}
                  className="sr-only"
                />
              </label>

              {hasFeeds && (
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--line-strong)] px-4 py-2 text-[13px] font-medium text-[var(--fg)] hover:bg-[var(--bg-hover)]"
                >
                  <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
                  <span>Export OPML</span>
                </button>
              )}
            </div>

            <form onSubmit={handleOpmlPaste} className="space-y-3 pt-1">
              <label className="block text-[12.5px] text-[var(--fg-secondary)]">
                Or paste OPML XML
              </label>
              <textarea
                rows={4}
                value={opmlText}
                onChange={(e) => setOpmlText(e.target.value)}
                placeholder="<opml version=&quot;2.0&quot;>...</opml>"
                disabled={busy}
                className="font-mono-ui w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-[12px] text-[var(--fg)] placeholder:text-[var(--fg-muted)] focus:border-[var(--fg)] focus:outline-none"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={busy || !opmlText.trim()}
                  className="h-9 rounded-full border border-[var(--line-strong)] px-4 text-[13px] font-medium text-[var(--fg)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
                >
                  Import pasted XML
                </button>
              </div>
            </form>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 text-[13px] text-[var(--fg-secondary)]">
            {error}
          </p>
        )}
        {status && (
          <p className="mt-4 text-[13px] text-[var(--fg-secondary)]">{status}</p>
        )}
      </div>
    </div>
  );
}
