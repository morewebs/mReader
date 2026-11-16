import type { ArticleSummary, Feed } from "../types";

export interface FeedGroup {
  folder: string;
  feeds: Feed[];
}

export function groupFeedsByFolder(feeds: Feed[]): FeedGroup[] {
  const grouped = new Map<string, Feed[]>();
  for (const feed of feeds) {
    const key = feed.folder?.trim() || "";
    const existing = grouped.get(key);
    if (existing) {
      existing.push(feed);
    } else {
      grouped.set(key, [feed]);
    }
  }

  return Array.from(grouped.keys())
    .sort((a, b) => {
      if (a === "" && b !== "") return 1;
      if (a !== "" && b === "") return -1;
      return a.localeCompare(b);
    })
    .map((folder) => ({
      folder,
      feeds: grouped.get(folder)!,
    }));
}

export interface ArticleGroup {
  label: string;
  articles: ArticleSummary[];
}

export function formatRelativeTime(isoDate: string, now: Date = new Date()): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const diffSeconds = Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 1000));
  if (diffSeconds < 60) return "just now";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "1d";
  if (diffDays < 7) return `${diffDays}d`;

  const sameYear = parsed.getFullYear() === now.getFullYear();
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function formatFullDate(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function groupArticlesByDay(
  articles: ArticleSummary[],
  now: Date = new Date()
): ArticleGroup[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOfWeek = startOfToday - 6 * 86_400_000;

  const buckets = new Map<string, ArticleSummary[]>();
  const order = ["Today", "Yesterday", "This week", "Earlier"];

  for (const article of articles) {
    const time = new Date(article.publishedAt).getTime();
    let label = "Earlier";
    if (!Number.isNaN(time)) {
      if (time >= startOfToday) {
        label = "Today";
      } else if (time >= startOfYesterday) {
        label = "Yesterday";
      } else if (time >= startOfWeek) {
        label = "This week";
      }
    }
    const existing = buckets.get(label);
    if (existing) {
      existing.push(article);
    } else {
      buckets.set(label, [article]);
    }
  }

  return order
    .filter((label) => buckets.has(label))
    .map((label) => ({
      label,
      articles: buckets.get(label)!,
    }));
}

export function getHostLabel(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
