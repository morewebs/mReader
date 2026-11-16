import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { api, resetPreviewState } from "../lib/api";

describe("mReader App", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetPreviewState();
    document.documentElement.setAttribute("data-theme", "ink");
  });

  it("renders unread stream, opens an article in ReaderSheet, toggles full text, and switches theme polarity", async () => {
    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByText("Designing interfaces that stay quiet while you think")
      ).toBeInTheDocument();
    });

    // Open the first article into focused ReaderSheet
    fireEvent.click(
      screen.getByText("Designing interfaces that stay quiet while you think")
    );

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(
        screen.getByText(/Most feed readers turn curiosity into an inbox chore/i)
      ).toBeInTheDocument();
    });

    // Load full article text
    fireEvent.click(screen.getByText("Full text"));
    await waitFor(() => {
      expect(
        screen.getByText(/Full article content extracted cleanly in reader mode/i)
      ).toBeInTheDocument();
    });

    // Open Aa appearance popover, press Escape to close popover only (Reader stays open)
    fireEvent.click(screen.getByLabelText("Typography and theme"));
    expect(screen.getByText("Typeface")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Typeface")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Close ReaderSheet with second Escape
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // Toggle theme with mouse and 't' shortcut
    fireEvent.click(screen.getByLabelText("Switch to Paper light mode"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("paper");

    fireEvent.keyDown(window, { key: "t" });
    expect(document.documentElement.getAttribute("data-theme")).toBe("ink");
  });

  it("navigates seamlessly across stream rows and inside ReaderSheet with arrow keys and vim keys", async () => {
    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByText("Designing interfaces that stay quiet while you think")
      ).toBeInTheDocument();
    });

    // ArrowDown moves DOM focus to row 0, Enter opens it
    fireEvent.keyDown(window, { key: "ArrowDown" });
    const firstRowBtn = document.querySelector<HTMLButtonElement>(
      '[data-article-index="0"]'
    );
    expect(document.activeElement).toBe(firstRowBtn);

    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // ArrowRight inside ReaderSheet steps directly to the second article
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => {
      expect(
        screen.getByText(/Stripping color out of a reading instrument/i)
      ).toBeInTheDocument();
    });

    // ArrowLeft steps back to the first article; mark it unread with 'm' so it stays in Unread
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await waitFor(() => {
      expect(
        screen.getByText(/Most feed readers turn curiosity into an inbox chore/i)
      ).toBeInTheDocument();
    });
    fireEvent.keyDown(window, { key: "m" });
    await waitFor(() => {
      expect(
        within(screen.getByRole("dialog")).getByLabelText("Mark as read")
      ).toBeInTheDocument();
    });

    // Closing reader restores DOM focus cleanly to the stream article button
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(
        document.querySelector('[data-article-index="0"]')
      );
    });
  });

  it("supports search-to-stream handoff, scope number keys, and ? shortcuts legend", async () => {
    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByText("Monochrome hierarchy: luminance, hairlines, and typographic scale")
      ).toBeInTheDocument();
    });

    // '/' opens search, ArrowDown inside search hands off focus directly to stream row 0
    fireEvent.keyDown(window, { key: "/" });
    const searchInput = await screen.findByPlaceholderText(
      "Search headlines, notes, or publications..."
    );
    expect(document.activeElement).toBe(searchInput);

    fireEvent.keyDown(searchInput, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      document.querySelector('[data-article-index="0"]')
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByPlaceholderText("Search headlines, notes, or publications...")
    ).not.toBeInTheDocument();

    // Switch scopes with 2 (Everything) and 3 (Saved)
    fireEvent.keyDown(window, { key: "2" });
    await waitFor(() => {
      expect(
        screen.getByText("Local-first SQLite sync patterns for cross-platform apps")
      ).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "3" });
    await waitFor(() => {
      expect(
        screen.queryByText("Local-first SQLite sync patterns for cross-platform apps")
      ).not.toBeInTheDocument();
    });

    // Open shortcuts legend with '?'
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByText("Keyboard shortcuts")).toBeInTheDocument();
    expect(screen.getByText("Inside reader")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Keyboard shortcuts")).not.toBeInTheDocument();
  });

  it("opens Add source modal and switches between URL and OPML tabs", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText("Add feed or import OPML")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Add feed or import OPML"));
    expect(screen.getByText("Add source")).toBeInTheDocument();

    fireEvent.click(screen.getByText("OPML import & export"));
    expect(screen.getByText("Choose OPML file")).toBeInTheDocument();
  });

  it("shows quiet onboarding state when there are no subscribed feeds", async () => {
    vi.spyOn(api, "getFeeds").mockResolvedValue([]);
    vi.spyOn(api, "listArticles").mockResolvedValue([]);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("A quiet place to read.")).toBeInTheDocument();
    });

    expect(screen.getByText("Starter publications")).toBeInTheDocument();
    expect(screen.getByText("Add selected (3)")).toBeInTheDocument();
  });

  it("displays monochrome delta update pill with transfer savings", async () => {
    vi.spyOn(api, "checkForUpdate").mockResolvedValue({
      enabled: true,
      currentVersion: "0.1.0",
      available: {
        version: "0.2.0",
        notes: "Faster feed refresh",
        releaseUrl: "https://github.com/morewebs/mReader/releases/tag/v0.2.0",
        strategy: "delta",
        downloadBytes: 280 * 1024,
        fullBytes: 11 * 1024 * 1024,
        canInstallInPlace: true,
      },
    });

    render(<App />);

    // Open Sources rail so the version/check-update button is visible at 1024px test width
    const toggleBtn = await screen.findByLabelText("Show sources");
    fireEvent.click(toggleBtn);

    // Click manual version check button in SourcesDrawer footer
    const versionBtn = await screen.findByText("v0.1.0");
    fireEvent.click(versionBtn);

    await waitFor(() => {
      expect(screen.getByText("Update v0.2.0 available")).toBeInTheDocument();
      expect(screen.getByText("280 KB delta (98% smaller)")).toBeInTheDocument();
    });
  });
});
