/*
 * SearchBlox search UI core. Framework-free ES module shared by the EDS widget,
 * the EDS block and the classic AEM embed. Talks to the SearchBlox Search API:
 *   GET {domain}/rest/v2/api/hybrid-search (default; /search when `vectorWeight` is 0)
 *   GET {domain}/rest/v2/api/autocomplete
 *   GET {domain}/rest/v2/api/smartsuggest (when `smartSuggest` names an index)
 *   POST {domain}/rest/v2/api/ai-overview (when `aiOverview` names collections)
 *   GET {domain}/rest/v2/api/smart-faq/* (unless `smartFaqs` is false)
 *   GET/POST {domain}/ui/v1/chatbot/* (when `chatbot` names a console chatbot)
 *   POST {domain}/rest/v2/api/recommendations (when `recommendations` is on)
 *   GET/POST {domain}/ui/v1/searchai-assist (when `assist` is on)
 *   POST {domain}/ui/v1/analytics/*, /ui/v1/featured-result/display-count (unless `analytics` is false)
 */

const DEFAULTS = {
  domain: '',
  collections: [],
  pageSize: 10,
  facets: [],
  checkboxFacets: ['topics', 'keywords'],
  autosuggest: true,
  suggestLimit: 6,
  smartSuggest: '',
  aiOverview: [],
  smartFaqs: true,
  chatbot: '',
  analytics: true,
  placeholder: 'Enter a search term...',
  resultsPage: '',
  queryParam: 'q',
  syncUrl: true,
  newTab: false,
  sort: 'relevance',
  vectorWeight: 0.2,
  vectorThreshold: 0.6,
  accent: '',
  scheme: 'auto',
  settings: false,
  recommendations: false,
  llmFields: 'off',
  assist: false,
};

const FACET_LABELS = {
  contenttype: 'Content Type',
  keywords: 'Keywords',
  colname: 'Collection',
};

// As in the SearchBlox search plugin: request up to 100 values per facet, show 5
// and add or remove 5 with "Show more"/"Show less"; facets with more than 5
// values get a search box that filters the list.
const FACET_SIZE = 100;
const FACET_SHOWN = 5;
const FACET_SEARCH_MIN = 5;
const HYBRID_MAX_PAGE_SIZE = 50;
const SUGGEST_DELAY = 200;
// SmartFAQs, as in the SearchBlox search plugin: 3 shown above the results (up to
// 10 with "Show all"), 3 in the suggestions once 3 characters are typed, answers
// cut to 150 characters until "Show more".
const FAQ_SHOWN = 3;
const FAQ_LIMIT = 10;
const FAQ_SUGGEST = 3;
const FAQ_SUGGEST_MIN = 3;
const FAQ_ANSWER_CHARS = 150;
const PAGE_WINDOW = 2;
const WIDE_LAYOUT = 720;
// As in the SearchBlox search plugin: AI recommendations start once 3 results
// have been opened and show 3; Assist takes up to 4 results, but no audio or video.
const VIEWED_TITLES = 3;
const RECOMMENDATIONS_SHOWN = 3;
const ASSIST_LIMIT = 4;
const ASSIST_SKIP = /^(mp3|mp4|wav|ogg|m4a|m4b|m4p|aac|flac|wma|aiff?|aifc|mid|avi|mov|wmv|webm|mkv|flv|gif)$/i;
const ASSIST_PROMPTS = ['analyze', 'compare', 'explain', 'highlights', 'summarize'];
const TOPICS_SHOWN = 5;

let instanceCount = 0;

// ------------------------------------------------------------------
// Config
// ------------------------------------------------------------------

const toList = (value) => {
  if (Array.isArray(value)) return value.map((v) => `${v}`.trim()).filter(Boolean);
  if (!value) return [];
  return `${value}`.split(',').map((v) => v.trim()).filter(Boolean);
};

const toBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return !['false', 'no', 'off', '0'].includes(`${value}`.trim().toLowerCase());
};

// A facet's selected values: one for radio facets, any number for checkbox ones.
const values = (value) => [].concat(value || []).filter(Boolean);

const toFraction = (value, fallback) => {
  const n = Number.parseFloat(value);
  return n >= 0 && n <= 1 ? n : fallback;
};

// "replace" or "both"; any other true value means "both", as the plugin's default.
const toLlmMode = (value) => {
  const mode = `${value ?? ''}`.trim().toLowerCase();
  if (['replace', 'both'].includes(mode)) return mode;
  return toBool(mode, false) ? 'both' : DEFAULTS.llmFields;
};

// Accepts "contenttype" or "contenttype:Content Type".
const parseFacets = (value) => toList(value).map((entry) => {
  const [field, ...label] = entry.split(':');
  const key = field.trim().toLowerCase();
  return { field: key, label: label.join(':').trim() || FACET_LABELS[key] || key };
});

/**
 * Normalises config from any source (data-* attributes, block table, plain object).
 * Keys are case/format tolerant: "page-size", "pagesize" and "pageSize" all work.
 */
export function normaliseConfig(raw = {}) {
  const flat = {};
  Object.entries(raw).forEach(([k, v]) => {
    flat[k.toLowerCase().replace(/[^a-z]/g, '')] = v;
  });

  const pageSize = Number.parseInt(flat.pagesize, 10);
  const suggestLimit = Number.parseInt(flat.suggestlimit, 10);
  const vectorWeight = toFraction(flat.vectorweight, DEFAULTS.vectorWeight);

  return {
    ...DEFAULTS,
    domain: `${flat.domain || ''}`.trim().replace(/\/+$/, ''),
    collections: toList(flat.collections),
    pageSize: Math.min(pageSize > 0 ? pageSize : DEFAULTS.pageSize, vectorWeight > 0 ? HYBRID_MAX_PAGE_SIZE : 100),
    facets: parseFacets(flat.facets),
    checkboxFacets: flat.checkboxfacets === undefined
      ? DEFAULTS.checkboxFacets
      : toList(flat.checkboxfacets).map((f) => f.toLowerCase()),
    autosuggest: toBool(flat.autosuggest, DEFAULTS.autosuggest),
    suggestLimit: suggestLimit > 0 ? suggestLimit : DEFAULTS.suggestLimit,
    smartSuggest: `${flat.smartsuggest || ''}`.trim(),
    aiOverview: toList(flat.aioverview),
    smartFaqs: toBool(flat.smartfaqs, DEFAULTS.smartFaqs),
    chatbot: `${flat.chatbot || ''}`.trim(),
    analytics: toBool(flat.analytics, DEFAULTS.analytics),
    placeholder: flat.placeholder || DEFAULTS.placeholder,
    resultsPage: `${flat.resultspage || ''}`.trim(),
    queryParam: flat.queryparam || DEFAULTS.queryParam,
    syncUrl: toBool(flat.syncurl, DEFAULTS.syncUrl),
    newTab: toBool(flat.newtab, DEFAULTS.newTab),
    sort: flat.sort || DEFAULTS.sort,
    vectorWeight,
    vectorThreshold: toFraction(flat.vectorthreshold, DEFAULTS.vectorThreshold),
    accent: `${flat.accent || ''}`.trim(),
    scheme: ['light', 'dark'].includes(flat.scheme) ? flat.scheme : DEFAULTS.scheme,
    settings: toBool(flat.settings, DEFAULTS.settings),
    recommendations: toBool(flat.recommendations, DEFAULTS.recommendations),
    llmFields: toLlmMode(flat.llmfields),
    assist: toBool(flat.assist, DEFAULTS.assist),
  };
}

// ------------------------------------------------------------------
// API
// ------------------------------------------------------------------

/**
 * Builds the Search API URL. `state` = { query, page, filters: { field: [values] } }.
 * Several values of one field narrow the results: SearchBlox requires all of them.
 * Hybrid search blends keyword and vector (meaning) matching: `v.weight` is the
 * vector share and `v.threshold` the minimum similarity. Terms are ORed, as in
 * the SearchBlox search plugin, so long natural-language queries still match.
 * `public=true` is what allows anonymous (token-less) search; only collections
 * marked Public in SearchBlox are returned.
 */
export function buildSearchUrl(config, state) {
  const params = new URLSearchParams();
  params.set('query', state.query || '*');
  params.set('page', `${state.page || 1}`);
  params.set('pagesize', `${config.pageSize}`);
  params.set('sort', config.sort);
  params.set('public', 'true');
  config.collections.forEach((col) => params.append('col', col));

  config.facets.forEach(({ field }) => {
    params.append('facet.field', field);
    params.set(`f.${field}.size`, `${FACET_SIZE}`);
  });

  Object.entries(state.filters || {}).forEach(([field, value]) => {
    values(value).forEach((v) => params.append(`f.${field}.filter`, v));
  });

  if (config.vectorWeight > 0) {
    params.set('v.weight', `${config.vectorWeight}`);
    params.set('v.threshold', `${config.vectorThreshold}`);
    params.set('default', 'OR');
    return `${config.domain}/rest/v2/api/hybrid-search?${params}`;
  }
  return `${config.domain}/rest/v2/api/search?${params}`;
}

export function buildSuggestUrl(config, query) {
  const params = new URLSearchParams({ query, limit: `${config.suggestLimit}`, public: 'true' });
  config.collections.forEach((col) => params.append('col', col));
  return `${config.domain}/rest/v2/api/autocomplete?${params}`;
}

// SmartSuggest suggests phrases from an index built on one collection
// (Collections > SmartSuggest in the console); `cname` is that collection's name.
export function buildSmartSuggestUrl(config, query) {
  const params = new URLSearchParams({ query, cname: config.smartSuggest, limit: `${config.suggestLimit}` });
  return `${config.domain}/rest/v2/api/smartsuggest?${params}`;
}

// Structured records (e.g. product feeds) come back with title "null" and url
// "db?url="; their name and link are in product_* fields. Only absolute http(s)
// URLs are kept, so a record with no web page renders without a link.
const text = (value) => (value && value !== 'null' ? `${value}` : '');
const webUrl = (...urls) => urls.find((u) => /^https?:\/\//i.test(u || '')) || '';

// One search result or recommendation. In a collection enriched by an LLM in
// SearchBlox, title and description hold the generated text and original_* the
// page's own; topics is a generated, comma-separated list.
const parseResult = (r) => {
  const url = webUrl(r.url, r.product_url, r.productUrl);
  return {
    uid: r.uid,
    col: r.col,
    position: Number(r.no) || undefined,
    url,
    title: text(r.title) || text(r.product_name) || url || 'Untitled',
    description: text(r.description) || text(r.context),
    contenttype: r.contenttype || '',
    colname: text(r.colname),
    lastmodified: r.lastmodified || '',
    // A page's share image, as the SearchBlox plugin uses for thumbnails.
    thumbnail: webUrl(r['og:image'], r['twitter:image'], r.thumbnail, r.image),
    originalTitle: text(r.original_title),
    originalDescription: text(r.original_description),
    topics: toList(text(r.topics)),
    pendingReview: `${r.needsReview}` === 'true' && `${r.approved}` !== 'true',
  };
};

/** Maps the raw Search API response into a small, stable shape for rendering. */
export function parseResponse(data = {}) {
  const facets = {};
  (data.facets || []).forEach((group) => {
    (group.facet || []).forEach((facet) => {
      facets[facet.name] = (facet.facetinner || [])
        .filter((item) => item.count > 0)
        .map((item) => ({ value: item.name, count: item.count }));
    });
  });

  return {
    hits: Number(data.hits) || 0,
    currentPage: Number(data.currentPage) || 1,
    lastPage: Number(data.lastPage) || 1,
    suggest: data.suggest || '',
    time: data.time,
    pcode: data.pcode || '',
    results: (data.result || []).map(parseResult),
    featured: (data.ads || []).map((ad) => ({
      uid: ad.uid,
      url: ad.url,
      title: ad.title,
      description: ad.description,
      image: ad.imageURL,
    })),
    facets,
  };
}

async function getJson(url, signal) {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`SearchBlox responded with ${res.status}`);
  return res.json();
}

async function postJson(url, body, signal) {
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`SearchBlox responded with ${res.status}`);
  return res.json();
}

export async function search(config, state, signal) {
  const pcode = config.analytics ? getPcode() : '';
  const url = `${buildSearchUrl(config, state)}${pcode ? `&pcode=${encodeURIComponent(pcode)}` : ''}`;
  const data = parseResponse(await getJson(url, signal));
  if (config.analytics) setPcode(data.pcode);
  return data;
}

// Autocomplete returns ["a", "b"]; SmartSuggest returns [{"0": "a", "1": "b"}].
const toSuggestions = (data) => [...new Set((Array.isArray(data) ? data : [data])
  .flatMap((item) => (item && typeof item === 'object' ? Object.values(item) : item))
  .filter((item) => typeof item === 'string' && item.trim()))];

/**
 * Suggestions for `query`. Uses SmartSuggest when configured, falling back to
 * autocomplete if the index is missing or has nothing for this prefix.
 */
export async function suggest(config, query, signal) {
  if (config.smartSuggest) {
    try {
      const items = toSuggestions(await getJson(buildSmartSuggestUrl(config, query), signal));
      if (items.length) return items;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
    }
  }
  return toSuggestions(await getJson(buildSuggestUrl(config, query), signal));
}

// SmartFAQs are question/answer pairs generated for a collection in the console.
const parseFaq = (f) => ({
  uid: f.uid, question: text(f.question), answer: text(f.answer), url: webUrl(f.url), collection: f.collections,
});

export async function smartFaqs(config, query, size, signal) {
  const params = new URLSearchParams({ status: 'active', query, size: `${size}` });
  if (config.collections.length) params.set('col', config.collections.join(','));
  const data = await getJson(`${config.domain}/rest/v2/api/smart-faq/list?${params}`, signal);
  return (data.smartFaq || []).filter((f) => f.uid && f.question).map(parseFaq);
}

export async function smartFaq(config, uid, signal) {
  const data = await getJson(`${config.domain}/rest/v2/api/smart-faq/get/${encodeURIComponent(uid)}`, signal);
  return data?.uid && data.question ? parseFaq(data) : null;
}

const samePage = (a, b) => (a.url && b.url
  ? a.url.replace(/\/+$/, '') === b.url.replace(/\/+$/, '')
  : a.uid === b.uid);

// AI recommendations: an LLM picks results related to the titles of the last
// few results the visitor opened.
export async function recommendations(config, { titles, query }, signal) {
  const data = await postJson(`${config.domain}/rest/v2/api/recommendations`, {
    viewedPageTitles: titles,
    numberOfRecommendations: RECOMMENDATIONS_SHOWN,
    originalQuery: query || '',
    ...(config.collections.length ? { col: config.collections } : {}),
  }, signal);
  return {
    sessionId: data.sessionId || '',
    // The same page can be indexed twice (e.g. with and without a trailing
    // slash) and come back twice; keep the first.
    items: (data.recommendations || []).map((r) => ({ ...parseResult(r), id: r.recommendationId }))
      .filter((r, i, all) => all.findIndex((o) => samePage(o, r)) === i),
  };
}

// SearchAI Assist: the actions (summarize, compare, ...) the server offers.
export async function assistPrompts(config, signal) {
  const data = await getJson(`${config.domain}/ui/v1/searchai-assist/prompts`, signal);
  const names = Object.keys(data?.prompts || {}).map((k) => k.replace(/^searchai-assist-/, '')).sort();
  return names.length ? names : ASSIST_PROMPTS;
}

/**
 * Runs an Assist action on the chosen results. Returns the answer as parts:
 * one text for the whole selection, or one per document ({ doc, text }).
 */
export async function assist(config, { operation, docs, prompt }, signal) {
  const data = await postJson(`${config.domain}/ui/v1/searchai-assist`, {
    operation,
    documents: docs.map((d) => ({ id: d.uid, collectionId: d.col })),
    customPrompt: prompt || '',
  }, signal);
  if (typeof data?.result === 'string') return [{ text: data.result }];
  if (typeof data?.documents === 'string') return [{ text: data.documents }];
  // Per document: { documentId, <operation>: text }.
  return (Array.isArray(data?.documents) ? data.documents : []).map((d) => {
    const key = Object.keys(d).find((k) => k !== 'documentId');
    return { doc: docs.find((r) => r.uid === d.documentId), text: text(d.result ?? d[key]) };
  }).filter((part) => part.text);
}

// ------------------------------------------------------------------
// Analytics
// ------------------------------------------------------------------

// The events the SearchBlox search plugin logs, so the console's analytics cover
// this widget. keepalive lets a click's log finish after the browser leaves the page.
export function track(config, path, body) {
  if (!config.analytics) return;
  fetch(`${config.domain}${path}`, {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

// pcode: SearchBlox's id for a search session. Each search returns one; sending it
// back links a visitor's searches and clicks. Kept for this tab only.
const PCODE_KEY = 'sb-pcode';

function getPcode() {
  try {
    return sessionStorage.getItem(PCODE_KEY) || '';
  } catch {
    return '';
  }
}

function setPcode(pcode) {
  try {
    if (pcode) sessionStorage.setItem(PCODE_KEY, pcode);
  } catch {
    // Storage blocked or unavailable: searches still work, just unlinked.
  }
}

// AI recommendations keep the titles of the last results opened, and the last
// recommendations, for this tab only. `undefined` removes the entry.
const VIEWED_KEY = 'sb-viewed';
const RECOMMENDATIONS_KEY = 'sb-recommendations';

function readSession(key, fallback) {
  try {
    return JSON.parse(sessionStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeSession(key, value) {
  try {
    if (value === undefined) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: recommendations then only follow opens on this page.
  }
}

const trackRecommendation = (config, body) => track(config, '/ui/v1/recommendations/track/click', body);

// SmartFAQ events: which FAQs were shown, and opens and link clicks.
const faqShown = (config, query, faqs) => faqs.length && track(config, '/rest/v2/api/smart-faq/impression', {
  smartfaq: faqs.map((f) => ({ uid: f.uid, collection: f.collection })), query, action: 'show', pcode: getPcode() || undefined,
});
const faqAction = (config, query, uid, action) => track(config, '/rest/v2/api/smart-faq/action', {
  uid, action, query, pcode: getPcode() || undefined,
});

// ------------------------------------------------------------------
// AI overview and chat
// ------------------------------------------------------------------

// When the server can't parse the LLM's JSON it passes the raw string through
// as `overview`, sometimes inside a ```json fence. Recover it if it parses.
function parseRawOverview(text) {
  const raw = `${text || ''}`.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
  if (!raw.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      overview: parsed.overview,
      keyPoints: parsed.key_points,
      citations: parsed.citations,
      followupQuestions: parsed.followup_questions,
    };
  } catch {
    return { overview: '' };
  }
}

/** Maps the AI overview response into { overview, keyPoints, sources, followups }. */
export function parseOverview(data = {}) {
  const fields = { ...data, ...parseRawOverview(data.overview) };
  const sources = [];
  (fields.citations || []).forEach((c) => {
    const url = safeUrl(c?.url);
    if (url && !sources.some((s) => s.url === url)) sources.push({ url, title: c.title || displayUrl(url) });
  });
  const strings = (list) => (Array.isArray(list) ? list.filter((v) => typeof v === 'string' && v.trim()) : []);
  return {
    // insufficientSupport: the retrieved content doesn't answer the query.
    overview: data.insufficientSupport ? '' : `${fields.overview || ''}`.trim(),
    keyPoints: strings(fields.keyPoints),
    sources,
    followups: strings(fields.followupQuestions),
  };
}

// Answers are grounded on chunks from the named collections (`cname`); the API
// rejects requests without one.
export async function overview(config, query, signal) {
  return parseOverview(await postJson(`${config.domain}/rest/v2/api/ai-overview`, {
    query,
    cname: config.aiOverview,
    includeCitations: true,
    includeNextSteps: true,
  }, signal));
}

// Chatbot answers cite sources inline as <source>url</source>. Database records
// cite "db?url=..." sources, which have no page to link to, so they're dropped.
export function parseChatAnswer(content) {
  const sources = [];
  const text = `${content || ''}`.replace(/<source>\s*([\s\S]*?)\s*<\/source>/gi, (_, url) => {
    const href = /^https?:\/\//i.test(url) ? safeUrl(url) : null;
    if (href && !sources.includes(href)) sources.push(href);
    return '';
  }).trim();
  return { text, sources };
}

// The console's "mask sensitive data" setting: hide these before the question
// leaves the browser. SSNs go before phone numbers, which would also match them.
const SENSITIVE = [
  ['bankingCards', /\b(?:\d[ -]?){12,18}\d\b/g],
  ['emailIds', /[\w.%+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi],
  ['ssn', /\b\d{3}-\d{2}-\d{4}\b/g],
  ['phoneNumbers', /\+?\d[\d\s().-]{7,}\d/g],
];

export function maskSensitive(text, rules = {}) {
  if (!rules.maskSensitiveData) return text;
  const patterns = SENSITIVE.filter(([key]) => rules[key] !== false).map(([, re]) => re);
  (rules.additionalPatterns || []).forEach((p) => {
    try {
      patterns.push(new RegExp(p, 'g'));
    } catch {
      // Ignore patterns this browser can't compile.
    }
  });
  return patterns.reduce((out, re) => out.replace(re, '####'), text);
}

const chatUrl = (config, path) => `${config.domain}/ui/v1/chatbot/${path}`;

export async function chatSettings(config, signal) {
  const data = await getJson(chatUrl(config, `settings/${encodeURIComponent(config.chatbot)}`), signal);
  if (!data.success) throw new Error(data.message || `Chatbot "${config.chatbot}" not found`);
  return {
    userLabel: 'You', botLabel: 'AI', initialMessage: 'Hello! What can I help you with?', ...data.chatBotSettings,
  };
}

/** One chat turn. The server keeps the history; we only send back its conversation id. */
export async function chat(config, { question, conversationId, useKg }, signal) {
  const data = await postJson(chatUrl(config, 'chat'), {
    chatbotname: config.chatbot,
    question,
    useKg,
    ...(conversationId ? { conversation_id: conversationId } : {}),
  }, signal);
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error(data.message || 'Empty chatbot response');
  return {
    id: data.id,
    conversationId: data.conversation_id,
    created: Number(data.created) || Date.now(),
    action: data.actions?.[0],
    ...parseChatAnswer(message.content),
  };
}

export const chatVote = (config, id, action) => postJson(chatUrl(config, 'action'), { message_id: id, action });

// ------------------------------------------------------------------
// DOM helpers
// ------------------------------------------------------------------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v === undefined || v === null || v === false) return;
    if (k === 'className') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : v);
  });
  children.flat().forEach((c) => {
    if (c !== undefined && c !== null && c !== false) node.append(c);
  });
  return node;
}

// Icons from the SearchBlox search plugin: Tabler icons (MIT) plus its "AI chip"
// (SVGRepo). All are 24px stroke icons drawn with currentColor.
const ICONS = {
  ai: 'M21 8H17.8174M21 12H18M21 16H17.8174M6.18257 8H3M8 6.18257V3M8 21L8 17.8174M12 6V3M12 21V18M16 6.18257V3M16 21V17.8174M6 12H3M6.18257 16H3M10.8 18H13.2C14.8802 18 15.7202 18 16.362 17.673C16.9265 17.3854 17.3854 16.9265 17.673 16.362C18 15.7202 18 14.8802 18 13.2V10.8C18 9.11984 18 8.27976 17.673 7.63803C17.3854 7.07354 16.9265 6.6146 16.362 6.32698C15.7202 6 14.8802 6 13.2 6H10.8C9.11984 6 8.27976 6 7.63803 6.32698C7.07354 6.6146 6.6146 7.07354 6.32698 7.63803C6 8.27976 6 9.11984 6 10.8V13.2C6 14.8802 6 15.7202 6.32698 16.362C6.6146 16.9265 7.07354 17.3854 7.63803 17.673C8.27976 18 9.11984 18 10.8 18ZM10 10H14V14H10V10Z',
  chat: 'M8 9h8M8 13h6M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12z',
  close: 'M18 6l-12 12M6 6l12 12',
  followup: 'M6 6v6a3 3 0 0 0 3 3h10l-4 -4m0 8l4 -4',
  filterPlus: 'M12 20l-3 1v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v3M16 19h6M19 16v6',
  filterMinus: 'M12 20l-3 1v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v3M16 19h6',
  regenerate: 'M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
  help: 'M12 16v.01M12 13a2 2 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483M10 20.777a8.942 8.942 0 0 1 -2.48 -.969M14 3.223a9.003 9.003 0 0 1 0 17.554M4.579 17.093a8.961 8.961 0 0 1 -1.227 -2.592M3.124 10.5c.16 -.95 .468 -1.85 .9 -2.675l.169 -.305M6.907 4.579a8.954 8.954 0 0 1 3.093 -1.356',
  reload: 'M19.933 13.041a8 8 0 1 1 -9.925 -8.788c3.899 -1 7.935 1.007 9.425 4.747M20 4v5h-5',
  search: 'M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0M21 21l-6 -6',
  chevronLeft: 'M15 6l-6 6l6 6',
  chevronRight: 'M9 6l6 6l-6 6',
  calendar: 'M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2zM16 3l0 4M8 3l0 4M4 11l16 0M8 15h2v2h-2z',
  file: 'M14 3v4a1 1 0 0 0 1 1h4M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z',
  layers: 'M12 4l-8 4l8 4l8 -4l-8 -4M4 12l8 4l8 -4M4 16l8 4l8 -4',
  stopwatch: 'M5 13a7 7 0 1 0 14 0a7 7 0 0 0 -14 0zM14.5 10.5l-2.5 2.5M17 8l1 -1M14 3h-4',
  send: 'M10 14l11 -11M21 3l-6.5 18a.55 .55 0 0 1 -1 0l-3.5 -7l-7 -3.5a.55 .55 0 0 1 0 -1l18 -6.5',
  up: 'M7 11v8a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1v-7a1 1 0 0 1 1 -1h3a4 4 0 0 0 4 -4v-1a2 2 0 0 1 4 0v5h3a2 2 0 0 1 2 2l-1 5a2 3 0 0 1 -2 2h-7a3 3 0 0 1 -3 -3',
  adjustments: 'M14 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M4 6l8 0M16 6l4 0M8 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M4 12l2 0M10 12l10 0M17 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M4 18l11 0M19 18l1 0',
  settings: 'M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065zM9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0',
  square: 'M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z',
  squareCheck: 'M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2zM9 12l2 2l4 -4',
  copy: 'M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667zM4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1',
  markdown: 'M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2zM7 15v-6l2 2l2 -2v6M14 13l2 2l2 -2M16 15v-6',
  check: 'M5 12l5 5l10 -10',
  sparkles: 'M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z',
  summarize: 'M11 6h9M11 12h9M12 18h8M4 16a2 2 0 1 1 4 0c0 .591 -.5 1 -1 1.5l-3 2.5h4M6 10v-6l-2 2',
  bulb: 'M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3M9.7 17l4.6 0',
  explain: 'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0M12 16v.01M12 13a2 2 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483',
  edit: 'M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415zM16 5l3 3',
  quote: 'M10 11h-4a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1h3a1 1 0 0 1 1 1v6c0 2.667 -1.333 4.333 -4 5M19 11h-4a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1h3a1 1 0 0 1 1 1v6c0 2.667 -1.333 4.333 -4 5',
  down: 'M7 13v-8a1 1 0 0 0 -1 -1h-2a1 1 0 0 0 -1 1v7a1 1 0 0 0 1 1h3a4 4 0 0 1 4 4v1a2 2 0 0 0 4 0v-5h3a2 2 0 0 0 2 -2l-1 -5a2 3 0 0 0 -2 -2h-7a3 3 0 0 0 -3 3',
};

function icon(name, size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  Object.entries({
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false',
  }).forEach(([k, v]) => svg.setAttribute(k, v));
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

// Minimal markdown for LLM answers: paragraphs, "-"/"1." lists, # headings,
// "|" tables, "---" rules and **bold**, built as DOM nodes so answer text can
// never become HTML.
const inline = (text) => text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? el('strong', {}, part) : part));

function markdown(text) {
  const nodes = [];
  `${text}`.split(/\n\s*\n/).forEach((block) => {
    let list;
    let item0; // the last top-level list item, for indented sub-items
    let para;
    let table;
    block.split('\n').forEach((raw) => {
      const line = raw.trim();
      if (!line) return;
      const row = /^\|(.*)\|$/.exec(line);
      if (row) {
        const cells = row[1].split('|').map((c) => c.trim());
        list = null;
        item0 = null;
        para = null;
        if (cells.every((c) => /^:?-+:?$/.test(c))) return; // header separator
        if (!table) {
          table = el('tbody');
          nodes.push(el('div', { className: 'sb-table' }, el('table', {},
            el('thead', {}, el('tr', {}, cells.map((c) => el('th', {}, inline(c))))), table)));
        } else {
          table.append(el('tr', {}, cells.map((c) => el('td', {}, inline(c)))));
        }
        return;
      }
      table = null;
      if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
        nodes.push(el('hr'));
        list = null;
        item0 = null;
        para = null;
        return;
      }
      const item = /^(?:[-*•]|(\d+)[.)])\s+(.*)$/.exec(line);
      const heading = /^#{1,6}\s+(.*)$/.exec(line);
      if (item) {
        const tag = item[1] ? 'OL' : 'UL';
        if (item0 && /^\s{2,}/.test(raw)) {
          let sub = item0.lastElementChild;
          if (sub?.tagName !== tag) {
            sub = el(tag.toLowerCase());
            item0.append(sub);
          }
          sub.append(el('li', {}, inline(item[2])));
        } else {
          // A numbered list broken up by other lines keeps its numbering.
          if (list?.tagName !== tag) {
            list = el(tag.toLowerCase(), { start: item[1] > 1 ? item[1] : undefined });
            nodes.push(list);
          }
          item0 = el('li', {}, inline(item[2]));
          list.append(item0);
        }
        para = null;
      } else if (heading) {
        nodes.push(el('p', {}, el('strong', {}, heading[1].replace(/\*\*/g, ''))));
        list = null;
        item0 = null;
        para = null;
      } else if (para) {
        para.append(' ', ...inline(line));
      } else {
        para = el('p', {}, inline(line));
        nodes.push(para);
        list = null;
        item0 = null;
      }
    });
  });
  return nodes;
}

// SearchBlox marks matched terms with <highlight>. Build text nodes + <mark>
// instead of using innerHTML so indexed content can never inject markup.
function highlighted(text) {
  const frag = document.createDocumentFragment();
  `${text}`.split(/(<highlight>.*?<\/highlight>)/gi).forEach((part) => {
    const match = part.match(/^<highlight>(.*?)<\/highlight>$/i);
    if (match) frag.append(el('mark', {}, stripTags(match[1])));
    else if (part) frag.append(stripTags(part));
  });
  return frag;
}

// <template> parses inertly (no scripts, no image loads) and, unlike
// DOMParser's <body>, keeps leading/trailing whitespace around highlights.
function stripTags(text) {
  const tpl = document.createElement('template');
  tpl.innerHTML = `${text}`;
  return tpl.content.textContent || '';
}

function safeUrl(url) {
  try {
    const parsed = new URL(url, globalThis.location?.href);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function displayUrl(url) {
  try {
    const { host, pathname } = new URL(url);
    return `${host}${pathname === '/' ? '' : pathname}`;
  } catch {
    return url;
  }
}

// ------------------------------------------------------------------
// URL state
// ------------------------------------------------------------------

function readUrlState(config) {
  const params = new URLSearchParams(window.location.search);
  const filters = {};
  config.facets.forEach(({ field }) => {
    const selected = params.getAll(`f.${field}`).filter(Boolean);
    if (selected.length) filters[field] = selected;
  });
  return {
    query: params.get(config.queryParam) || '',
    page: Number.parseInt(params.get('page'), 10) || 1,
    filters,
    faq: params.get('faq') || '',
  };
}

function writeUrlState(config, state) {
  if (!config.syncUrl) return;
  const url = new URL(window.location.href);
  url.searchParams.set(config.queryParam, state.query);
  if (state.page > 1) url.searchParams.set('page', state.page);
  else url.searchParams.delete('page');
  if (state.faq) url.searchParams.set('faq', state.faq);
  else url.searchParams.delete('faq');
  config.facets.forEach(({ field }) => {
    url.searchParams.delete(`f.${field}`);
    values(state.filters[field]).forEach((v) => url.searchParams.append(`f.${field}`, v));
  });
  window.history.replaceState(null, '', url);
}

// ------------------------------------------------------------------
// UI
// ------------------------------------------------------------------

function ensureSkeleton(root, config) {
  if (!root.querySelector('.sb-form')) {
    root.append(
      el('form', { className: 'sb-form', role: 'search' },
        el('div', { className: 'sb-input-wrap' },
          el('input', { className: 'sb-input', type: 'search', autocomplete: 'off' }),
          el('ul', { className: 'sb-suggestions', role: 'listbox', hidden: true })),
        el('button', { className: 'sb-submit', type: 'submit' }, 'Search')),
      el('div', { className: 'sb-status', 'aria-live': 'polite' }),
      el('div', { className: 'sb-body' },
        el('aside', { className: 'sb-facets', hidden: true }),
        el('div', { className: 'sb-main' },
          el('ol', { className: 'sb-featured', hidden: true }),
          el('ol', { className: 'sb-results' }),
          el('nav', { className: 'sb-pagination', 'aria-label': 'Search results pages' }))),
    );
  }

  instanceCount += 1;
  const id = `sb-${instanceCount}`;
  const input = root.querySelector('.sb-input');
  const list = root.querySelector('.sb-suggestions');
  input.placeholder = config.placeholder;
  input.setAttribute('aria-label', config.placeholder);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', `${id}-suggestions`);
  input.id = input.id || id;
  const submit = root.querySelector('.sb-submit');
  submit.replaceChildren(icon('search', 20));
  submit.setAttribute('aria-label', 'Search');
  submit.title = 'Search';
  list.id = `${id}-suggestions`;

  // Facets toggle next to the results count, as in the SearchBlox plugin: the
  // sidebar starts hidden on wide layouts. Narrow layouts use the "Filters" section.
  if (!config.resultsPage && !root.querySelector('.sb-facets-toggle')) {
    const status = root.querySelector('.sb-status');
    const toggle = el('button', {
      type: 'button', className: 'sb-facets-toggle', hidden: true, 'aria-controls': `${id}-facets`,
      onClick: () => setFacetsShown(root, !root.classList.contains('sb-facets-open')),
    });
    const summary = el('div', { className: 'sb-summary' });
    status.before(summary);
    summary.append(toggle, status);
    root.querySelector('.sb-facets').id = `${id}-facets`;
    setFacetsShown(root, false);
  }

  // A box-only instance (header search) never shows results.
  if (config.resultsPage) {
    root.classList.add('sb-box-only');
    root.querySelector('.sb-status')?.remove();
    root.querySelector('.sb-body')?.remove();
  }
}

function setFacetsShown(root, shown) {
  const toggle = root.querySelector('.sb-facets-toggle');
  const label = `${shown ? 'Hide' : 'Show'} facet filters`;
  root.classList.toggle('sb-facets-open', shown);
  toggle.replaceChildren(icon(shown ? 'filterMinus' : 'filterPlus', 24));
  toggle.setAttribute('aria-expanded', `${shown}`);
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
}

// `ui` connects the cards to the mount: onOpen(result) when one is opened,
// filter(field, value) for topic chips, and the Assist selection when it's on.
function renderResults(root, config, data, state, ui = {}) {
  const status = root.querySelector('.sb-status');
  const resultsEl = root.querySelector('.sb-results');
  const featuredEl = root.querySelector('.sb-featured');
  const target = config.newTab ? '_blank' : undefined;
  const rel = config.newTab ? 'noopener' : undefined;

  const query = el('strong', {}, el('em', {}, state.query));
  status.replaceChildren(...(data.hits
    ? [`${data.hits.toLocaleString()} result${data.hits === 1 ? '' : 's'} for `, query]
    : ['No results for ', query, '.']));
  if (data.suggest && data.suggest.toLowerCase() !== state.query.toLowerCase()) {
    status.append(' Did you mean ', el('button', {
      type: 'button',
      className: 'sb-link-button',
      onClick: () => root.sbRun({ query: data.suggest, page: 1, filters: {} }),
    }, data.suggest), '?');
  }

  const featured = state.page === 1 ? data.featured.filter((f) => safeUrl(f.url)) : [];
  featuredEl.hidden = featured.length === 0;
  featuredEl.replaceChildren(...featured.map((f) => el('li', { className: 'sb-featured-item' },
    f.image && safeUrl(f.image) ? el('img', {
      src: safeUrl(f.image), alt: '', loading: 'lazy', onError: (e) => e.target.remove(),
    }) : null,
    el('div', {},
      el('span', { className: 'sb-badge' }, 'Featured'),
      el('a', {
        href: safeUrl(f.url),
        target,
        rel,
        onClick: () => track(config, '/ui/v1/analytics/fr', { uid: f.uid, query: state.query }),
      }, f.title || displayUrl(f.url)),
      f.description ? el('p', {}, f.description) : null))));

  if (featured.length) {
    track(config, '/ui/v1/featured-result/display-count', { uids: featured.map((f) => f.uid) });
  }

  renderResultList(root, config, data, state, ui);
  renderFacets(root, config, data, state);
  renderPagination(root, data, state);
}

// LLM-generated fields, as in the SearchBlox plugin. "off": the page's own title
// and description. "replace": the generated ones, with topics. "both": the
// page's own, plus a box with the generated ones. Results still awaiting review
// in the console always show the page's own.
function llmView(config, r) {
  const own = { title: r.originalTitle || r.title, description: r.originalDescription || r.description };
  if (config.llmFields === 'off' || r.pendingReview) return own;
  if (config.llmFields === 'replace') return { title: r.title, description: r.description, topics: r.topics };
  if (!r.originalTitle && !r.originalDescription) return own;
  return {
    ...own,
    generated: {
      title: r.originalTitle ? r.title : '',
      description: r.originalDescription ? r.description : '',
      topics: r.topics,
    },
  };
}

// Topic chips; with a "topics" facet, picking one filters by it.
function topicList(config, topics, ui) {
  const list = el('ul', { className: 'sb-topics', 'aria-label': 'Topics' });
  const filterable = ui.filter && config.facets.some((f) => f.field === 'topics');
  const show = (all) => list.replaceChildren(
    ...topics.slice(0, all ? undefined : TOPICS_SHOWN).map((topic) => el('li', {}, filterable
      ? el('button', {
        type: 'button', className: 'sb-topic', title: `Filter by topic: ${topic}`, onClick: () => ui.filter('topics', topic.toLowerCase()),
      }, topic)
      : el('span', { className: 'sb-topic' }, topic))),
    topics.length > TOPICS_SHOWN ? el('li', {}, el('button', {
      type: 'button', className: 'sb-link-button sb-topics-more', onClick: () => show(!all),
    }, all ? 'Show less' : `+${topics.length - TOPICS_SHOWN} more`)) : null,
  );
  show(false);
  return list;
}

// The Assist checkbox-button on a card; syncAssist() updates them all in place.
function assistButton(r, picker) {
  const button = el('button', { type: 'button', className: 'sb-assist-pick', onClick: () => picker.toggle(r) });
  button.sbResult = r;
  syncAssistButton(button, picker);
  return button;
}

function syncAssistButton(button, picker) {
  const picked = picker.has(button.sbResult);
  const full = !picked && picker.full();
  button.replaceChildren(icon(picked ? 'squareCheck' : 'square', 16), 'SearchAI Assist');
  button.setAttribute('aria-pressed', `${picked}`);
  button.disabled = full;
  button.title = full ? `Up to ${ASSIST_LIMIT} results can be used at once` : `${picked ? 'Remove from' : 'Add to'} SearchAI Assist`;
}

function syncAssist(root, picker) {
  root.querySelectorAll('.sb-assist-pick').forEach((b) => syncAssistButton(b, picker));
}

function renderResultList(root, config, data, state, ui) {
  const resultsEl = root.querySelector('.sb-results');
  const target = config.newTab ? '_blank' : undefined;
  const rel = config.newTab ? 'noopener' : undefined;

  resultsEl.setAttribute('start', `${(state.page - 1) * config.pageSize + 1}`);
  resultsEl.replaceChildren(...data.results.map((r, i) => {
    const href = safeUrl(r.url);
    const date = formatDate(r.lastmodified);
    const logClick = () => track(config, '/ui/v1/analytics/click', {
      collection: r.col,
      query: state.query,
      title: stripTags(r.title),
      uid: r.uid,
      url: r.url,
      pcode: getPcode() || undefined,
      pos: r.position || (state.page - 1) * config.pageSize + i + 1,
      page: state.page,
      pageSize: config.pageSize,
    });
    const opened = () => {
      logClick();
      ui.onOpen?.(r);
    };
    const shown = llmView(config, r);
    const picker = ui.assist && r.uid && !ASSIST_SKIP.test(r.contenttype) ? ui.assist : null;
    const detail = (name, label, ...content) => el('span', { className: 'sb-result-detail', title: label }, icon(name, 16), ...content);
    // A card like the SearchBlox plugin's: title, description, URL and thumbnail,
    // then a strip with the date, file type and collection.
    return el('li', { className: 'sb-result' },
      el('div', { className: 'sb-result-content' },
        el('div', { className: 'sb-result-fields' },
          el('h3', { className: 'sb-result-title' },
            href ? el('a', {
              href,
              target,
              rel,
              onClick: opened,
              // Middle-click opens a new tab without a click event.
              onAuxclick: (e) => e.button === 1 && opened(),
            }, highlighted(shown.title)) : highlighted(shown.title)),
          // Both are cut short by CSS; the tooltip shows the full text.
          shown.description ? el('p', { className: 'sb-result-desc', title: stripTags(shown.description) }, highlighted(shown.description)) : null,
          href ? el('div', { className: 'sb-result-url', title: href }, href) : null,
          shown.topics?.length ? topicList(config, shown.topics, ui) : null),
        r.thumbnail ? el('img', {
          className: 'sb-result-thumb', src: r.thumbnail, alt: '', loading: 'lazy', onError: (e) => e.target.remove(),
        }) : null),
      shown.generated ? el('div', { className: 'sb-llm' },
        el('p', { className: 'sb-llm-label' }, icon('ai', 16), 'LLM-generated'),
        shown.generated.title ? el('p', { className: 'sb-llm-title' }, highlighted(shown.generated.title)) : null,
        shown.generated.description ? el('p', { className: 'sb-llm-desc' }, highlighted(shown.generated.description)) : null,
        shown.generated.topics.length ? topicList(config, shown.generated.topics, ui) : null) : null,
      date || r.contenttype || r.colname || picker ? el('div', { className: 'sb-result-details' },
        date ? detail('calendar', 'Last modified', el('time', { datetime: r.lastmodified }, date)) : null,
        r.contenttype ? detail('file', 'Content type', r.contenttype.toLowerCase()) : null,
        r.colname ? detail('layers', 'Collection', r.colname) : null,
        picker ? assistButton(r, picker) : null) : null);
  }));
}

function renderFacets(root, config, data, state) {
  const facetsEl = root.querySelector('.sb-facets');
  const selectedIn = (field) => values(state.filters[field]);
  // Hybrid search counts facet values over a wider match set than the results it
  // returns (e.g. 232 next to 50 results), so counts are only shown for keyword search.
  const showCounts = config.vectorWeight === 0;
  const groups = config.facets
    .map((facet) => ({ ...facet, items: data.facets[facet.field] || [] }))
    .filter((facet) => facet.items.length || selectedIn(facet.field).length);

  // Filtering re-renders the sidebar; keep keyboard focus on the same option.
  const focusedKey = facetsEl.contains(document.activeElement) ? document.activeElement.dataset.key : undefined;
  facetsEl.hidden = groups.length === 0;
  const toggle = root.querySelector('.sb-facets-toggle');
  if (toggle) toggle.hidden = facetsEl.hidden;
  const activeCount = config.facets.reduce((n, { field }) => n + selectedIn(field).length, 0);
  const details = el('details', { className: 'sb-filters' },
    el('summary', {}, activeCount ? `Filters (${activeCount})` : 'Filters'));
  // Collapsed on narrow layouts so results stay above the fold; CSS hides the
  // summary on wide layouts where the facets sit in a sidebar.
  details.open = root.clientWidth >= WIDE_LAYOUT || facetsEl.querySelector('details')?.open === true;
  facetsEl.replaceChildren(details);

  const instance = root.querySelector('.sb-input').id;
  // How many values each facet shows and its search text, kept across re-renders
  // for the same query.
  if (root.sbFacetView?.query !== state.query) root.sbFacetView = { query: state.query, fields: {} };
  const apply = (field, next) => root.sbRun({ ...state, page: 1, filters: { ...state.filters, [field]: next } });

  // Checkbox facets take any number of values; the rest are radios with "All".
  details.append(...groups.map((facet) => {
    const { field } = facet;
    const selected = selectedIn(field);
    const multi = config.checkboxFacets.includes(field);
    const headingId = `${instance}-facet-${field}`;
    const option = (value, label, count) => {
      const active = value ? selected.includes(value) : selected.length === 0;
      return el('li', {},
        el('label', { className: `sb-facet-option${active && value ? ' is-active' : ''}` },
          el('input', {
            type: multi ? 'checkbox' : 'radio',
            name: `${instance}-${field}`,
            value,
            checked: active,
            'data-key': `${field}:${value}`,
            onChange: () => apply(field, multi
              ? (active ? selected.filter((v) => v !== value) : [...selected, value])
              : values(value)),
          }),
          el('span', { className: 'sb-facet-name' }, label),
          showCounts && count !== undefined ? el('span', { className: 'sb-count' }, count.toLocaleString()) : null));
    };
    const view = root.sbFacetView.fields[field] || { shown: FACET_SHOWN, search: '' };
    root.sbFacetView.fields[field] = view;
    const list = el('ul', { role: multi ? 'group' : 'radiogroup', 'aria-labelledby': headingId });
    const more = el('div', { className: 'sb-facet-more' });

    // Redraws only this facet's list (no new search). Selected values stay
    // visible even beyond the shown count.
    const draw = (focusAction) => {
      const term = view.search.trim().toLowerCase();
      const matches = facet.items.filter((item) => item.value.toLowerCase().includes(term));
      const visible = matches.slice(0, view.shown);
      const hiddenSelected = matches.filter((item) => selected.includes(item.value) && !visible.includes(item));
      // replaceChildren() would render null as text, so filter the empty slots out.
      list.replaceChildren(...[
        multi ? null : option('', 'All'),
        ...[...visible, ...hiddenSelected].map((item) => option(item.value, item.value, item.count)),
        matches.length ? null : el('li', { className: 'sb-facet-empty' }, 'No filters found.'),
      ].filter(Boolean));
      const step = (action, label, shown) => el('button', {
        type: 'button',
        className: 'sb-link-button',
        'data-action': action,
        onClick: () => {
          view.shown = shown;
          draw(action);
        },
      }, label);
      more.replaceChildren(...[
        matches.length > view.shown ? step('more', 'Show more', view.shown + FACET_SHOWN) : null,
        view.shown > FACET_SHOWN && matches.length > FACET_SHOWN
          ? step('less', 'Show less', Math.max(FACET_SHOWN, view.shown - FACET_SHOWN)) : null,
        multi && selected.length ? el('button', {
          type: 'button',
          className: 'sb-link-button',
          onClick: () => apply(field, []),
        }, 'Clear') : null,
      ].filter(Boolean));
      // Keep focus on the button pressed, or the other one if it's gone.
      if (focusAction) (more.querySelector(`[data-action="${focusAction}"]`) || more.querySelector('button'))?.focus();
    };
    draw();

    return el('div', { className: 'sb-facet' },
      el('h4', { id: headingId }, facet.label),
      facet.items.length > FACET_SEARCH_MIN ? el('input', {
        type: 'search',
        className: 'sb-facet-search',
        placeholder: 'Search',
        'aria-label': `Search ${facet.label}`,
        autocomplete: 'off',
        value: view.search,
        onInput: (e) => {
          view.search = e.target.value;
          draw();
        },
      }) : null,
      list,
      more);
  }));

  if (focusedKey) {
    [...facetsEl.querySelectorAll('input')].find((input) => input.dataset.key === focusedKey)?.focus();
  }
}

function renderPagination(root, data, state) {
  const nav = root.querySelector('.sb-pagination');
  const last = Math.max(1, data.lastPage);
  if (last <= 1) {
    nav.replaceChildren();
    return;
  }

  const go = (page) => () => {
    root.sbRun({ ...state, page });
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const pageButton = (page) => el('button', {
    type: 'button',
    className: `sb-page${page === state.page ? ' is-active' : ''}`,
    'aria-current': page === state.page ? 'page' : undefined,
    onClick: go(page),
  }, `${page}`);

  const start = Math.max(1, state.page - PAGE_WINDOW);
  const end = Math.min(last, state.page + PAGE_WINDOW);
  const pages = [];
  for (let p = start; p <= end; p += 1) pages.push(pageButton(p));

  nav.replaceChildren(
    el('button', {
      type: 'button', className: 'sb-page sb-page-step', 'aria-label': 'Previous page', title: 'Previous page', disabled: state.page <= 1, onClick: go(state.page - 1),
    }, icon('chevronLeft', 20)),
    ...pages,
    el('button', {
      type: 'button', className: 'sb-page sb-page-step', 'aria-label': 'Next page', title: 'Next page', disabled: state.page >= last, onClick: go(state.page + 1),
    }, icon('chevronRight', 20)),
  );
}

// `ai` is null while loading, or the parsed overview plus how long it took.
// Laid out like the SearchBlox plugin's: header with regenerate, answer, Key
// Points, sources, related questions and the generation time.
function renderOverview(root, config, ai, regenerate) {
  let panel = root.querySelector('.sb-ai');
  if (!panel) {
    panel = el('section', { className: 'sb-ai', 'aria-labelledby': `${root.querySelector('.sb-input').id}-ai` });
    (root.querySelector('.sb-faqs') || root.querySelector('.sb-recs') || resultsTop(root)).before(panel);
  }
  const heading = el('div', { className: 'sb-ai-header' },
    el('h2', { className: 'sb-ai-title', id: `${root.querySelector('.sb-input').id}-ai` }, icon('ai'), 'AI Overview'),
    ai && regenerate ? el('button', {
      type: 'button',
      className: 'sb-ai-regenerate',
      'aria-label': 'Regenerate answer',
      title: 'Regenerate answer',
      onClick: regenerate,
    }, icon('regenerate')) : null);

  if (!ai) {
    panel.hidden = false;
    panel.setAttribute('aria-busy', 'true');
    panel.replaceChildren(heading,
      el('p', { className: 'sb-ai-status' }, 'Generating an answer…'),
      el('div', { className: 'sb-ai-loading', 'aria-hidden': 'true' }, el('span'), el('span'), el('span')));
    return;
  }

  panel.removeAttribute('aria-busy');
  panel.hidden = !ai.overview;
  if (!ai.overview) {
    panel.replaceChildren();
    return;
  }
  const target = config.newTab ? '_blank' : undefined;
  const rel = config.newTab ? 'noopener' : undefined;
  panel.replaceChildren(...[heading,
    el('div', { className: 'sb-ai-text' }, markdown(ai.overview)),
    ai.keyPoints.length ? el('div', { className: 'sb-ai-keypoints' },
      el('h3', {}, 'Key Points'),
      el('ul', { className: 'sb-ai-points' }, ai.keyPoints.map((point) => el('li', {}, point)))) : null,
    ai.sources.length ? el('div', { className: 'sb-ai-sources' },
      el('h3', {}, 'Sources'),
      el('ol', {}, ai.sources.map((s) => el('li', {}, el('a', { href: s.url, target, rel }, s.title))))) : null,
    ai.followups.length ? el('div', { className: 'sb-ai-followups' },
      el('h3', {}, 'Related questions'),
      el('ul', {}, ai.followups.map((q) => el('li', {}, el('button', {
        type: 'button',
        onClick: () => root.sbRun({ query: q, page: 1, filters: {} }),
      }, icon('followup', 16), q))))) : null,
    ai.duration ? el('p', { className: 'sb-ai-time' }, icon('stopwatch', 14), `Generated in ${ai.duration}`) : null,
  ].filter(Boolean));
}

// The AI overview and SmartFAQs go between the search box and the results count,
// above the facets and results: filtering doesn't change them.
const resultsTop = (root) => root.querySelector('.sb-summary') || root.querySelector('.sb-status');

// One FAQ as a <details>; FAQs sharing `group` open one at a time.
function faqItem(config, query, faq, group, open = false) {
  const answer = stripTags(faq.answer);
  const short = answer.length > FAQ_ANSWER_CHARS ? `${answer.slice(0, FAQ_ANSWER_CHARS).trimEnd()}…` : answer;
  const answerText = el('span', {}, short);
  const details = el('details', { className: 'sb-faq', name: group, open },
    el('summary', {}, el('span', {}, highlighted(faq.question))),
    el('div', { className: 'sb-faq-body' },
      el('p', {}, answerText, short === answer ? null : ' ', short === answer ? null : el('button', {
        type: 'button',
        className: 'sb-link-button',
        'aria-expanded': 'false',
        onClick: (e) => {
          const more = e.currentTarget.getAttribute('aria-expanded') !== 'true';
          answerText.textContent = more ? answer : short;
          e.currentTarget.setAttribute('aria-expanded', `${more}`);
          e.currentTarget.textContent = more ? 'Show less' : 'Show more';
        },
      }, 'Show more')),
      faq.url ? el('a', {
        className: 'sb-faq-url',
        href: faq.url,
        target: '_blank',
        rel: 'noopener',
        onClick: () => faqAction(config, query, faq.uid, 'click'),
      }, displayUrl(faq.url)) : null,
      // Votes are feedback the visitor chooses to give, so they're sent even with analytics off.
      votes((action) => postJson(`${config.domain}/rest/v2/api/smart-faq/action`, {
        uid: faq.uid, action, query, pcode: getPcode() || undefined,
      }))));
  // Also fires for a FAQ rendered open, which counts as opening it.
  details.addEventListener('toggle', () => {
    if (details.open) faqAction(config, query, faq.uid, 'open');
  });
  return details;
}

// The SmartFAQs section above the results. `selected` is the FAQ picked from the
// suggestions, shown open at the top.
function renderFaqs(root, config, query, { faqs, selected }) {
  const id = `${root.querySelector('.sb-input').id}-faqs`;
  let section = root.querySelector('.sb-faqs');
  if (!section) {
    section = el('section', { className: 'sb-faqs', 'aria-labelledby': id });
    (root.querySelector('.sb-recs') || resultsTop(root)).before(section);
  }
  const others = faqs.filter((f) => f.uid !== selected?.uid);
  section.hidden = !selected && !others.length;
  if (section.hidden) {
    section.replaceChildren();
    return;
  }

  const list = el('ul', { className: 'sb-faq-list' });
  const showAll = el('button', { type: 'button', className: 'sb-link-button sb-faq-all' }, 'Show all');
  let shown = 0;
  const reveal = (count) => {
    const next = others.slice(shown, count);
    list.append(...next.map((faq) => el('li', {}, faqItem(config, query, faq, id))));
    faqShown(config, query, next);
    shown = Math.max(shown, Math.min(count, others.length));
    showAll.hidden = shown >= others.length;
  };
  showAll.addEventListener('click', () => reveal(others.length));
  section.replaceChildren(...[
    el('h2', { className: 'sb-faqs-title', id }, icon('help'), 'SmartFAQs'),
    selected ? faqItem(config, query, selected, id, true) : null,
    list,
    showAll,
  ].filter(Boolean));
  if (selected) faqShown(config, query, [selected]);
  reveal(FAQ_SHOWN);
}

// AI recommendations, between the SmartFAQs and the results. `recs` is
// { items, sessionId, previous: [uids] } or null; `loading` shows placeholders
// (or a note beside the heading while earlier recommendations are shown).
function renderRecommendations(root, config, recs, { loading, query }) {
  const id = `${root.querySelector('.sb-input').id}-recs`;
  let section = root.querySelector('.sb-recs');
  if (!section) {
    section = el('section', { className: 'sb-recs', 'aria-labelledby': id });
    resultsTop(root).before(section);
  }
  const items = recs?.items || [];
  section.hidden = !loading && !items.length;
  if (section.hidden) {
    section.replaceChildren();
    return;
  }
  const previous = recs?.previous || [];
  const target = config.newTab ? '_blank' : undefined;
  const rel = config.newTab ? 'noopener' : undefined;
  section.setAttribute('aria-busy', `${Boolean(loading)}`);
  section.replaceChildren(
    el('h2', { className: 'sb-ai-title', id }, icon('ai'), 'Personalized AI-Recommended Results',
      loading && items.length ? el('span', { className: 'sb-recs-updating' }, 'Updating…') : null),
    items.length ? el('ul', { className: 'sb-recs-list' }, items.map((r, i) => {
      const href = safeUrl(r.url);
      const date = formatDate(r.lastmodified);
      const isNew = previous.length > 0 && !previous.includes(r.uid);
      const open = () => trackRecommendation(config, {
        sessionId: recs.sessionId,
        recommendationId: r.id,
        position: i + 1,
        collections: [r.colname],
        query,
        url: r.url,
      });
      return el('li', { className: 'sb-rec' },
        el('h3', { className: 'sb-result-title' },
          href ? el('a', {
            href, target, rel, onClick: open, onAuxclick: (e) => e.button === 1 && open(),
          }, highlighted(r.title)) : highlighted(r.title),
          isNew ? el('span', { className: 'sb-rec-new' }, icon('sparkles', 14), 'New') : null),
        r.description ? el('p', { className: 'sb-result-desc', title: stripTags(r.description) }, stripTags(r.description)) : null,
        href ? el('div', { className: 'sb-result-url', title: href }, href) : null,
        date || r.colname ? el('div', { className: 'sb-rec-details' },
          date ? el('span', { className: 'sb-result-detail', title: 'Last modified' }, icon('calendar', 14), date) : null,
          r.colname ? el('span', { className: 'sb-result-detail', title: 'Collection' }, icon('layers', 14), r.colname) : null) : null);
    })) : el('div', { className: 'sb-ai-loading', 'aria-label': 'Finding recommendations' }, el('span'), el('span'), el('span')),
  );
}

function wireSuggestions(root, config, submit) {
  const input = root.querySelector('.sb-input');
  const list = root.querySelector('.sb-suggestions');
  let timer;
  let controller;
  let active = -1;
  let typed = '';

  let picks = [];

  // Logs which suggestion was picked for what the visitor had typed.
  const pick = (text) => {
    track(config, '/ui/v1/analytics/suggest', { query: typed.replace(/['"]+/g, ''), suggestion: text });
    input.value = text;
    close();
    submit(text);
  };
  // A SmartFAQ searches for its question and opens it above the results.
  const pickFaq = (faq) => {
    const question = stripTags(faq.question);
    input.value = question;
    close();
    submit(question, faq.uid);
  };

  const close = () => {
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  const setActive = (index) => {
    const items = [...list.querySelectorAll('[role="option"]')];
    if (!items.length) return;
    active = (index + items.length) % items.length;
    items.forEach((item, i) => item.setAttribute('aria-selected', i === active ? 'true' : 'false'));
    input.setAttribute('aria-activedescendant', items[active].id);
  };

  // Suggestions, then SmartFAQs, each under a heading when both are shown.
  const show = (items, faqs = []) => {
    if (!items.length && !faqs.length) {
      close();
      return;
    }
    picks = [];
    const option = (label, onPick) => {
      picks.push(onPick);
      return el('li', {
        id: `${list.id}-${picks.length - 1}`,
        role: 'option',
        'aria-selected': 'false',
        // mousedown fires before the input's blur, so the click isn't lost.
        onMousedown: (e) => {
          e.preventDefault();
          onPick();
        },
      }, label);
    };
    const heading = (name, label) => el('li', { role: 'presentation', className: 'sb-suggest-heading' }, icon(name, 16), label);
    list.replaceChildren(...[
      faqs.length && items.length ? heading('search', 'Suggestions') : null,
      ...items.map((text) => option(text, () => pick(text))),
      faqs.length ? heading('help', 'SmartFAQs') : null,
      ...faqs.map((faq) => option(stripTags(faq.question), () => pickFaq(faq))),
    ].filter(Boolean));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = -1;
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    controller?.abort();
    const query = input.value.trim();
    typed = query;
    if (query.length < 2) {
      close();
      return;
    }
    timer = setTimeout(() => {
      controller = new AbortController();
      // Either list failing just leaves it out.
      const orNone = (err) => {
        if (err.name === 'AbortError') throw err;
        return [];
      };
      Promise.all([
        suggest(config, query, controller.signal).catch(orNone),
        config.smartFaqs && query.length >= FAQ_SUGGEST_MIN
          ? smartFaqs(config, query, FAQ_SUGGEST, controller.signal).catch(orNone) : [],
      ])
        .then(([items, faqs]) => show(items.slice(0, config.suggestLimit), faqs))
        .catch(() => {});
    }, SUGGEST_DELAY);
  });

  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(active - 1);
    } else if (e.key === 'Escape') {
      // Native type="search" clears the field on Escape; only dismiss the list.
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      picks[active]();
    }
  });

  input.addEventListener('blur', close);
  return close;
}

// ------------------------------------------------------------------
// SearchAI Assist
// ------------------------------------------------------------------

const ASSIST_ICONS = {
  summarize: 'summarize', compare: 'bulb', analyze: 'bulb', explain: 'explain', highlights: 'sparkles',
};
const plural = (n) => `${n} ${n === 1 ? 'file/URL' : 'files/URLs'} selected`;

// Visible text of an answer for "Copy text"; tables become tab-separated rows.
function plainText(node) {
  const copy = node.cloneNode(true);
  copy.querySelectorAll('tr').forEach((tr) => tr.replaceWith(`${[...tr.children].map((c) => c.textContent.trim()).join('\t')}\n`));
  copy.querySelectorAll('p, li, h3, hr').forEach((n) => n.append('\n'));
  return copy.textContent.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * SearchAI Assist, as in the SearchBlox search plugin: results are picked with
 * the button on each card (up to 4) and gather in a tray at the bottom left;
 * Proceed opens a dialog offering the server's actions (summarize, compare,
 * explain, ...) or a prompt of the visitor's own, with follow-up prompts after.
 * `onChange` runs whenever the selection changes. Returns the picker that the
 * cards use: { has, full, toggle, clear }.
 */
function mountAssist(config, onChange) {
  instanceCount += 1;
  const id = `sb-${instanceCount}-assist`;
  let selected = [];
  let prompts;
  let operation = '';
  let controller;
  let waitTimer;

  const same = (a, b) => a.uid === b.uid && a.col === b.col;
  // The page's own title: generated titles of similar pages can be identical.
  const docTitle = (r) => stripTags(r.originalTitle || r.title);
  const docLink = (r, className) => {
    const href = safeUrl(r.url);
    const label = docTitle(r);
    return href ? el('a', {
      href, target: '_blank', rel: 'noopener', className, title: label,
    }, label) : el('span', { className, title: label }, label);
  };
  const removeButton = (r) => el('button', {
    type: 'button', className: 'sb-assist-remove', 'aria-label': `Remove ${docTitle(r)}`, title: 'Remove', onClick: () => toggle(r),
  }, icon('close', 16));

  // Tray
  const trayList = el('ul', { className: 'sb-assist-docs' });
  const trayCount = el('p', { className: 'sb-assist-count' });
  const tray = el('section', {
    className: 'sb-assist-tray', 'aria-labelledby': `${id}-tray`, hidden: true,
  },
  el('header', { className: 'sb-assist-header' },
    el('h2', { id: `${id}-tray` }, icon('ai'), 'SearchAI Assist'),
    el('button', {
      type: 'button', className: 'sb-assist-icon', 'aria-label': 'Clear selection', title: 'Clear selection', onClick: () => clear(),
    }, icon('close'))),
  trayList,
  trayCount,
  el('div', { className: 'sb-assist-actions' },
    el('button', { type: 'button', className: 'sb-link-button', onClick: () => clear() }, 'Cancel'),
    el('button', { type: 'button', className: 'sb-settings-apply', onClick: () => open() }, 'Proceed')));

  // Dialog
  const log = el('div', { className: 'sb-assist-log', role: 'log', 'aria-live': 'polite' });
  const input = el('textarea', {
    className: 'sb-assist-input', rows: 2, placeholder: 'Enter your prompt here...', 'aria-label': 'Your prompt',
  });
  const send = el('button', {
    type: 'submit', className: 'sb-submit', 'aria-label': 'Send', title: 'Send',
  }, icon('send', 20));
  const compose = el('div', { className: 'sb-assist-compose', hidden: true }, input, send);
  const docs = el('ul', { className: 'sb-assist-docs sb-assist-chosen' });
  const count = el('span', { className: 'sb-assist-selected' });
  const dialog = el('dialog', { className: 'sb-assist', 'aria-labelledby': `${id}-title` },
    el('header', { className: 'sb-assist-header' },
      el('h2', { id: `${id}-title` }, icon('ai'), 'SearchAI Assist', count),
      el('button', {
        type: 'button', className: 'sb-assist-icon', 'aria-label': 'Start over', title: 'Start over', onClick: () => start(),
      }, icon('reload')),
      el('button', {
        type: 'button', className: 'sb-assist-icon', 'aria-label': 'Close SearchAI Assist', title: 'Close', onClick: () => dialog.close(),
      }, icon('close'))),
    log,
    el('form', {
      className: 'sb-assist-form',
      onSubmit: (e) => {
        e.preventDefault();
        const prompt = input.value.trim();
        if (prompt && !send.disabled) ask(operation === 'custom' ? 'summarize' : operation, prompt);
      },
    }, compose, docs));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      dialog.querySelector('.sb-assist-form').requestSubmit();
    }
  });

  const host = el('div', { className: 'searchblox-search sb-assist-host' }, tray, dialog);
  document.body.append(host);
  applyTheme(host, config);

  // Answers scroll to their start, so a long one reads from the top.
  const add = (node, block = 'nearest') => {
    log.append(node);
    node.scrollIntoView?.({ block });
    return node;
  };
  const setBusy = (busy) => {
    send.disabled = busy;
    log.querySelectorAll('.sb-assist-prompt').forEach((b) => { b.disabled = busy; });
  };

  // The action buttons that fit the selection: compare needs two or more
  // results; analyze and the server's own extra actions take a single one.
  const promptButtons = () => {
    const usable = prompts.filter((name) => (selected.length > 1
      ? ASSIST_PROMPTS.includes(name) && name !== 'analyze'
      : name !== 'compare'));
    return el('div', { className: 'sb-assist-prompts' },
      usable.map((name) => el('button', {
        type: 'button', className: 'sb-assist-prompt', onClick: () => ask(name),
      }, icon(ASSIST_ICONS[name] || 'quote', 16), name.replace(/-/g, ' '))),
      el('button', {
        type: 'button',
        className: 'sb-assist-prompt sb-assist-own',
        onClick: () => {
          operation = 'custom';
          compose.hidden = false;
          input.focus();
        },
      }, icon('edit', 16), 'Enter your own prompt'));
  };

  const start = () => {
    controller?.abort();
    clearTimeout(waitTimer);
    operation = '';
    input.value = '';
    compose.hidden = true;
    setBusy(false);
    log.replaceChildren(el('p', { className: 'sb-assist-intro' }, 'Please choose an action from the options below or write your own prompt.'));
    if (prompts) {
      add(promptButtons());
      return;
    }
    const loading = add(el('p', { className: 'sb-assist-wait' }, 'Loading actions…'));
    assistPrompts(config)
      .catch(() => ASSIST_PROMPTS)
      .then((names) => {
        prompts = names;
        if (loading.isConnected) loading.replaceWith(promptButtons());
      });
  };

  // One answer: a single text, or a section per result headed with its link.
  const answer = (parts) => {
    const body = el('div', { className: 'sb-chat-text' });
    const markdownParts = [];
    parts.forEach(({ doc, text: part }, i) => {
      if (i) body.append(el('hr'));
      if (doc && parts.length > 1) {
        body.append(el('h3', { className: 'sb-assist-doc-title' }, `URL ${i + 1}: `, docLink(doc)));
        markdownParts.push(`**URL ${i + 1}: [${docTitle(doc)}](${doc.url})**\n\n${part}`);
      } else {
        markdownParts.push(part);
      }
      body.append(...markdown(part));
    });
    const copyButton = (iconName, label, value) => {
      const button = el('button', {
        type: 'button', className: 'sb-assist-icon', 'aria-label': label, title: label,
      }, icon(iconName, 16));
      button.addEventListener('click', () => {
        navigator.clipboard?.writeText(value()).then(() => {
          button.replaceChildren(icon('check', 16));
          setTimeout(() => button.replaceChildren(icon(iconName, 16)), 2000);
        }).catch(() => {});
      });
      return button;
    };
    return el('div', { className: 'sb-chat-msg is-bot' },
      el('div', { className: 'sb-chat-bubble' }, body),
      el('div', { className: 'sb-assist-copy' },
        copyButton('copy', 'Copy text', () => plainText(body)),
        copyButton('markdown', 'Copy markdown', () => markdownParts.join('\n\n---\n\n'))));
  };

  const ask = (name, prompt = '') => {
    if (!selected.length) return;
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    operation = name;
    add(el('div', { className: 'sb-chat-msg is-user' },
      el('div', { className: 'sb-chat-bubble' }, prompt || name.replace(/-/g, ' '))));
    const wait = add(el('p', { className: 'sb-assist-wait' }, 'Processing content…'));
    clearTimeout(waitTimer);
    waitTimer = setTimeout(() => { wait.textContent = 'Generating response…'; }, 4000);
    setBusy(true);
    input.value = '';
    assist(config, { operation: name, docs: selected, prompt }, signal)
      .then((parts) => add(parts.length ? answer(parts) : el('p', { className: 'sb-assist-wait' }, 'No answer was found in these results.'), 'start'))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        add(el('p', { className: 'sb-error' }, 'SearchAI Assist is unavailable right now. Please try again later.'));
        // eslint-disable-next-line no-console
        console.error('[searchblox-search] SearchAI Assist', err);
      })
      .finally(() => {
        if (signal.aborted) return;
        clearTimeout(waitTimer);
        wait.remove();
        setBusy(false);
        compose.hidden = false;
        input.focus({ preventScroll: true });
      });
  };

  const update = () => {
    const open = dialog.open;
    tray.hidden = !selected.length || open;
    trayList.replaceChildren(...selected.map((r) => el('li', {}, docLink(r, 'sb-assist-doc'), removeButton(r))));
    trayCount.textContent = plural(selected.length);
    count.textContent = `(${plural(selected.length)})`;
    docs.replaceChildren(...selected.map((r) => el('li', {}, docLink(r, 'sb-assist-doc'), removeButton(r))));
    onChange();
  };

  const open = () => {
    if (!selected.length) return;
    tray.hidden = true;
    document.documentElement.classList.add('sb-assist-open');
    dialog.showModal();
    start();
    update();
  };

  // Closing (button or Escape) ends the conversation and clears the selection.
  dialog.addEventListener('close', () => {
    controller?.abort();
    clearTimeout(waitTimer);
    document.documentElement.classList.remove('sb-assist-open');
    selected = [];
    update();
  });

  function toggle(r) {
    if (selected.some((s) => same(s, r))) selected = selected.filter((s) => !same(s, r));
    else if (selected.length < ASSIST_LIMIT) selected = [...selected, r];
    if (dialog.open && !selected.length) {
      dialog.close();
      return;
    }
    update();
  }

  function clear() {
    if (dialog.open) dialog.close();
    selected = [];
    update();
  }

  return {
    has: (r) => selected.some((s) => same(s, r)),
    full: () => selected.length >= ASSIST_LIMIT,
    toggle,
    clear,
  };
}

// ------------------------------------------------------------------
// Settings menus
// ------------------------------------------------------------------

// Search Settings and Plugin Settings from the SearchBlox search plugin, as two
// buttons beside the search button when `settings` is on. Changes last until the
// page reloads; nothing is saved. `search(weight, threshold)` applies the search
// settings (omitted on a box-only instance); `toggles()` lists the plugin
// settings as { label, on, set, note, modes, mode, setMode }, read each time the
// menu opens. One without `set` is shown switched off and greyed out, with
// `note` saying why. `modes` ([[value, label]]) adds radio buttons, shown while on.
const percent = (n) => `${Math.round(n * 100)}%`;

function mountSettings(root, config, { search, toggles }) {
  const base = root.querySelector('.sb-input').id;
  const menus = [];

  const menu = (name, label, iconName, fill) => {
    const id = `${base}-${name}`;
    const toggle = el('button', {
      type: 'button', className: 'sb-settings-toggle', 'aria-expanded': 'false', 'aria-controls': id, 'aria-label': label, title: label,
    }, icon(iconName, 22));
    const panel = el('div', {
      id, className: 'sb-settings-panel', role: 'dialog', 'aria-labelledby': `${id}-title`, hidden: true,
    });
    const wrap = el('div', { className: 'sb-settings' }, toggle, panel);
    const close = (refocus) => {
      if (panel.hidden) return;
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      if (refocus) toggle.focus();
    };
    const open = () => {
      menus.forEach((m) => m.close());
      panel.replaceChildren(el('h2', { className: 'sb-settings-title', id: `${id}-title` }, label), ...fill(close));
      panel.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      panel.querySelector('input:not(:disabled), button')?.focus();
    };
    toggle.addEventListener('click', () => (panel.hidden ? open() : close()));
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(true);
    });
    document.addEventListener('pointerdown', (e) => {
      if (!wrap.contains(e.target)) close();
    });
    menus.push({ close });
    return wrap;
  };

  const slider = (id, label, value) => el('input', {
    id, type: 'range', className: 'sb-range', min: 0, max: 1, step: 0.1, value, 'aria-label': label,
  });

  const searchMenu = search && menu('search-settings', 'Search Settings', 'adjustments', (close) => {
    const ratio = slider(`${base}-ratio`, 'Search ratio (vector share)', config.vectorWeight);
    const threshold = slider(`${base}-threshold`, 'Vector threshold', config.vectorThreshold);
    const keywordShare = el('strong');
    const vectorShare = el('strong');
    const thresholdValue = el('strong');
    const thresholdRow = el('div', { className: 'sb-setting' },
      el('label', { className: 'sb-setting-label', for: threshold.id }, 'Vector Threshold'),
      threshold,
      el('div', { className: 'sb-setting-values' }, el('span', {}, 'Minimum similarity', thresholdValue)));
    const update = () => {
      const weight = Number(ratio.value);
      keywordShare.textContent = percent(1 - weight);
      vectorShare.textContent = percent(weight);
      thresholdValue.textContent = Number(threshold.value).toFixed(1);
      threshold.disabled = weight === 0;
      thresholdRow.classList.toggle('sb-disabled', weight === 0);
    };
    ratio.addEventListener('input', update);
    threshold.addEventListener('input', update);
    update();
    return [
      el('div', { className: 'sb-setting' },
        el('label', { className: 'sb-setting-label', for: ratio.id }, 'Search Ratio'),
        ratio,
        el('div', { className: 'sb-setting-values' },
          el('span', {}, 'Keyword', keywordShare),
          el('span', {}, 'Vector', vectorShare))),
      thresholdRow,
      el('div', { className: 'sb-settings-actions' },
        el('button', { type: 'button', className: 'sb-link-button', onClick: () => close(true) }, 'Cancel'),
        el('button', {
          type: 'button',
          className: 'sb-settings-apply',
          onClick: () => {
            close(true);
            search(Number(ratio.value), Number(threshold.value));
          },
        }, 'Apply')),
    ];
  });

  const pluginMenu = menu('plugin-settings', 'Plugin Settings', 'settings', () => {
    const items = toggles();
    return [el('ul', { className: 'sb-settings-list' }, items.map(({
      label, on, set, note, modes, mode, setMode,
    }, i) => {
      const noteId = note && `${base}-plugin-note-${i}`;
      const choices = modes && el('div', {
        className: 'sb-setting-modes', role: 'radiogroup', 'aria-label': `${label} display`, hidden: !on,
      }, modes.map(([value, text]) => el('label', {},
        el('input', {
          type: 'radio', name: `${base}-plugin-mode-${i}`, value, checked: value === mode, onChange: () => setMode(value),
        }),
        text)));
      return el('li', { className: set ? '' : 'sb-disabled' },
        el('label', { className: 'sb-setting-switch' },
          el('span', {}, label, note ? el('small', { id: noteId, className: 'sb-setting-note' }, note) : null),
          el('input', {
            type: 'checkbox',
            role: 'switch',
            className: 'sb-switch',
            checked: Boolean(set && on),
            disabled: !set,
            'aria-describedby': noteId,
            onChange: (e) => {
              set(e.target.checked);
              if (choices) choices.hidden = !e.target.checked;
            },
          })),
        choices);
    }))];
  });

  root.querySelector('.sb-form').append(...[searchMenu, pluginMenu].filter(Boolean));
}

// ------------------------------------------------------------------
// Chat
// ------------------------------------------------------------------

let chatHost;

// Message times, as in the SearchBlox plugin's chat: the first message shows the
// date and time, later ones "just now" for 20 seconds, then "2 minutes ago".
const SHORT_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' });
const RELATIVE_TIME = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const JUST_NOW = 20; // seconds; also how often relative times refresh

function relativeTime(ms) {
  const seconds = Math.round((ms - Date.now()) / 1000);
  if (seconds > -JUST_NOW) return 'just now';
  const [unit, size] = [['day', 86400], ['hour', 3600], ['minute', 60]].find(([, s]) => -seconds >= s) || ['second', 1];
  return RELATIVE_TIME.format(Math.round(seconds / size), unit);
}

// "3 secs", "1 min, 5 secs"; nothing under a second.
function formatDuration(ms) {
  const total = Math.floor(ms / 1000);
  const plural = (n, unit) => `${n} ${unit}${n > 1 ? 's' : ''}`;
  return [
    total >= 60 ? plural(Math.floor(total / 60), 'min') : '',
    total % 60 ? plural(total % 60, 'sec') : '',
  ].filter(Boolean).join(', ');
}

function chatActionLink(config, action) {
  const resource = `${action.actionResource || ''}`.trim();
  let href = safeUrl(resource);
  if (action.actionType === 'phone') href = `tel:${resource.replace(/[^\d+]/g, '')}`;
  if (action.actionType === 'email') href = `mailto:${resource}`;
  if (!href || !resource) return null;
  return el('div', { className: 'sb-chat-action' },
    action.description ? el('p', {}, action.description) : null,
    el('a', {
      href,
      download: action.actionType === 'download' ? '' : undefined,
      target: href.startsWith('http') ? '_blank' : undefined,
      rel: 'noopener',
      onClick: () => track(config, '/ui/v1/analytics/ca', { uid: action.uid }),
    }, action.buttonDisplay || resource));
}

// Thumbs up/down; `vote(action)` sends 'upvote' or 'downvote' and returns a promise.
function votes(vote) {
  const buttons = [['upvote', 'up', 'Helpful'], ['downvote', 'down', 'Not helpful']].map(([action, name, label]) => el('button', {
    type: 'button',
    'aria-label': label,
    title: label,
    'aria-pressed': 'false',
    // aria-disabled, not disabled: a disabled button drops focus out of the panel.
    onClick: (e) => {
      const button = e.currentTarget;
      if (button.getAttribute('aria-disabled')) return;
      buttons.forEach((b) => b.setAttribute('aria-disabled', 'true'));
      vote(action)
        .then(() => button.setAttribute('aria-pressed', 'true'))
        .catch(() => buttons.forEach((b) => b.removeAttribute('aria-disabled')));
    },
  }, icon(name)));
  return el('div', { className: 'sb-votes' }, buttons);
}

/**
 * Floating chat button and chat panel, one per page. It lives in its own
 * .searchblox-search host on <body>: the widget root's container-type would make
 * it the containing block for position: fixed.
 */
function mountChat(config) {
  if (chatHost?.isConnected) return;
  instanceCount += 1;
  const id = `sb-${instanceCount}-chat`;
  const log = el('div', { className: 'sb-chat-log', role: 'log', 'aria-live': 'polite' });
  const input = el('input', {
    className: 'sb-input', type: 'text', autocomplete: 'off', placeholder: 'Ask a question ...', 'aria-label': 'Ask a question',
  });
  const send = el('button', {
    className: 'sb-submit', type: 'submit', 'aria-label': 'Send', title: 'Send',
  }, icon('send', 20));
  const launcher = el('button', {
    type: 'button', className: 'sb-chat-launcher', 'aria-expanded': 'false', 'aria-controls': id,
  });
  // Like the SearchBlox plugin: a chat bubble that turns into a close button.
  const setLauncher = (isOpen) => {
    const label = isOpen ? 'Close' : 'SearchAI ChatBot';
    launcher.replaceChildren(icon(isOpen ? 'close' : 'chat', 24));
    launcher.setAttribute('aria-label', label);
    launcher.title = label;
    launcher.setAttribute('aria-expanded', `${isOpen}`);
  };
  setLauncher(false);
  const panel = el('section', {
    id, className: 'sb-chat', role: 'dialog', 'aria-labelledby': `${id}-title`, hidden: true,
  },
  el('header', { className: 'sb-chat-header' },
    el('h2', { id: `${id}-title` }, icon('ai'), 'ChatBot ', el('em', { className: 'sb-chat-name' }, config.chatbot)),
    el('button', {
      type: 'button', className: 'sb-chat-reset', 'aria-label': 'New chat', title: 'New chat', onClick: () => start(),
    }, icon('reload')),
    el('button', {
      type: 'button', className: 'sb-chat-close', 'aria-label': 'Close chat', title: 'Close chat', onClick: () => close(),
    }, icon('close'))),
  log,
  el('form', {
    className: 'sb-chat-form',
    onSubmit: (e) => {
      e.preventDefault();
      ask(input.value);
    },
  }, input, send));

  let settings;
  let conversationId = '';
  let controller;

  const add = (node) => {
    log.append(node);
    log.scrollTop = log.scrollHeight;
    return node;
  };
  // One chat line: speaker, message, then its time, response time and (for
  // answers) feedback buttons. Any action button sits below the bubble.
  const message = (who, {
    label, body, created = Date.now(), first, duration, id, action,
  }) => {
    const time = el('time', {
      className: 'sb-chat-time',
      datetime: new Date(created).toISOString(),
      title: first ? undefined : `${who === 'user' ? 'Sent' : 'Received'} at ${SHORT_TIME.format(created)}`,
      'data-created': first ? undefined : `${created}`,
    }, first ? SHORT_TIME.format(created) : relativeTime(created));
    return add(el('div', { className: `sb-chat-msg is-${who}` },
      el('div', { className: 'sb-chat-bubble' },
        el('p', { className: 'sb-chat-speaker' }, label),
        body,
        el('div', { className: 'sb-chat-details' },
          el('span', {}, time, duration ? el('span', { className: 'sb-chat-duration', title: 'Response time' }, icon('stopwatch', 12), duration) : null),
          id ? votes((action) => chatVote(config, id, action)) : null)),
      action ? chatActionLink(config, action) : null));
  };
  const pending = () => add(el('div', { className: 'sb-chat-msg is-bot sb-chat-pending' },
    el('div', { className: 'sb-chat-bubble' }, 'Thinking…')));
  let ticker;

  const start = async () => {
    controller?.abort();
    controller = new AbortController();
    conversationId = '';
    log.replaceChildren();
    send.disabled = true;
    const wait = pending();
    try {
      settings = await chatSettings(config, controller.signal);
      wait.remove();
      message('bot', {
        label: settings.botLabel, body: el('div', { className: 'sb-chat-text' }, markdown(settings.initialMessage)), first: true,
      });
      send.disabled = false;
    } catch (err) {
      if (err.name === 'AbortError') return;
      wait.remove();
      message('bot', { label: 'AI', body: el('p', { className: 'sb-error' }, 'Chat is unavailable right now.'), first: true });
      // eslint-disable-next-line no-console
      console.error('[searchblox-search] chat', err);
    }
  };

  const ask = async (raw) => {
    const question = maskSensitive(raw.trim(), settings?.sensitiveDataInformation);
    if (!question || !settings || send.disabled) return;
    input.value = '';
    message('user', { label: settings.userLabel, body: el('p', { className: 'sb-chat-text' }, question) });
    send.disabled = true;
    const wait = pending();
    const started = performance.now();
    try {
      const answer = await chat(config, { question, conversationId, useKg: settings.useKg ?? true }, controller.signal);
      conversationId = answer.conversationId || conversationId;
      wait.remove();
      message('bot', {
        label: settings.botLabel,
        body: [
          el('div', { className: 'sb-chat-text' }, markdown(answer.text)),
          answer.sources.length ? el('ol', { className: 'sb-chat-sources', 'aria-label': 'Sources' },
            answer.sources.map((url) => el('li', {}, el('a', { href: url, target: '_blank', rel: 'noopener' }, displayUrl(url))))) : null,
        ],
        created: answer.created,
        duration: formatDuration(performance.now() - started),
        id: answer.id,
        action: answer.action,
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      wait.remove();
      message('bot', { label: settings.botLabel, body: el('p', { className: 'sb-error' }, 'Sorry, that went wrong. Please try again.') });
      // eslint-disable-next-line no-console
      console.error('[searchblox-search] chat', err);
    } finally {
      if (!controller.signal.aborted) send.disabled = false;
    }
  };

  const refreshTimes = () => log.querySelectorAll('time[data-created]').forEach((t) => {
    t.textContent = relativeTime(Number(t.dataset.created));
  });
  const open = () => {
    panel.hidden = false;
    setLauncher(true);
    refreshTimes();
    ticker = setInterval(refreshTimes, JUST_NOW * 1000);
    if (!settings && !log.children.length) start();
    input.focus();
  };
  const close = () => {
    panel.hidden = true;
    clearInterval(ticker);
    setLauncher(false);
    launcher.focus();
  };
  launcher.addEventListener('click', () => (panel.hidden ? open() : close()));
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  chatHost = el('div', { className: 'searchblox-search sb-chat-host' }, panel, launcher);
  document.body.append(chatHost);
  applyTheme(chatHost, config);
}

// ------------------------------------------------------------------
// Theme
// ------------------------------------------------------------------

// Relative luminance of a computed "rgb(...)"/"rgba(...)" color, or null when the
// color is transparent or in another format.
const luminance = (color) => {
  const m = /^rgba?\(([\d.]+),? ([\d.]+),? ([\d.]+)(?:,? \/? ?([\d.]+))?\)$/.exec(color || '');
  if (!m || Number(m[4] ?? 1) < 0.5) return null;
  const [r, g, b] = m.slice(1, 4).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

// The page is dark if the first opaque background behind the widget is dark or,
// when none is found, if the inherited text color is light.
const detectScheme = (root) => {
  for (let node = root; node; node = node.parentElement) {
    const bg = luminance(getComputedStyle(node).backgroundColor);
    if (bg !== null) return bg < 0.18 ? 'dark' : 'light';
  }
  const text = luminance(getComputedStyle(root).color);
  return text !== null && text > 0.18 ? 'dark' : 'light';
};

const applyTheme = (root, config) => {
  if (config.accent && (!window.CSS?.supports || CSS.supports('color', config.accent))) {
    root.style.setProperty('--sb-accent', config.accent);
  }
  root.dataset.sbScheme = config.scheme === 'auto' ? detectScheme(root) : config.scheme;
};

/**
 * Mounts the search UI into `root`. Reuses existing .sb-* markup (EDS widget
 * HTML) or builds it. Returns { run } for programmatic queries.
 */
export function mount(root, rawConfig) {
  // A copy, since the settings menus change it.
  const config = rawConfig?.domain !== undefined && Array.isArray(rawConfig.facets)
    ? { ...rawConfig }
    : normaliseConfig(rawConfig);
  root.classList.add('searchblox-search');
  applyTheme(root, config);

  if (!config.domain) {
    root.replaceChildren(el('p', { className: 'sb-error' }, 'SearchBlox search: set the "domain" option to your SearchBlox domain.'));
    return { run: () => {} };
  }

  if (config.chatbot) mountChat(config);
  ensureSkeleton(root, config);
  const form = root.querySelector('.sb-form');
  const input = root.querySelector('.sb-input');
  const aiEnabled = config.aiOverview.length > 0 && !config.resultsPage;
  const faqsEnabled = config.smartFaqs;
  let aiOn = aiEnabled;
  let current;
  let lastResults;
  let llmMode = config.llmFields === 'off' ? 'both' : config.llmFields;
  let picker;
  let recController;
  let recs = readSession(RECOMMENDATIONS_KEY, null);
  let faqController;
  let faqKey = '';
  let controller;
  let aiController;
  let aiQuery = '';
  let aiResult;

  // One overview per query: paging and filtering keep it, page 2+ hides it.
  // `force` regenerates the answer for the same query.
  const runOverview = (state, force = false) => {
    const panel = root.querySelector('.sb-ai');
    if (state.query === aiQuery && !force) {
      if (panel) panel.hidden = state.page > 1 || !aiResult?.overview;
      return;
    }
    aiController?.abort();
    aiQuery = state.query;
    aiResult = undefined;
    if (state.page > 1) {
      if (panel) panel.hidden = true;
      aiQuery = '';
      return;
    }
    aiController = new AbortController();
    const started = performance.now();
    const regenerate = () => runOverview({ ...state, page: 1 }, true);
    renderOverview(root, config, null);
    overview(config, state.query, aiController.signal)
      .then((ai) => {
        aiResult = { ...ai, duration: formatDuration(performance.now() - started) };
        renderOverview(root, config, aiResult, regenerate);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        aiResult = { overview: '' };
        renderOverview(root, config, aiResult);
        // eslint-disable-next-line no-console
        console.error('[searchblox-search] AI overview', err);
      });
  };

  // SmartFAQs per query (and picked FAQ), shown on page 1 only.
  const runFaqs = (state) => {
    const section = root.querySelector('.sb-faqs');
    const key = `${state.query}\n${state.faq || ''}`;
    if (state.page > 1 || key === faqKey) {
      if (section) section.hidden = state.page > 1 || !section.childElementCount;
      if (state.page > 1 && key !== faqKey) faqKey = '';
      return;
    }
    faqController?.abort();
    faqController = new AbortController();
    faqKey = key;
    const { signal } = faqController;
    const none = (err) => {
      if (err.name === 'AbortError') throw err;
      // eslint-disable-next-line no-console
      console.error('[searchblox-search] SmartFAQs', err);
      return null;
    };
    Promise.all([
      smartFaqs(config, state.query, FAQ_LIMIT, signal).catch(none),
      state.faq ? smartFaq(config, state.faq, signal).catch(none) : null,
    ])
      .then(([faqs, selected]) => renderFaqs(root, config, state.query, { faqs: faqs || [], selected }))
      .catch(() => {});
  };

  const hide = (selector) => {
    const node = root.querySelector(selector);
    if (node) node.hidden = true;
  };

  // AI recommendations once enough results have been opened. They're kept for
  // the tab and only fetched again when the opened titles change.
  const runRecommendations = (state) => {
    const titles = readSession(VIEWED_KEY, []);
    if (titles.length < VIEWED_TITLES) {
      hide('.sb-recs');
      return;
    }
    const key = JSON.stringify([titles, config.collections]);
    const show = (loading) => renderRecommendations(root, config, recs, { loading, query: state.query });
    if (recs?.key === key) {
      show(false);
      return;
    }
    recController?.abort();
    recController = new AbortController();
    show(true);
    recommendations(config, { titles, query: state.query }, recController.signal)
      .then(({ sessionId, items }) => {
        // As in the plugin, an empty answer keeps the previous recommendations.
        recs = items.length
          ? { key, sessionId, items, previous: (recs?.items || []).map((r) => r.uid) }
          : { ...(recs || { items: [] }), key };
        writeSession(RECOMMENDATIONS_KEY, recs);
        show(false);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        show(false);
        // eslint-disable-next-line no-console
        console.error('[searchblox-search] AI recommendations', err);
      });
  };

  const ui = {
    onOpen: (r) => {
      if (!config.recommendations) return;
      const title = stripTags(r.title);
      const titles = readSession(VIEWED_KEY, []).filter((t) => t !== title);
      writeSession(VIEWED_KEY, [...titles, title].slice(-VIEWED_TITLES));
      // Only finishes if the page stays (new tab); otherwise the next search does it.
      if (current) runRecommendations(current);
    },
    filter: (field, value) => {
      if (!current) return;
      const selected = config.checkboxFacets.includes(field)
        ? [...new Set([...values(current.filters[field]), value])]
        : value;
      run({
        ...current, page: 1, faq: '', filters: { ...current.filters, [field]: selected },
      });
    },
    get assist() {
      return config.assist ? picker : null;
    },
  };
  const rerender = () => lastResults && renderResultList(root, config, lastResults.data, lastResults.state, ui);
  const ensureAssist = () => {
    picker = picker || mountAssist(config, () => syncAssist(root, picker));
  };
  if (config.assist && !config.resultsPage) ensureAssist();

  const run = async (state) => {
    if (!state.query) return;
    current = state;
    controller?.abort();
    controller = new AbortController();
    input.value = state.query;
    writeUrlState(config, state);
    if (aiOn) runOverview(state);
    if (config.smartFaqs && !config.resultsPage) runFaqs(state);
    if (config.recommendations) runRecommendations(state);
    root.setAttribute('aria-busy', 'true');
    try {
      const data = await search(config, state, controller.signal);
      lastResults = { data, state };
      renderResults(root, config, data, state, ui);
    } catch (err) {
      if (err.name === 'AbortError') return;
      root.querySelector('.sb-status').replaceChildren(el('span', { className: 'sb-error' }, 'Search is unavailable right now. Please try again.'));
      root.querySelector('.sb-results').replaceChildren();
      root.querySelector('.sb-pagination').replaceChildren();
      // eslint-disable-next-line no-console
      console.error('[searchblox-search]', err);
    } finally {
      root.removeAttribute('aria-busy');
    }
  };
  root.sbRun = run;

  // `faq` is the uid of a SmartFAQ picked from the suggestions.
  const submit = (query, faq) => {
    const q = query.trim();
    if (!q) return;
    if (config.resultsPage) {
      const url = new URL(config.resultsPage, window.location.href);
      url.searchParams.set(config.queryParam, q);
      if (faq) url.searchParams.set('faq', faq);
      window.location.assign(url);
      return;
    }
    run({
      query: q, page: 1, filters: {}, faq,
    });
  };

  if (config.settings) {
    mountSettings(root, config, {
      search: !config.resultsPage && ((weight, threshold) => {
        config.vectorWeight = weight;
        config.vectorThreshold = threshold;
        if (weight > 0) config.pageSize = Math.min(config.pageSize, HYBRID_MAX_PAGE_SIZE);
        if (current) run({ ...current, page: 1 });
      }),
      // The plugin's list, in its order, plus SmartFAQs. Results-page features
      // are left out of a box-only instance.
      toggles: () => [
        !config.resultsPage && (aiEnabled ? {
          label: 'AI Overview',
          on: aiOn,
          set: (on) => {
            aiOn = on;
            if (on) {
              if (current) runOverview(current);
              return;
            }
            // Keep a finished answer for when it's switched back on; drop one in progress.
            if (!aiResult) {
              aiController?.abort();
              aiQuery = '';
            }
            hide('.sb-ai');
          },
        } : { label: 'AI Overview', note: 'Set the aiOverview option' }),
        faqsEnabled ? {
          label: 'SmartFAQs',
          on: config.smartFaqs,
          set: (on) => {
            config.smartFaqs = on;
            if (on) {
              if (current && !config.resultsPage) runFaqs(current);
              return;
            }
            faqController?.abort();
            faqKey = '';
            hide('.sb-faqs');
          },
        } : { label: 'SmartFAQs', note: 'Turned off by the smartFaqs option' },
        !config.resultsPage && {
          label: 'AI Recommendations',
          note: `After ${VIEWED_TITLES} results are opened`,
          on: config.recommendations,
          set: (on) => {
            config.recommendations = on;
            if (on) {
              if (current) runRecommendations(current);
              return;
            }
            // As in the plugin, switching off forgets what was opened.
            recController?.abort();
            recs = null;
            writeSession(VIEWED_KEY, undefined);
            writeSession(RECOMMENDATIONS_KEY, undefined);
            hide('.sb-recs');
          },
        },
        !config.resultsPage && {
          label: 'LLM-generated Fields',
          on: config.llmFields !== 'off',
          set: (on) => {
            config.llmFields = on ? llmMode : 'off';
            rerender();
          },
          modes: [['replace', 'Replace'], ['both', 'Show Both']],
          mode: llmMode,
          setMode: (mode) => {
            llmMode = mode;
            config.llmFields = mode;
            rerender();
          },
        },
        !config.resultsPage && {
          label: 'AI Assist',
          note: `Pick up to ${ASSIST_LIMIT} results`,
          on: config.assist,
          set: (on) => {
            config.assist = on;
            if (on) ensureAssist();
            else picker?.clear();
            rerender();
          },
        },
        chatHost?.isConnected ? {
          label: 'ChatBot',
          on: !chatHost.hidden,
          set: (on) => {
            chatHost.hidden = !on;
          },
        } : { label: 'ChatBot', note: 'Set the chatbot option' },
      ].filter(Boolean),
    });
  }

  const closeSuggestions = config.autosuggest ? wireSuggestions(root, config, submit) : () => {};

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    closeSuggestions();
    submit(input.value);
  });

  if (!config.resultsPage) {
    const initial = readUrlState(config);
    if (initial.query) run(initial);
  }

  return { run: (query) => submit(query) };
}
