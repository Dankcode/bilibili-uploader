/**
 * BILIBILI URL VALIDATION — the single gate between operator input and the
 * network calls that carry the stored SESSDATA session cookie.
 *
 * SECURITY: `parseBilibiliVideoInfo()` attaches SESSDATA to whatever URL it is
 * given. Before this module, `resolveInput()` accepted any `http(s)://` string
 * verbatim, so a job whose "Bilibili URL" pointed at an attacker-controlled host
 * handed that host a live session cookie. Every path that can reach a
 * cookie-bearing request must call `assertBilibiliUrl()` first, including after
 * each redirect hop.
 */

// Hosts that may receive the session cookie. Suffix-matched on the registrable
// domain so `www.`, `m.`, `space.`, and `api.` subdomains are covered, while a
// look-alike such as `bilibili.com.evil.test` is not.
const ALLOWED_DOMAINS = ['bilibili.com', 'b23.tv'];

// BV ids are "BV" + 10 base58-ish characters; av ids are numeric.
const BV_ID = /^BV[0-9A-Za-z]{10}$/;
const AV_ID = /^av[0-9]{1,12}$/i;
const NUMERIC_ID = /^[0-9]{1,12}$/;
// Bilibili share links use a compact token such as b23.tv/B2J2aDS. Operators
// often paste that token after /video/ instead of its b23.tv host.
const B23_TOKEN = /^[0-9A-Za-z]{6,16}$/;

export function isAllowedBilibiliHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  return ALLOWED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * Throws unless `value` parses as an http(s) URL on an allowed Bilibili host.
 * @returns {URL} the parsed URL, for callers that want the normalized form.
 */
export function assertBilibiliUrl(value, context = 'Bilibili request') {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new Error(`${context} requires a valid URL, got: ${String(value || '').slice(0, 120)}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${context} must use http or https, got: ${url.protocol}`);
  }
  if (!isAllowedBilibiliHost(url.hostname)) {
    throw new Error(
      `${context} refused: ${url.hostname} is not a Bilibili host. `
      + 'The stored session cookie is only ever sent to bilibili.com or b23.tv.',
    );
  }
  return url;
}

/**
 * Turns operator input into a canonical Bilibili video URL, or throws.
 * Accepts a full Bilibili URL, a `BV…` id, an `av…` id, a bare numeric av id,
 * or a compact b23 share ID such as `B2J2aDS`.
 * Rejects foreign hosts, path traversal, and free text.
 */
export function normalizeBilibiliVideoInput(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('Bilibili input is required');

  if (/^https?:\/\//i.test(input)) {
    const url = assertBilibiliUrl(input, 'Bilibili source');
    // b23.tv links are Bilibili's short links. Their target identifier is not
    // available until the HTTP redirect, which parseBilibiliVideoInfo() guards
    // again before attaching the session cookie.
    if (url.hostname.toLowerCase().replace(/\.$/, '').endsWith('b23.tv')) return url.toString();

    const pathParts = url.pathname.split('/').filter(Boolean);
    const videoId = pathParts.length === 2 && pathParts[0] === 'video' ? pathParts[1] : '';
    if (BV_ID.test(videoId) || AV_ID.test(videoId) || NUMERIC_ID.test(videoId)) return url.toString();
    if (B23_TOKEN.test(videoId)) return `https://b23.tv/${videoId}`;
    {
      throw new Error(
        `Not a Bilibili video: "${input.slice(0, 120)}". `
        + 'Paste a bilibili.com/video/BV… or /video/av… URL, or a BV/av identifier.',
      );
    }
  }

  // Reject anything that is not a bare identifier before building a URL from it,
  // so `../../etc/passwd` can never become a path under /video/.
  if (BV_ID.test(input)) return `https://www.bilibili.com/video/${input}`;
  if (AV_ID.test(input)) return `https://www.bilibili.com/video/${input.toLowerCase()}`;
  if (NUMERIC_ID.test(input)) return `https://www.bilibili.com/video/av${input}`;
  if (B23_TOKEN.test(input)) return `https://b23.tv/${input}`;

  throw new Error(
    `Not a Bilibili video: "${input.slice(0, 80)}". `
    + 'Paste a bilibili.com URL, a BV/av identifier, or a b23 share ID such as B2J2aDS.',
  );
}

/**
 * Axios `beforeRedirect` hook — re-checks the host on every redirect hop so a
 * Bilibili URL that redirects off-site cannot carry the cookie with it.
 */
export function guardRedirect(options) {
  const host = options?.hostname || options?.host || '';
  if (!isAllowedBilibiliHost(host)) {
    throw new Error(`Bilibili request refused: redirect to a non-Bilibili host (${host || 'unknown'}).`);
  }
}
