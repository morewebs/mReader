import { ArrowUpRight, Download, Loader2, X } from "lucide-react";

import type { AvailableUpdate, UpdateProgressEvent } from "../types";
import { openExternalUrl } from "../lib/api";

interface UpdatePillProps {
  update: AvailableUpdate;
  installing: boolean;
  progress: UpdateProgressEvent | null;
  error: string | null;
  onInstall: () => void;
  onDismiss: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UpdatePill({
  update,
  installing,
  progress,
  error,
  onInstall,
  onDismiss,
}: UpdatePillProps) {
  const savedPct =
    update.fullBytes > 0 && update.downloadBytes < update.fullBytes
      ? Math.round((1 - update.downloadBytes / update.fullBytes) * 100)
      : 0;

  const progressPct =
    progress && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))
      : 0;

  const stageLabel =
    progress?.stage === "patching"
      ? "Applying delta patch..."
      : progress?.stage === "verifying"
        ? "Verifying signature..."
        : progress?.stage === "installing"
          ? "Installing..."
          : progress
            ? `Downloading ${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}`
            : "Preparing update...";

  return (
    <div
      role="status"
      aria-live="polite"
      className="safe-bottom fixed bottom-4 left-4 right-4 z-30 overflow-hidden rounded-2xl border border-[var(--line-strong)] bg-[var(--bg-elevated)] p-3.5 shadow-[var(--shadow-sheet)] sm:left-auto sm:w-80"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13.5px] font-medium text-[var(--fg)]">
            Update v{update.version} available
          </div>
          <div className="mt-0.5 text-[12px] text-[var(--fg-muted)]">
            {installing
              ? stageLabel
              : update.strategy === "delta" && savedPct > 0
                ? `${formatBytes(update.downloadBytes)} delta (${savedPct}% smaller)`
                : `${formatBytes(update.downloadBytes)} compressed`}
          </div>
        </div>

        {!installing && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss update"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-[12px] text-[var(--fg-secondary)]">
          {error}
        </p>
      )}

      {installing && (
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[var(--line)]">
          <div
            className="h-full bg-[var(--fg)] transition-[width] duration-150"
            style={{ width: `${Math.max(progressPct, 8)}%` }}
          />
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        {update.canInstallInPlace ? (
          <button
            type="button"
            onClick={onInstall}
            disabled={installing}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--pill-bg)] px-3.5 text-[12.5px] font-medium text-[var(--pill-fg)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {installing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" strokeWidth={1.9} />
            )}
            <span>{installing ? "Updating..." : "Update"}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void openExternalUrl(update.releaseUrl)}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--pill-bg)] px-3.5 text-[12.5px] font-medium text-[var(--pill-fg)] transition-opacity hover:opacity-90"
          >
            <span>Open release</span>
            <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.9} />
          </button>
        )}
      </div>
    </div>
  );
}
