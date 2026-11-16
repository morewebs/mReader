export interface StarterFeedOption {
  title: string;
  url: string;
  note: string;
}

export const STARTER_FEEDS: StarterFeedOption[] = [
  {
    title: "Simon Willison's Weblog",
    url: "https://simonwillison.net/atom/everything/",
    note: "Software engineering, AI tooling, and sharp technical notes",
  },
  {
    title: "Ars Technica",
    url: "https://feeds.arstechnica.com/arstechnica/index",
    note: "Science, hardware, policy, and deep technology reporting",
  },
  {
    title: "Smashing Magazine",
    url: "https://www.smashingmagazine.com/feed/",
    note: "Interface craft, typography, and modern web engineering",
  },
  {
    title: "MIT Technology Review",
    url: "https://www.technologyreview.com/feed/",
    note: "Long-form technology essays and research context",
  },
  {
    title: "Lobsters",
    url: "https://lobste.rs/rss",
    note: "Focused computing links and independent essays",
  },
];
