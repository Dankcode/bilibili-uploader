/**
 * CHINESE SOCIAL SCRAPER — what fans say about a show, normalized to:
 *   { site, postId, url, author, content, engagement:{likes,comments,shares},
 *     episodeHint, timestampHint, scrapedAt }
 * saved via scenes/store.saveMentions. Sites are adapters — add a site = one
 * entry + one fetch/parse pair.
 *
 * PER SITE:
 *  - weibo: mobile API m.weibo.cn/api/container/getIndex?containerid=
 *    100103type%3D1%26q%3D<query> — JSON, most stable; Playwright fallback
 *    (browserScraper) when the cookie fetch 403s.
 *  - xiaohongshu: anti-bot x-s signing → mode 'playwright' (browserScraper):
 *    real browser harvesting the page's own API responses. Login is
 *    INTERACTIVE — visible window, user logs in themselves (email preferred).
 *  - douban: group/topic search HTML → cheerio (📋 npm dep).
 *  - tieba: kw= search HTML → cheerio.
 * mode: 'api' plain fetch · 'html' cheerio · 'playwright' browserScraper.
 * loginKinds: 'interactive' = headed-window login button · 'cookie' = paste field.
 *
 * POLITENESS: AbortController timeout on every fetch, 1 req/2s per site,
 * backoff on 4xx/5xx, cap 200 mentions/(show,site)/run, archive raw responses
 * to VIDEO_WORK_DIR/scrapes/<date>/ for reparse-without-refetch. User's own
 * accounts/cookies; respect site ToS.
 * Query terms: titleZh + 名场面 / 高能 / 第X集 / 哭了 / 封神.
 */

export const SCRAPER_SITES = [
  { id: 'weibo', label: '微博 Weibo', mode: 'api', fallbackMode: 'playwright', loginKinds: ['interactive', 'cookie'],
    credentialFields: [{ key: 'cookie', label: 'Cookie (optional if interactive login used)', type: 'secret' }] },
  { id: 'xiaohongshu', label: '小红书 XHS', mode: 'playwright', loginKinds: ['interactive', 'cookie'],
    credentialFields: [{ key: 'cookie', label: 'Cookie (optional if interactive login used)', type: 'secret' }] },
  { id: 'douban', label: '豆瓣 Douban', mode: 'html', loginKinds: ['cookie'],
    credentialFields: [{ key: 'cookie', label: 'Cookie', type: 'secret' }] },
  { id: 'tieba', label: '贴吧 Tieba', mode: 'html', loginKinds: ['cookie'],
    credentialFields: [{ key: 'cookie', label: 'Cookie', type: 'secret' }] },
];

/** Scrape all enabled sites for one show; caller persists via store.saveMentions. */
export async function scrapeShow(_show, _enabledSiteIds, _credentialsBySite) {
  return [];
}

/** Cheap per-site connectivity probe for diagnostics. */
export async function testFetch(siteId, _credentials) {
  const site = SCRAPER_SITES.find((entry) => entry.id === siteId);
  if (!site) return { ok: false, error: `Unknown scraper site: ${siteId}` };
  return { ok: false, error: `${site.label} scraping requires site-specific login/parser setup` };
}
