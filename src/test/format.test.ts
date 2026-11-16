import { describe, expect, it } from "vitest";

import { formatRelativeTime, getHostLabel, groupArticlesByDay } from "../lib/format";
import type { ArticleSummary } from "../types";

function makeArticle(id: string, publishedAt: string): ArticleSummary {
  return {
    id,
    feedId: "f1",
    feedTitle: "Notes",
    url: "https://example.com/post",
    title: `Title ${id}`,
    author: null,
    summary: "Summary",
    imageUrl: null,
    publishedAt,
    readingMinutes: 3,
    isRead: false,
    isSaved: false,
    hasExtracted: false,
  };
}

describe("format utilities", () => {
  it("formats relative timestamps cleanly", () => {
    const now = new Date("2026-11-16T12:00:00Z");
    expect(formatRelativeTime("2026-11-16T11:59:40Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-11-16T11:45:00Z", now)).toBe("15m");
    expect(formatRelativeTime("2026-11-16T08:00:00Z", now)).toBe("4h");
    expect(formatRelativeTime("2026-11-15T10:00:00Z", now)).toBe("1d");
    expect(formatRelativeTime("2026-11-12T10:00:00Z", now)).toBe("4d");
  });

  it("groups articles into Today, Yesterday, This week, and Earlier", () => {
    const now = new Date(2026, 10, 16, 14, 0, 0);
    const today = new Date(2026, 10, 16, 9, 0, 0).toISOString();
    const yesterday = new Date(2026, 10, 15, 16, 0, 0).toISOString();
    const thisWeek = new Date(2026, 10, 12, 10, 0, 0).toISOString();
    const earlier = new Date(2026, 10, 1, 10, 0, 0).toISOString();

    const groups = groupArticlesByDay(
      [
        makeArticle("1", today),
        makeArticle("2", yesterday),
        makeArticle("3", thisWeek),
        makeArticle("4", earlier),
      ],
      now
    );

    expect(groups.map((g) => g.label)).toEqual([
      "Today",
      "Yesterday",
      "This week",
      "Earlier",
    ]);
    expect(groups[0].articles.map((a) => a.id)).toEqual(["1"]);
    expect(groups[3].articles.map((a) => a.id)).toEqual(["4"]);
  });

  it("extracts clean host labels without www", () => {
    expect(getHostLabel("https://www.simonwillison.net/2026/")).toBe("simonwillison.net");
    expect(getHostLabel("invalid-url")).toBe("");
    expect(getHostLabel(null)).toBe("");
  });
});
