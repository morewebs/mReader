export interface Feed {
  id: string;
  url: string;
  siteUrl: string | null;
  title: string;
  description: string | null;
  folder: string | null;
  etag: string | null;
  lastModified: string | null;
  lastFetchedAt: string | null;
  lastError: string | null;
  unreadCount: number;
  createdAt: string;
}

export interface ArticleSummary {
  id: string;
  feedId: string;
  feedTitle: string;
  url: string | null;
  title: string;
  author: string | null;
  summary: string;
  imageUrl: string | null;
  publishedAt: string;
  readingMinutes: number;
  isRead: boolean;
  isSaved: boolean;
  hasExtracted: boolean;
}

export interface ArticleDetail {
  id: string;
  feedId: string;
  feedTitle: string;
  url: string | null;
  title: string;
  author: string | null;
  summary: string;
  contentHtml: string;
  extractedHtml: string | null;
  imageUrl: string | null;
  publishedAt: string;
  fetchedAt: string;
  readingMinutes: number;
  isRead: boolean;
  isSaved: boolean;
}

export interface FeedRefreshError {
  feedId: string;
  feedTitle: string;
  message: string;
}

export interface RefreshSummary {
  feedsChecked: number;
  feedsUpdated: number;
  newArticles: number;
  errors: FeedRefreshError[];
}

export interface OpmlImportSummary {
  imported: number;
  skipped: number;
  errors: string[];
}

export type ThemePolarity = "ink" | "paper";
export type ReaderFontFamily = "serif" | "sans";
export type ReaderFontSize = "sm" | "md" | "lg";
export type StreamScope = "unread" | "all" | "saved";

export interface ReaderSettings {
  theme: ThemePolarity;
  fontFamily: ReaderFontFamily;
  fontSize: ReaderFontSize;
  monochromeImages: boolean;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: "ink",
  fontFamily: "serif",
  fontSize: "md",
  monochromeImages: true,
};

export interface AvailableUpdate {
  version: string;
  notes: string | null;
  releaseUrl: string;
  strategy: "delta" | "packed" | "external";
  downloadBytes: number;
  fullBytes: number;
  canInstallInPlace: boolean;
}

export interface UpdateCheckResult {
  enabled: boolean;
  currentVersion: string;
  available: AvailableUpdate | null;
}

export interface UpdateProgressEvent {
  stage: string;
  downloadedBytes: number;
  totalBytes: number;
}
