import { X } from "lucide-react";

interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const STREAM_SHORTCUTS = [
  { key: "j / ↓", action: "Next story" },
  { key: "k / ↑", action: "Previous story" },
  { key: "Enter", action: "Open focused story" },
  { key: "m", action: "Toggle read or unread" },
  { key: "s", action: "Bookmark or unbookmark" },
  { key: "o", action: "Open original link" },
  { key: "1 / 2 / 3", action: "Unread / Everything / Saved" },
  { key: "[ / ] / 0", action: "Prev / next source / All feeds" },
  { key: "/ or Ctrl+K", action: "Search stories" },
  { key: "b / a / r", action: "Sources / Add feed / Refresh" },
  { key: "Shift+M / t", action: "Mark all read / Switch theme" },
];

const READER_SHORTCUTS = [
  { key: "Esc", action: "Back to stream" },
  { key: "j / →", action: "Next story" },
  { key: "k / ←", action: "Previous story" },
  { key: "n", action: "Next unread story" },
  { key: "f / o", action: "Full text / Open original" },
  { key: "s / m / t", action: "Bookmark / Read / Theme" },
  { key: "Space / ↑↓", action: "Scroll article" },
];

export function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <div className="relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--line-strong)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-sheet)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-[var(--fg)]">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            aria-label="Close shortcuts"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5">
          <section>
            <h3 className="mb-1.5 text-[12px] font-medium text-[var(--fg-muted)]">
              Stream & navigation
            </h3>
            <dl className="divide-y divide-[var(--line)]">
              {STREAM_SHORTCUTS.map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                  <dt className="text-[var(--fg-secondary)]">{item.action}</dt>
                  <dd className="font-mono-ui shrink-0 rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 py-0.5 text-[11.5px] text-[var(--fg)]">
                    {item.key}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <h3 className="mb-1.5 text-[12px] font-medium text-[var(--fg-muted)]">
              Inside reader
            </h3>
            <dl className="divide-y divide-[var(--line)]">
              {READER_SHORTCUTS.map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                  <dt className="text-[var(--fg-secondary)]">{item.action}</dt>
                  <dd className="font-mono-ui shrink-0 rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 py-0.5 text-[11.5px] text-[var(--fg)]">
                    {item.key}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
