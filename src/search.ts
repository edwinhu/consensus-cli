/**
 * Consensus search module
 * Builds API request bodies and maps API responses for the Consensus search API.
 */

import type { CDPSession } from "./cdp.ts";
import { evaluateScript } from "./cdp.ts";

export interface SearchOptions {
  n?: number;
  type?: string;
  years?: string;
  minCitations?: number;
  rank?: string;
  human?: boolean;
  rct?: boolean;
  openAccess?: boolean;
  excludePreprints?: boolean;
  sampleSize?: number;
  duration?: string;
  domain?: string;
  country?: string;
  controlled?: boolean;
  page?: number;
  sort?: string;
  stream?: boolean;
}

export interface Filters {
  study_types?: string;
  year_min?: number;
  year_max?: number;
  cite_min?: number;
  sjr_max?: number;
  human?: string;
  controlled?: string;
  open_access?: boolean;
  exclude_preprints?: boolean;
  sample_size_min?: number;
  duration_min?: number;
  duration_unit?: string;
  domain?: string;
  country?: string;
}

export interface PostBody {
  user_message: string;
  is_incognito: boolean;
  size: number;
  filters: Filters;
  search_mode: string;
}

export interface Paper {
  title: string;
  authors: string[];
  year: number | null;
  journal: string | null;
  doi: string | null;
  citations: number;
  study_type: string | null;
  takeaway: string | null;
  open_access_pdf_url: string | null;
  url: string;
}

/**
 * Build the filters object from CLI options.
 * Note: --page and --n are NOT included in filters.
 */
export function buildFilters(opts: SearchOptions): Filters {
  const filters: Filters = {};

  // study_types: --type takes precedence; --rct is shorthand for study_types: "rct"
  if (opts.type !== undefined) {
    filters.study_types = opts.type;
  } else if (opts.rct === true) {
    filters.study_types = "rct";
  }

  // year range: "2018-2024" → {year_min, year_max}; "5" → {year_min: currentYear-5}
  if (opts.years !== undefined) {
    const rangeMatch = opts.years.match(/^(\d{4})-(\d{4})$/);
    if (rangeMatch) {
      filters.year_min = parseInt(rangeMatch[1], 10);
      filters.year_max = parseInt(rangeMatch[2], 10);
    } else {
      const n = parseInt(opts.years, 10);
      if (!isNaN(n)) {
        filters.year_min = new Date().getFullYear() - n;
      }
    }
  }

  if (opts.minCitations !== undefined) {
    filters.cite_min = opts.minCitations;
  }

  // --rank q1→1, q2→2, q3→3, q4→4
  if (opts.rank !== undefined) {
    const rankMap: Record<string, number> = { q1: 1, q2: 2, q3: 3, q4: 4 };
    const rankVal = rankMap[opts.rank.toLowerCase()];
    if (rankVal !== undefined) {
      filters.sjr_max = rankVal;
    }
  }

  // human and controlled are string "true", not boolean
  if (opts.human === true) {
    filters.human = "true";
  }

  if (opts.controlled === true) {
    filters.controlled = "true";
  }

  // open_access and exclude_preprints are boolean
  if (opts.openAccess === true) {
    filters.open_access = true;
  }

  if (opts.excludePreprints === true) {
    filters.exclude_preprints = true;
  }

  if (opts.sampleSize !== undefined) {
    filters.sample_size_min = opts.sampleSize;
  }

  // duration: "6mo", "1yr", "30d", "2wk"
  if (opts.duration !== undefined) {
    const durMatch = opts.duration.match(/^(\d+)(mo|yr|d|wk)$/);
    if (durMatch) {
      filters.duration_min = parseInt(durMatch[1], 10);
      const unitMap: Record<string, string> = {
        mo: "month",
        yr: "year",
        d: "day",
        wk: "week",
      };
      filters.duration_unit = unitMap[durMatch[2]];
    }
  }

  if (opts.domain !== undefined) {
    filters.domain = opts.domain;
  }

  if (opts.country !== undefined) {
    filters.country = opts.country;
  }

  // NOTE: opts.page is NOT included in filters (it's a GET query param)
  // NOTE: opts.n is NOT included in filters (it's a top-level POST body param)

  return filters;
}

/**
 * Build the full POST body for /api/threads/.
 */
export function buildPostBody(query: string, opts: SearchOptions): PostBody {
  return {
    user_message: query,
    is_incognito: false,
    size: opts.n ?? 20,
    filters: buildFilters(opts),
    search_mode: "PRO_ANALYSIS",
  };
}

/**
 * Map an API paper object to the CLI output format.
 * open_access_pdf_url must be explicitly null (not undefined) when absent.
 */
export function mapPaper(paper: Record<string, unknown>): Paper {
  const badges = (paper.badges ?? {}) as Record<string, unknown>;

  return {
    title: (paper.title as string) ?? "",
    authors: (paper.authors as string[]) ?? [],
    year: (paper.year as number | null) ?? null,
    journal: (paper.journal as string | null) ?? null,
    doi: (paper.doi as string | null) ?? null,
    citations: (paper.citation_count as number) ?? 0,
    study_type: (badges.study_type as string | null) ?? null,
    takeaway: (paper.display_text as string | null) ?? null,
    open_access_pdf_url:
      paper.open_access_pdf_url !== undefined &&
      paper.open_access_pdf_url !== null
        ? (paper.open_access_pdf_url as string)
        : null,
    url: `https://consensus.app/papers/${paper.url_slug as string}/${paper.paper_id as string}/`,
  };
}

export interface Interaction {
  threadId: string;
  interactionId: string;
}

/** Give up on a search that never reaches agent_complete. */
const SEARCH_TIMEOUT_MS = 300_000;

/**
 * Start a search and return the thread/interaction identifiers.
 * POST /api/threads/ responds 201 with {thread_id, interactions: [{id, ...}]}.
 */
async function startSearch(
  query: string,
  opts: SearchOptions,
  session: CDPSession
): Promise<Interaction> {
  const postBody = buildPostBody(query, opts);
  const script = `
(async function() {
  const r = await fetch('/api/threads/', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(${JSON.stringify(postBody)})
  });
  if (!r.ok) {
    throw new Error('POST /api/threads/ failed: HTTP ' + r.status);
  }
  const d = await r.json();
  const i = d.interactions && d.interactions[0];
  if (!d.thread_id || !i || !i.id) {
    throw new Error('Unexpected /api/threads/ response shape: ' + JSON.stringify(d).slice(0, 300));
  }
  return JSON.stringify({threadId: d.thread_id, interactionId: i.id});
})()
`;
  const result = (await evaluateScript(session, script)) as string;
  return JSON.parse(result) as Interaction;
}

/**
 * Start consuming the interaction's SSE agent stream inside the page, recording
 * completion on `window.__consensusCli`. The stream is the only authoritative
 * signal that the paper set is final: it ends with {"type":"agent_complete"}.
 *
 * This runs detached from the CDP call so subsequent polls can read the flag
 * cheaply; the page context outlives each Runtime.evaluate WebSocket.
 */
async function watchAgentStream(
  { threadId, interactionId }: Interaction,
  session: CDPSession
): Promise<void> {
  const script = `
(function() {
  const st = {interactionId: ${JSON.stringify(interactionId)}, done: false, error: null};
  window.__consensusCli = st;
  (async function() {
    try {
      const r = await fetch('/api/threads/${threadId}/interactions/${interactionId}/agent/stream/');
      if (!r.ok) { throw new Error('agent stream HTTP ' + r.status); }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buf += dec.decode(chunk.value, {stream: true}).replace(/\\r\\n/g, '\\n');
        let i;
        while ((i = buf.indexOf('\\n\\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const m = block.match(/^data: (.*)$/m);
          if (!m) continue;
          try {
            if (JSON.parse(m[1]).type === 'agent_complete') { st.done = true; }
          } catch (e) { /* non-JSON keepalive */ }
        }
      }
    } catch (e) {
      st.error = String(e);
    }
    // Stream close also means the agent stopped emitting.
    st.done = true;
  })();
  return 'started';
})()
`;
  await evaluateScript(session, script);
}

/**
 * Poll once for current search results.
 * GET .../papers/ responds {papers, total_count, is_end} and paginates by
 * limit/offset (the old page/size + is_complete endpoint no longer exists).
 */
async function pollSearch(
  { threadId, interactionId }: Interaction,
  offset: number,
  limit: number,
  session: CDPSession
): Promise<{
  papers: Record<string, unknown>[];
  totalCount: number;
  isEnd: boolean;
  isComplete: boolean;
  error: string | null;
}> {
  const script = `
(async function() {
  const r = await fetch('/api/threads/${threadId}/interactions/${interactionId}/papers/?limit=${limit}&offset=${offset}');
  if (!r.ok) {
    throw new Error('GET papers failed: HTTP ' + r.status);
  }
  const d = await r.json();
  const st = window.__consensusCli || {};
  return JSON.stringify({
    papers: d.papers || [],
    totalCount: d.total_count || 0,
    isEnd: !!d.is_end,
    isComplete: !!st.done,
    error: st.error || null
  });
})()
`;
  const result = (await evaluateScript(session, script)) as string;
  return JSON.parse(result) as {
    papers: Record<string, unknown>[];
    totalCount: number;
    isEnd: boolean;
    isComplete: boolean;
    error: string | null;
  };
}

/**
 * Execute a Consensus search by injecting JS into the browser via CDP.
 * Polls every 2s until is_complete: true. No retry logic.
 * When opts.stream is true, emits NDJSON poll events to stdout as each poll completes.
 */
export async function searchConsensus(
  query: string,
  opts: SearchOptions,
  session: CDPSession
): Promise<Paper[]> {
  const page = opts.page ?? 0;
  const size = opts.n ?? 20;
  const offset = page * size;

  const interaction = await startSearch(query, opts, session);
  await watchAgentStream(interaction, session);

  let isComplete = false;
  let rawPapers: Record<string, unknown>[] = [];
  const deadline = Date.now() + SEARCH_TIMEOUT_MS;

  while (!isComplete) {
    await new Promise((r) => setTimeout(r, 2000));
    const result = await pollSearch(interaction, offset, size, session);
    rawPapers = result.papers;
    isComplete = result.isComplete;

    if (opts.stream) {
      const papers = rawPapers.map(mapPaper);
      const line = JSON.stringify({ event: "poll", is_complete: isComplete, papers });
      process.stdout.write(line + "\n");
    }

    if (!isComplete && Date.now() > deadline) {
      if (rawPapers.length === 0) {
        throw new Error(
          `Search timed out after ${SEARCH_TIMEOUT_MS / 1000}s with no results`
        );
      }
      break;
    }
  }

  const papers = rawPapers.map(mapPaper);

  if (opts.sort === "citations") {
    papers.sort((a, b) => b.citations - a.citations);
  }

  return papers;
}
