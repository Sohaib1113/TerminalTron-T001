import { exec } from 'child_process';
import { promisify } from 'util';
import prisma from '../db';

const execAsync = promisify(exec);

/**
 * Supported automation actions. Kept as a string union so it can be persisted
 * directly to the AutomationTask.action column.
 */
export type AutomationAction =
  | 'open_url'
  | 'open_site'
  | 'youtube_search'
  | 'youtube_play'
  | 'web_search'
  | 'open_app'
  | 'run_command';

export interface AutomationIntent {
  action: AutomationAction;
  target: string;
  title: string;
  detail: string;
}

export type AutomationStatus =
  | 'pending-approval'
  | 'approved'
  | 'running'
  | 'completed'
  | 'denied'
  | 'failed';

/**
 * Applications Ultron is allowed to launch. Keys are lowercased aliases; values
 * are either an executable name or a Windows protocol URI (opened via `start`).
 */
const APP_ALIASES: Record<string, string> = {
  // Core utilities
  calculator: 'calc',
  calc: 'calc',
  notepad: 'notepad',
  'text editor': 'notepad',
  paint: 'mspaint',
  mspaint: 'mspaint',
  explorer: 'explorer',
  'file explorer': 'explorer',
  files: 'explorer',
  'task manager': 'taskmgr',
  taskmgr: 'taskmgr',
  settings: 'ms-settings:',
  'windows settings': 'ms-settings:',
  cmd: 'cmd',
  'command prompt': 'cmd',
  terminal: 'wt',
  'windows terminal': 'wt',
  'control panel': 'control',
  control: 'control',
  snipping: 'snippingtool',
  'snipping tool': 'snippingtool',
  // Productivity
  calendar: 'outlookcal:',
  'windows calendar': 'outlookcal:',
  mail: 'outlookmail:',
  email: 'outlookmail:',
  'windows mail': 'outlookmail:',
  outlook: 'outlook',
  word: 'winword',
  'microsoft word': 'winword',
  excel: 'excel',
  'microsoft excel': 'excel',
  powerpoint: 'powerpnt',
  'power point': 'powerpnt',
  'microsoft powerpoint': 'powerpnt',
  onenote: 'onenote',
  // Media
  photos: 'ms-photos:',
  'windows photos': 'ms-photos:',
  camera: 'microsoft.windows.camera:',
  'windows camera': 'microsoft.windows.camera:',
  clock: 'ms-clock:',
  alarms: 'ms-clock:',
  'alarms and clock': 'ms-clock:',
  music: 'mswindowsmusic:',
  'groove music': 'mswindowsmusic:',
  'media player': 'mswindowsmusic:',
  'windows media player': 'mswindowsmusic:',
  movies: 'mswindowsvideo:',
  'movies and tv': 'mswindowsvideo:',
  'tv and movies': 'mswindowsvideo:',
  spotify: 'spotify:',
  // System + stores
  store: 'ms-windows-store:',
  'windows store': 'ms-windows-store:',
  'microsoft store': 'ms-windows-store:',
  weather: 'bingweather:',
  maps: 'bingmaps:',
  xbox: 'xbox:',
  // Browsers
  edge: 'msedge',
  'microsoft edge': 'msedge',
  chrome: 'chrome',
  'google chrome': 'chrome',
  firefox: 'firefox',
  brave: 'brave',
};

const WEB_SEARCH_BASE = 'https://duckduckgo.com/?q=';
const YOUTUBE_SEARCH_BASE = 'https://www.youtube.com/results?search_query=';

/**
 * Well-known websites Ultron can open (optionally inside a specific browser).
 * Keys are lowercased site names; values are canonical https URLs.
 */
const KNOWN_SITES: Record<string, string> = {
  netflix: 'https://www.netflix.com',
  youtube: 'https://www.youtube.com',
  gmail: 'https://mail.google.com',
  'google mail': 'https://mail.google.com',
  github: 'https://github.com',
  google: 'https://www.google.com',
  facebook: 'https://www.facebook.com',
  twitter: 'https://twitter.com',
  x: 'https://x.com',
  instagram: 'https://www.instagram.com',
  linkedin: 'https://www.linkedin.com',
  reddit: 'https://www.reddit.com',
  amazon: 'https://www.amazon.com',
  whatsapp: 'https://web.whatsapp.com',
  'chat gpt': 'https://chat.openai.com',
  chatgpt: 'https://chat.openai.com',
  openai: 'https://openai.com',
  stackoverflow: 'https://stackoverflow.com',
  'stack overflow': 'https://stackoverflow.com',
  wikipedia: 'https://www.wikipedia.org',
  discord: 'https://discord.com',
  spotify: 'https://open.spotify.com',
  twitch: 'https://www.twitch.tv',
  duckduckgo: 'https://duckduckgo.com',
  bing: 'https://www.bing.com',
  outlook: 'https://outlook.live.com',
  office: 'https://www.office.com',
  notion: 'https://www.notion.so',
  figma: 'https://www.figma.com',
  drive: 'https://drive.google.com',
  'google drive': 'https://drive.google.com',
};

/**
 * Small edit-distance helper so near-miss spellings ("netfix", "claculator")
 * resolve to the intended app/site instead of failing or guessing wrong.
 */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

function closestMatch(input: string, candidates: string[]): string | null {
  const value = input.trim().toLowerCase();
  if (!value || value.length < 3) return null;
  let best: string | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const dist = editDistance(value, candidate);
    // Allow ~1 typo per 4 chars, at least 1, at most 3.
    const allowed = Math.min(3, Math.max(1, Math.floor(candidate.length / 4)));
    if (dist <= allowed && dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Resolves a site name ("netfix", "netflix", "you tube") to a known site key,
 * tolerating small typos. Returns null when nothing matches.
 */
const resolveSiteName = (raw: string): string | null => {
  let cleaned = stripQuotes(raw).toLowerCase().replace(/\s+/g, ' ').trim();
  // Drop filler words: "netflix website" -> "netflix", "the youtube page" -> "youtube"
  cleaned = cleaned
    .replace(/\b(website|web\s*site|webpage|site|page|url)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  if (KNOWN_SITES[cleaned]) return cleaned;
  // "you tube" -> "youtube", "net flix" -> "netflix"
  const joined = cleaned.replace(/\s+/g, '');
  if (KNOWN_SITES[joined]) return joined;
  return closestMatch(cleaned, Object.keys(KNOWN_SITES))
    ?? closestMatch(joined, Object.keys(KNOWN_SITES));
};

/**
 * Resolves a browser name ("brave browser", "chrome") to an APP_ALIASES key.
 */
const resolveBrowserName = (raw: string): string | null => {
  const cleaned = stripQuotes(raw).toLowerCase().replace(/\s+browser$/, '').trim();
  if (APP_ALIASES[cleaned]) return cleaned;
  return closestMatch(cleaned, Object.keys(APP_ALIASES));
};

type PlaywrightModule = {
  chromium: {
    launch: (options?: Record<string, unknown>) => Promise<{
      newPage: () => Promise<{
        goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>;
        fill: (selector: string, value: string) => Promise<void>;
        click: (selector: string) => Promise<void>;
        keyboard: { press: (key: string) => Promise<void> };
        waitForSelector: (selector: string, options?: Record<string, unknown>) => Promise<unknown>;
        waitForTimeout: (ms: number) => Promise<void>;
      }>;
      close: () => Promise<void>;
    }>;
  };
};

/**
 * Playwright is an optional dependency. When present Ultron can drive a real
 * browser session (search + auto-play). When absent everything still works by
 * falling back to the OS default browser.
 */
const loadPlaywright = (): PlaywrightModule | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('playwright') as PlaywrightModule;
  } catch {
    return null;
  }
};

const normalizeTarget = (raw: string): string => raw.trim().replace(/^["'<]+|["'>]+$/g, '').trim();

const ensureHttpUrl = (raw: string): string => {
  const target = normalizeTarget(raw);
  if (/^https?:\/\//i.test(target)) {
    return target;
  }
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/i.test(target)) {
    return `https://${target}`;
  }
  throw new Error(`"${raw}" is not a valid URL`);
};

const isSafeUrl = (url: string): boolean => /^https?:\/\//i.test(url);

/** Opens a URL using the platform default browser. */
const openInBrowser = async (url: string): Promise<void> => {
  if (!isSafeUrl(url)) {
    throw new Error('Only http(s) URLs can be opened');
  }

  const platform = process.platform;
  const escaped = url.replace(/"/g, '%22');

  if (platform === 'win32') {
    await execAsync(`start "" "${escaped}"`, { windowsHide: true });
  } else if (platform === 'darwin') {
    await execAsync(`open "${escaped}"`);
  } else {
    await execAsync(`xdg-open "${escaped}"`);
  }
};

/** Launches an allowlisted desktop application. */
const openApplication = async (appTarget: string): Promise<string> => {
  const key = appTarget.trim().toLowerCase();
  const resolved = APP_ALIASES[key];

  if (!resolved) {
    const allowed = Object.keys(APP_ALIASES).sort().join(', ');
    throw new Error(`Application "${appTarget}" is not allowlisted. Allowed: ${allowed}`);
  }

  if (process.platform !== 'win32') {
    throw new Error('Application launching is currently only supported on Windows');
  }

  // Every resolved value is a single executable name or protocol URI, so quoting
  // it keeps `start` from misparsing it as the window title.
  await execAsync(`start "" "${resolved}"`, { windowsHide: true });

  return `Launched ${appTarget}`;
};

/** Opens a known site URL, optionally forcing a specific installed browser. */
const openSiteInBrowser = async (url: string, browser?: string): Promise<void> => {
  if (!isSafeUrl(url)) {
    throw new Error('Only http(s) URLs can be opened');
  }
  const key = (browser ?? '').trim().toLowerCase();
  if (!key) {
    await openInBrowser(url);
    return;
  }
  const resolved = APP_ALIASES[key];
  if (!resolved) {
    await openInBrowser(url);
    return;
  }
  if (process.platform !== 'win32') {
    await openInBrowser(url);
    return;
  }
  const escaped = url.replace(/"/g, '%22');
  await execAsync(`start "" "${resolved}" "${escaped}"`, { windowsHide: true });
};

/**
 * Re-validates an LLM-extracted (action, target) pair through the same
 * allowlist and safety rules as the deterministic parser. The LLM can only
 * improve understanding — it can never widen what the assistant may do:
 * unknown apps return null (caller falls back to the honest "not supported"
 * message), non-http(s) URLs are rejected, and run_command is never
 * constructible here.
 */
export const buildIntentFromAction = (
  action: string,
  target: string,
): AutomationIntent | null => {
  const value = target.trim();
  if (!value) {
    return null;
  }
  if (action === 'open_url' && !isSafeUrl(value)) {
    return null;
  }
  if (action === 'open_app') {
    const candidate = value.toLowerCase();
    const resolved = APP_ALIASES[candidate] ? candidate : closestMatch(candidate, Object.keys(APP_ALIASES));
    if (!resolved) {
      return null;
    }
    const { title, detail } = describe('open_app', resolved);
    return { action: 'open_app', target: resolved, title, detail };
  }
  if (action === 'open_site') {
    const [site, browser] = value.split('|');
    const resolvedSite = resolveSiteName(site);
    if (!resolvedSite) {
      return null;
    }
    const browserKey = browser ? resolveBrowserName(browser) ?? undefined : undefined;
    const stored = browserKey ? resolvedSite + '|' + browserKey : resolvedSite;
    const { title, detail } = describe('open_site', stored);
    return { action: 'open_site', target: stored, title, detail };
  }
  if (
    action === 'open_url' ||
    action === 'youtube_search' ||
    action === 'youtube_play' ||
    action === 'web_search'
  ) {
    const { title, detail } = describe(action, value);
    return { action, target: value, title, detail };
  }
  return null;
};

/** Human readable label + detail used for the approval card. */
function describe(action: AutomationAction, target: string): { title: string; detail: string } {
  switch (action) {
    case 'open_url':
      return { title: 'Open website', detail: `Open ${target} in your default browser` };
    case 'open_site': {
      const [site, browser] = target.split('|');
      const url = KNOWN_SITES[site] ?? site;
      return browser
        ? { title: `Open ${site} in ${browser}`, detail: `Open ${url} in ${browser}` }
        : { title: `Open ${site}`, detail: `Open ${url} in your default browser` };
    }
    case 'youtube_search':
      return { title: 'Search YouTube', detail: `Search YouTube for "${target}"` };
    case 'youtube_play':
      return { title: 'Play on YouTube', detail: `Open YouTube and play "${target}"` };
    case 'web_search':
      return { title: 'Web search', detail: `Search the web for "${target}"` };
    case 'open_app':
      return { title: 'Launch application', detail: `Launch ${target}` };
    case 'run_command':
      return { title: 'Run command', detail: `Execute: ${target}` };
    default:
      return { title: 'Automation', detail: target };
  }
};

const stripQuotes = (value: string): string =>
  value
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Optional pleasantries the creator may prefix an app request with. */
const LEAD_IN = '(?:please\\s+|kindly\\s+|can you\\s+|could you\\s+|would you\\s+|hey terminatron[,!]?\\s+|terminatron[,!]?\\s+|hey terminal tron[,!]?\\s+|terminal tron[,!]?\\s+|okay\\s+|ok\\s+|yeah\\s+|sure\\s+)*';

/** Common action-verb typos ("ope netflix") normalised before matching. */
const normalizeActionVerbs = (prompt: string): string =>
  prompt
    .replace(/\bope\b/i, 'open')
    .replace(/\bopne\b/i, 'open')
    .replace(/\bopem\b/i, 'open')
    .replace(/\blanuch\b/i, 'launch')
    .replace(/\blauch\b/i, 'launch')
    .replace(/\bserach\b/i, 'search')
    .replace(/\bpaly\b/i, 'play');

/**
 * Matches "<open|launch|start|run|pull up|bring up> <app>" style requests,
 * tolerating lead-ins, a leading article, and stacked trailing filler
 * ("app" + "for me" may both appear: "launch the calculator app for me").
 */
const OPEN_APP_PATTERN = new RegExp(
  `^${LEAD_IN}(?:open|launch|start|run|pull\\s+up|bring\\s+up|fire\\s+up)\\s+(?:the\\s+|up\\s+)*(.+?)(?:\\s+app|\\s+application)?(?:\\s+for me|\\s+please)?$`,
  'i',
);

/**
 * Matches "open <site> in/on <browser>" requests (browser optional).
 * Checked BEFORE OPEN_APP_PATTERN so "open netflix on brave browser" isn't
 * misread as an app named "netflix on brave browser".
 */
const OPEN_SITE_PATTERN = new RegExp(
  `^${LEAD_IN}(?:open|launch|start|go\\s+to|visit|browse\\s+to|pull\\s+up|bring\\s+up|fire\\s+up|take\\s+me\\s+to)\\s+(?:the\\s+|my\\s+)?(.+?)\\s+(?:website|site|web\\s*site|webpage|page\\s+)?(?:in|on|using|with|via|through|inside)\\s+(?:the\\s+)?(edge|microsoft\\s+edge|chrome|google\\s+chrome|firefox|brave)(?:\\s+browser)?(?:\\s+for me|\\s+please)?$`,
  'i',
);

/** Matches a bare "open <site>" / "go to <site>" when <site> is a known site. */
const OPEN_SITE_BARE_PATTERN = new RegExp(
  `^${LEAD_IN}(?:open|launch|start|go\\s+to|visit|browse\\s+to|pull\\s+up|bring\\s+up|fire\\s+up|take\\s+me\\s+to)\\s+(?:the\\s+|my\\s+)?(.+?)(?:\\s+(?:website|site|web\\s*site|webpage|page|app|application)|\\s+for me|\\s+please)?$`,
  'i',
);

/** Words that signal a conversational sentence rather than an app name. */
const CONVERSATIONAL_WORDS =
  /\b(about|to|with|for|me|your|my|the|and|then|up|down|a|an|is|are|it|that|this|how|why|what|when|feelings?|mind|heart|eyes?)\b/i;

/**
 * Rule based natural-language + explicit command parser. Returns a proposed
 * automation intent, or null when the message is a normal conversational turn.
 * Everything returned here is still gated behind explicit user approval.
 */
export const parseAutomationIntent = (input: string): AutomationIntent | null => {
  const raw = input.trim();
  if (!raw) {
    return null;
  }
  // Normalise common verb typos ("ope netflix") and casual openers
  // ("okay open netflix in any browser") before every pattern below.
  const prompt = normalizeActionVerbs(raw);

  // ---- Explicit slash commands: /automate <action> <target> ----
  const explicit = prompt.match(/^\/automate\s+(\w+)\s*([\s\S]*)$/i);
  if (explicit) {
    const verb = explicit[1].toLowerCase();
    const rest = explicit[2] ?? '';
    const map: Record<string, AutomationAction> = {
      open: 'open_url',
      url: 'open_url',
      youtube: 'youtube_play',
      play: 'youtube_play',
      search: 'youtube_search',
      web: 'web_search',
      google: 'web_search',
      app: 'open_app',
      launch: 'open_app',
      run: 'run_command',
      command: 'run_command',
    };

    const action = map[verb];
    if (!action) {
      return null;
    }

    let target = stripQuotes(rest);
    if (action === 'open_url') {
      if (!target) {
        target = 'https://';
      }
      target = /^https?:\/\//i.test(target) ? target : ensureHttpUrl(target);
    }

    if (!target && action !== 'run_command') {
      return null;
    }

    const { title, detail } = describe(action, target);
    return { action, target, title, detail };
  }

  const lower = prompt.toLowerCase();

  // ---- "play <query> on youtube" / "play <query> on YouTube music" ----
  const playMatch = prompt.match(/^(?:please\s+)?play\s+(.+?)(?:\s+(?:on|in)\s+youtube.*)?$/i);
  if (playMatch && (/youtube/i.test(prompt) || /\b(song|music|video|track|album|playlist)\b/i.test(prompt))) {
    const target = stripQuotes(playMatch[1]).replace(/\s+(?:on|in)\s+youtube.*$/i, '').trim();
    if (target) {
      const { title, detail } = describe('youtube_play', target);
      return { action: 'youtube_play', target, title, detail };
    }
  }

  // ---- "search youtube for X" / "youtube X" ----
  const ytSearch = prompt.match(/^(?:search\s+youtube\s+for|youtube\s+search\s+for|search\s+on\s+youtube\s+for)\s+(.+)$/i);
  if (ytSearch) {
    const target = stripQuotes(ytSearch[1]);
    if (target) {
      const { title, detail } = describe('youtube_search', target);
      return { action: 'youtube_search', target, title, detail };
    }
  }

  // ---- "open youtube" / "go to <url>" / "open <url>" / "navigate to <url>" ----
  const urlDirect = prompt.match(/\b(?:open|go to|goto|navigate to|visit|launch)\s+(https?:\/\/[^\s]+|www\.[^\s]+|[\w-]+\.[a-z]{2,}(?:\/[^\s]*)?)/i);
  if (urlDirect) {
    const url = ensureHttpUrl(urlDirect[1]);
    const { title, detail } = describe('open_url', url);
    return { action: 'open_url', target: url, title, detail };
  }

  // ---- known website with a target browser (checked before legacy/bare) ----
  const siteMatch = prompt.match(OPEN_SITE_PATTERN);
  if (siteMatch) {
    const resolvedSite = resolveSiteName(siteMatch[1]);
    const browserKey = siteMatch[2] ? resolveBrowserName(siteMatch[2]) ?? undefined : undefined;
    if (resolvedSite) {
      const stored = browserKey ? `${resolvedSite}|${browserKey}` : resolvedSite;
      const { title, detail } = describe('open_site', stored);
      return { action: 'open_site', target: stored, title, detail };
    }
  }

  // "open <site> in any browser" — site known, browser generic: default browser.
  const siteAnyBrowser = prompt.match(
    new RegExp(
      `^${LEAD_IN}(?:open|launch|start|go\\s+to|visit|browse\\s+to)\\s+(?:the\\s+|my\\s+)?(.+?)\\s+(?:in|on)\\s+(?:any|default|my)\\s+browser(?:\\s+for me|\\s+please)?$`,
      'i',
    ),
  );
  if (siteAnyBrowser) {
    const resolvedAny = resolveSiteName(siteAnyBrowser[1]);
    if (resolvedAny) {
      const { title, detail } = describe('open_site', resolvedAny);
      return { action: 'open_site', target: resolvedAny, title, detail };
    }
  }

  const openSiteLegacy = prompt.match(/^(?:please\s+)?(?:open|go to|goto|navigate to|visit)\s+(youtube|google|gmail|github|chatgpt)\b/i);
  if (openSiteLegacy) {
    const legacyKey = openSiteLegacy[1].toLowerCase();
    const { title, detail } = describe('open_site', legacyKey);
    return { action: 'open_site', target: legacyKey, title, detail };
  }

  // ---- known website alone ("open netflix") ----
  const siteBareMatch = prompt.match(OPEN_SITE_BARE_PATTERN);
  if (siteBareMatch) {
    const resolvedBare = resolveSiteName(siteBareMatch[1]);
    if (resolvedBare) {
      const { title, detail } = describe('open_site', resolvedBare);
      return { action: 'open_site', target: resolvedBare, title, detail };
    }
  }


  // ---- "open calculator", "launch notepad", "can you open paint" ----
  const appMatch = prompt.match(OPEN_APP_PATTERN);
  if (appMatch) {
    const candidateRaw = stripQuotes(appMatch[1]).toLowerCase();
    const candidate = APP_ALIASES[candidateRaw]
      ? candidateRaw
      : closestMatch(candidateRaw, Object.keys(APP_ALIASES));
    if (candidate) {
      const { title, detail } = describe('open_app', candidate);
      return { action: 'open_app', target: candidate, title, detail };
    }
  }

  // ---- "search for X" / "google X" / "look up X" ----
  const webSearch = prompt.match(/^(?:please\s+)?(?:search\s+for|google|look\s+up|search\s+the\s+web\s+for)\s+(.+)$/i);
  if (webSearch) {
    const target = stripQuotes(webSearch[1]);
    if (target) {
      const { title, detail } = describe('web_search', target);
      return { action: 'web_search', target, title, detail };
    }
  }

  // Avoid unused-variable lint complaints while keeping the lowercase form handy.
  void lower;
  return null;
};

/**
 * When a message clearly asks to launch an application but that app is not on
 * the allowlist (so `parseAutomationIntent` returns null), this produces a
 * helpful explanation instead of letting the LLM silently invent a reply.
 * Returns null when the message is not an app request at all.
 */
export const describeUnsupportedIntent = (input: string): string | null => {
  const prompt = input.trim();
  if (!prompt || prompt.startsWith('/')) {
    return null;
  }

  const match = prompt.match(OPEN_APP_PATTERN);
  if (!match) {
    return null;
  }

  const candidate = stripQuotes(match[1]).toLowerCase();
  if (!candidate || candidate.split(/\s+/).length > 6) {
    return null;
  }

  // Skip URLs, domains, paths, known aliases, and conversational sentences.
  if (/[./\\]/.test(candidate) || APP_ALIASES[candidate] || CONVERSATIONAL_WORDS.test(candidate)) {
    return null;
  }

  // "open X on/in <browser>" without an allowlisted browser (e.g. "any
  // browser") is a website request, not an app — let it fall through to the
  // LLM/site fallback instead of blaming the allowlist.
  if (/\b(?:in|on|using|with|via|through|inside)\b/.test(candidate)) {
    return null;
  }

  const allowed = Object.keys(APP_ALIASES).sort().join(', ');
  const fuzzy = closestMatch(candidate, [...Object.keys(APP_ALIASES), ...Object.keys(KNOWN_SITES)]);
  const hint = fuzzy && fuzzy !== candidate ? ` Did you mean "${fuzzy}"?` : '';
  return `I can't launch "${candidate}" yet — it isn't on my allowlist. I can open: ${allowed}.${hint}`;
};

const getDefaultUser = async () =>
  prisma.user.upsert({
    where: { username: 'ultron-system' },
    update: {},
    create: {
      username: 'ultron-system',
      email: 'ultron@local',
      password: '',
    },
  });

const audit = async (
  userId: string,
  action: string,
  status: string,
  target?: string,
  message?: string,
  taskId?: string,
) => {
  try {
    await prisma.automationAuditLog.create({
      data: { userId, action, status, target, message, taskId },
    });
  } catch (error) {
    // Auditing must never break the action itself.
    console.error('Failed to write automation audit log', error);
  }
};

/**
 * Attempts a real browser-driven YouTube session. Returns true when Playwright
 * is installed and the session succeeded; false so the caller can fall back to
 * opening the default browser.
 */
const driveYouTubeWithPlaywright = async (query: string, autoPlay: boolean): Promise<boolean> => {
  const playwright = loadPlaywright();
  if (!playwright) {
    return false;
  }

  let browser: Awaited<ReturnType<PlaywrightModule['chromium']['launch']>> | null = null;
  try {
    browser = await playwright.chromium.launch({ headless: false });
    const page = await browser.newPage();
    await page.goto(`${YOUTUBE_SEARCH_BASE}${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
    });

    if (autoPlay) {
      const selector = 'ytd-video-renderer a#video-title, a#video-title';
      await page.waitForSelector(selector, { timeout: 10000 });
      await page.click(selector);
    }

    // Intentionally left open so playback continues for the user.
    return true;
  } catch (error) {
    console.error('Playwright YouTube automation failed', error);
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
    return false;
  }
};

const executeAction = async (action: AutomationAction, target: string): Promise<string> => {
  switch (action) {
    case 'open_url': {
      const url = ensureHttpUrl(target);
      await openInBrowser(url);
      return `Opened ${url}`;
    }
    case 'open_site': {
      const [site, browser] = target.split('|');
      const url = KNOWN_SITES[site] ?? site;
      await openSiteInBrowser(url, browser);
      return browser ? `Opened ${url} in ${browser}` : `Opened ${url}`;
    }
    case 'web_search': {
      await openInBrowser(`${WEB_SEARCH_BASE}${encodeURIComponent(target)}`);
      return `Searching the web for "${target}"`;
    }
    case 'youtube_search': {
      const drove = await driveYouTubeWithPlaywright(target, false);
      if (!drove) {
        await openInBrowser(`${YOUTUBE_SEARCH_BASE}${encodeURIComponent(target)}`);
        return `Opened YouTube results for "${target}" in your browser`;
      }
      return `Searching YouTube for "${target}"`;
    }
    case 'youtube_play': {
      const drove = await driveYouTubeWithPlaywright(target, true);
      if (!drove) {
        await openInBrowser(`${YOUTUBE_SEARCH_BASE}${encodeURIComponent(target)}`);
        return `Opened YouTube results for "${target}" — press play on the first video`;
      }
      return `Now playing "${target}" on YouTube`;
    }
    case 'open_app':
      return openApplication(target);
    case 'run_command': {
      if (process.env.AUTOMATION_ALLOW_COMMANDS !== 'true') {
        throw new Error(
          'Command execution is disabled. Set AUTOMATION_ALLOW_COMMANDS=true to enable it.',
        );
      }
      const { stdout } = await execAsync(target, { windowsHide: true, timeout: 15000 });
      return stdout.trim() || 'Command executed';
    }
    default:
      throw new Error(`Unsupported automation action: ${action}`);
  }
};

export interface AutomationTaskRecord {
  id: string;
  action: string;
  target: string;
  title: string;
  detail: string | null;
  status: string;
  result: string | null;
  error: string | null;
  source: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

const isEnabled = (): boolean => process.env.AUTOMATION_ENABLED !== 'false';

const requireEnabled = () => {
  if (!isEnabled()) {
    throw new Error('Automation is disabled. Set AUTOMATION_ENABLED=true to enable it.');
  }
};

/** Creates a pending automation task that awaits explicit user approval. */
const createTask = async (
  intent: AutomationIntent,
  source = 'chat',
): Promise<AutomationTaskRecord> => {
  requireEnabled();
  const user = await getDefaultUser();

  const task = await prisma.automationTask.create({
    data: {
      userId: user.id,
      action: intent.action,
      target: intent.target,
      title: intent.title,
      detail: intent.detail,
      status: 'pending-approval',
      source,
    },
  });

  await audit(user.id, intent.action, 'requested', intent.target, intent.title, task.id);
  return task;
};

const getTask = async (taskId: string): Promise<AutomationTaskRecord | null> =>
  prisma.automationTask.findUnique({ where: { id: taskId } });

const listTasks = async (limit = 50): Promise<AutomationTaskRecord[]> =>
  prisma.automationTask.findMany({ orderBy: { createdAt: 'desc' }, take: limit });

const listPending = async (): Promise<AutomationTaskRecord[]> =>
  prisma.automationTask.findMany({
    where: { status: 'pending-approval' },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

/** Approves and immediately executes a task. */
const approveTask = async (taskId: string): Promise<AutomationTaskRecord> => {
  requireEnabled();
  const task = await prisma.automationTask.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new Error('Automation task not found');
  }
  if (task.status === 'completed') {
    return task;
  }

  const user = await getDefaultUser();
  await prisma.automationTask.update({ where: { id: taskId }, data: { status: 'running' } });
  await audit(user.id, task.action, 'approved', task.target ?? undefined, task.title, task.id);

  try {
    const result = await executeAction(task.action as AutomationAction, task.target);
    const completed = await prisma.automationTask.update({
      where: { id: taskId },
      data: { status: 'completed', result, error: null, completedAt: new Date() },
    });
    await audit(user.id, task.action, 'completed', task.target ?? undefined, result, task.id);
    return completed;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Automation failed';
    const failed = await prisma.automationTask.update({
      where: { id: taskId },
      data: { status: 'failed', error: message, completedAt: new Date() },
    });
    await audit(user.id, task.action, 'failed', task.target ?? undefined, message, task.id);
    return failed;
  }
};

const denyTask = async (taskId: string): Promise<AutomationTaskRecord> => {
  const task = await prisma.automationTask.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new Error('Automation task not found');
  }
  const user = await getDefaultUser();
  const denied = await prisma.automationTask.update({
    where: { id: taskId },
    data: { status: 'denied', completedAt: new Date() },
  });
  await audit(user.id, task.action, 'denied', task.target ?? undefined, 'Denied by user', task.id);
  return denied;
};

const listAudit = async (limit = 100) =>
  prisma.automationAuditLog.findMany({ orderBy: { timestamp: 'desc' }, take: limit });

const clearHistory = async () => {
  await prisma.automationAuditLog.deleteMany({});
  await prisma.automationTask.deleteMany({
    where: { status: { in: ['completed', 'denied', 'failed'] } },
  });
  return { cleared: true };
};

const getStats = async () => {
  const [total, completed, failed, denied, pending] = await Promise.all([
    prisma.automationTask.count(),
    prisma.automationTask.count({ where: { status: 'completed' } }),
    prisma.automationTask.count({ where: { status: 'failed' } }),
    prisma.automationTask.count({ where: { status: 'denied' } }),
    prisma.automationTask.count({ where: { status: 'pending-approval' } }),
  ]);
  return { total, completed, failed, denied, pending };
};

const getCapabilities = () => ({
  enabled: isEnabled(),
  commandsAllowed: process.env.AUTOMATION_ALLOW_COMMANDS === 'true',
  playwrightAvailable: loadPlaywright() !== null,
  platform: process.platform,
  applications: Object.keys(APP_ALIASES).sort(),
  sites: Object.keys(KNOWN_SITES).sort(),
  actions: [
    { action: 'open_site', example: 'open netflix on brave' },
    { action: 'open_url', example: '/automate open https://youtube.com' },
    { action: 'youtube_play', example: 'play Michael Jackson on YouTube' },
    { action: 'youtube_search', example: '/automate search lofi beats' },
    { action: 'web_search', example: 'search for electron automation' },
    { action: 'open_app', example: 'open calculator' },
    {
      action: 'run_command',
      example: '/automate run dir (requires AUTOMATION_ALLOW_COMMANDS=true)',
    },
  ],
});

/**
 * Vocabulary for the offline speech recogniser's command grammar: every known
 * site, app alias and browser, flattened to lowercase phrases. Keeping it here
 * (rather than in the STT service) means new sites/apps are picked up by voice
 * automatically.
 */
export const getSpeechVocabulary = (): string[] => {
  const words = new Set<string>();
  for (const key of Object.keys(KNOWN_SITES)) words.add(key.toLowerCase());
  for (const key of Object.keys(APP_ALIASES)) words.add(key.toLowerCase());
  for (const browser of ['edge', 'chrome', 'firefox', 'brave']) words.add(browser);
  return [...words].sort();
};

export default {
  parseAutomationIntent,
  buildIntentFromAction,
  describeUnsupportedIntent,
  getSpeechVocabulary,
  isEnabled,
  createTask,
  getTask,
  listTasks,
  listPending,
  approveTask,
  denyTask,
  listAudit,
  clearHistory,
  getStats,
  getCapabilities,
};




