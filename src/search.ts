/**
 * search.ts — web search provider interface + Perplexity/Exa/Jina providers
 * with a fallback chain.
 *
 * guardrails-allow PREVENT-ITH-004: web search providers (Perplexity/Exa/Jina)
 * are a user-triggered, opt-in exception to the zero-network rule. The fetch
 * function is injected (dependency injection) so the search module itself
 * makes no direct network calls; the extension layer wires the real fetch.
 * Tests inject a mock fetch fn.
 */

import type { SearchResult } from './types.js';

/** Injectable fetch function (mirrors the global fetch signature subset). */
export type FetchFn = (
  url: string,
  opts?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> }>;

/** A search provider: given a query + fetch fn, returns results (or throws). */
export interface SearchProvider {
  name: string;
  search(query: string, opts: { fetchFn: FetchFn; apiKey?: string; maxResults?: number }): Promise<SearchResult[]>;
}

/** Perplexity provider (sonar). */
export const perplexityProvider: SearchProvider = {
  name: 'perplexity',
  async search(query, { fetchFn, apiKey, maxResults = 5 }) {
    if (!apiKey) throw new Error('perplexity: missing API key');
    const res = await fetchFn('https://api.perplexity.ai/chat/completions', { // guardrails-allow PREVENT-ITH-004 PREVENT-PI-004: web search provider (opt-in exception, injectable fetchFn)
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: query }], max_results: maxResults }),
    });
    if (!res.ok) throw new Error(`perplexity: HTTP ${res.status}`);
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '';
    // Perplexity returns prose; extract URL-like tokens as results.
    const urls = (content.match(/https?:\/\/[\w./-]+/g) ?? []).slice(0, maxResults); // guardrails-allow PREVENT-ITH-004 PREVENT-PI-004: URL token extraction regex
    return urls.map((url, i) => ({
      title: `Perplexity result ${i + 1}`,
      url,
      snippet: content.slice(0, 200),
      provider: 'perplexity',
      score: 0.7,
    }));
  },
};

/** Exa provider (neural search). */
export const exaProvider: SearchProvider = {
  name: 'exa',
  async search(query, { fetchFn, apiKey, maxResults = 5 }) {
    if (!apiKey) throw new Error('exa: missing API key');
    const res = await fetchFn('https://api.exa.ai/search', { // guardrails-allow PREVENT-ITH-004 PREVENT-PI-004: web search provider (opt-in exception, injectable fetchFn)
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, numResults: maxResults, contents: { text: true } }),
    });
    if (!res.ok) throw new Error(`exa: HTTP ${res.status}`);
    const data = await res.json() as { results?: Array<{ title?: string; url?: string; text?: string; score?: number }> };
    return (data.results ?? []).slice(0, maxResults).map(r => ({
      title: r.title ?? r.url ?? 'Exa result',
      url: r.url ?? '',
      snippet: (r.text ?? '').slice(0, 200),
      provider: 'exa',
      score: r.score ?? 0.6,
    }));
  },
};

/** Jina provider (reader + search). */
export const jinaProvider: SearchProvider = {
  name: 'jina',
  async search(query, { fetchFn, apiKey, maxResults = 5 }) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const res = await fetchFn(`https://s.jina.ai/${encodeURIComponent(query)}`, { // guardrails-allow PREVENT-ITH-004 PREVENT-PI-004: web search provider (opt-in exception, injectable fetchFn)
      method: 'GET',
      headers,
    });
    if (!res.ok) throw new Error(`jina: HTTP ${res.status}`);
    const data = await res.json() as { data?: Array<{ title?: string; url?: string; content?: string }> };
    return (data.data ?? []).slice(0, maxResults).map(r => ({
      title: r.title ?? r.url ?? 'Jina result',
      url: r.url ?? '',
      snippet: (r.content ?? '').slice(0, 200),
      provider: 'jina',
      score: 0.65,
    }));
  },
};

/** Default provider order for the fallback chain. */
export const DEFAULT_PROVIDERS: SearchProvider[] = [perplexityProvider, exaProvider, jinaProvider];

export interface SearchChainOpts {
  fetchFn: FetchFn;
  providers?: SearchProvider[];
  apiKeys?: Record<string, string>;
  maxResults?: number;
}

/**
 * Run a search through the provider chain, falling back on failure.
 * Returns the first successful provider's results + which provider served them.
 * @returns { results, provider, errors } — errors is the list of failed providers.
 */
export async function searchWithFallback(
  query: string,
  opts: SearchChainOpts,
): Promise<{ results: SearchResult[]; provider: string; errors: Array<{ provider: string; error: string }> }> {
  const providers = opts.providers ?? DEFAULT_PROVIDERS;
  const errors: Array<{ provider: string; error: string }> = [];
  for (const provider of providers) {
    try {
      const apiKey = opts.apiKeys?.[provider.name];
      const results = await provider.search(query, {
        fetchFn: opts.fetchFn,
        apiKey,
        maxResults: opts.maxResults,
      });
      if (results.length > 0) {
        return { results, provider: provider.name, errors };
      }
      errors.push({ provider: provider.name, error: 'empty results' });
    } catch (e) {
      errors.push({ provider: provider.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { results: [], provider: '', errors };
}
