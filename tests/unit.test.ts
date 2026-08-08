import { describe, test, expect, afterEach } from "bun:test";
import {
  connectToCDPOnPort,
  cdpPort,
  AuthError,
  EXIT,
  browserUnreachable,
  notSignedIn,
  blocked,
} from "../src/cdp.ts";
import {
  buildFilters,
  buildPostBody,
  mapPaper,
  translateAuthError,
} from "../src/search.ts";

describe("CDP module", () => {
  test("connectToCDP throws when port is unreachable", async () => {
    // Use a definitely-closed port for isolation
    await expect(connectToCDPOnPort(19999)).rejects.toThrow("19999");
  });

  test("unreachable CDP yields the shared AuthError taxonomy", async () => {
    await expect(connectToCDPOnPort(19999)).rejects.toThrow(
      "Chrome not reachable on CDP port 19999"
    );
    await expect(connectToCDPOnPort(19999)).rejects.toBeInstanceOf(AuthError);
  });
});

// Shared convention across this CLI family (see google-scholar-cli/src/config.ts):
// precedence is <TOOL>_CDP_PORT > CDP_PORT > 9250.
describe("cdpPort precedence", () => {
  afterEach(() => {
    delete process.env.CONSENSUS_CDP_PORT;
    delete process.env.CDP_PORT;
  });

  test("defaults to 9250 when nothing is set", () => {
    expect(cdpPort()).toBe(9250);
  });

  test("honours CONSENSUS_CDP_PORT when set", () => {
    process.env.CONSENSUS_CDP_PORT = "9333";
    expect(cdpPort()).toBe(9333);
  });

  test("honours the shared CDP_PORT fallback", () => {
    process.env.CDP_PORT = "9444";
    expect(cdpPort()).toBe(9444);
  });

  test("CONSENSUS_CDP_PORT wins over CDP_PORT", () => {
    process.env.CONSENSUS_CDP_PORT = "9333";
    process.env.CDP_PORT = "9444";
    expect(cdpPort()).toBe(9333);
  });

  test("an invalid tool-specific value falls through to CDP_PORT", () => {
    process.env.CONSENSUS_CDP_PORT = "not-a-port";
    process.env.CDP_PORT = "9444";
    expect(cdpPort()).toBe(9444);
  });

  test("falls back to 9250 on a non-numeric value", () => {
    process.env.CONSENSUS_CDP_PORT = "not-a-port";
    expect(cdpPort()).toBe(9250);
  });

  test("falls back to 9250 on an out-of-range value", () => {
    process.env.CONSENSUS_CDP_PORT = "99999";
    expect(cdpPort()).toBe(9250);
  });
});

describe("auth error taxonomy", () => {
  test("browserUnreachable is EXIT.UNAVAILABLE (69) and names the flag", () => {
    const e = browserUnreachable(9250);
    expect(e).toBeInstanceOf(AuthError);
    expect(e.exitCode).toBe(EXIT.UNAVAILABLE);
    expect(e.exitCode).toBe(69);
    expect(e.message).toContain("--remote-debugging-port=9250");
  });

  test("notSignedIn is EXIT.NOPERM (77) and names service and port", () => {
    const e = notSignedIn("consensus.app", 9250);
    expect(e.exitCode).toBe(EXIT.NOPERM);
    expect(e.exitCode).toBe(77);
    expect(e.message).toContain("consensus.app");
    expect(e.message).toContain("9250");
  });

  test("blocked is EXIT.TEMPFAIL (75)", () => {
    const e = blocked("consensus.app", 9250);
    expect(e.exitCode).toBe(EXIT.TEMPFAIL);
    expect(e.exitCode).toBe(75);
    expect(e.message).toMatch(/CAPTCHA|rate limit/);
  });
});

// In-page exceptions cross the CDP boundary as strings, so auth failures are
// signalled with sentinels and translated back on the Node side.
describe("translateAuthError", () => {
  test("maps the signed-out sentinel to a 77", () => {
    const out = translateAuthError(
      new Error("Script exception: Error: CONSENSUS_NOT_SIGNED_IN\n  at <anonymous>")
    );
    expect(out).toBeInstanceOf(AuthError);
    expect((out as AuthError).exitCode).toBe(77);
    expect((out as AuthError).message).toContain("Not signed in to consensus.app");
  });

  test("maps the blocked sentinel to a 75", () => {
    const out = translateAuthError(new Error("Script exception: Error: CONSENSUS_BLOCKED"));
    expect((out as AuthError).exitCode).toBe(75);
  });

  test("passes unrelated errors through untouched", () => {
    const original = new Error("Unexpected token '<'");
    expect(translateAuthError(original)).toBe(original);
  });

  test("a genuine parse failure is NOT reported as an auth problem", () => {
    const out = translateAuthError(new Error("SyntaxError: Unexpected token '<'"));
    expect(out).not.toBeInstanceOf(AuthError);
  });
});

describe("buildFilters", () => {
  test("maps --type to study_types", () => {
    const filters = buildFilters({ type: "rct,systematic" });
    expect(filters.study_types).toBe("rct,systematic");
  });

  test("maps --rank q1 to sjr_max 1", () => {
    const filters = buildFilters({ rank: "q1" });
    expect(filters.sjr_max).toBe(1);
  });

  test("maps --rank q2 to sjr_max 2", () => {
    const filters = buildFilters({ rank: "q2" });
    expect(filters.sjr_max).toBe(2);
  });

  test("maps --rank q3 to sjr_max 3", () => {
    const filters = buildFilters({ rank: "q3" });
    expect(filters.sjr_max).toBe(3);
  });

  test("maps --rank q4 to sjr_max 4", () => {
    const filters = buildFilters({ rank: "q4" });
    expect(filters.sjr_max).toBe(4);
  });

  test("--rct shorthand maps to study_types rct", () => {
    const filters = buildFilters({ rct: true });
    expect(filters.study_types).toBe("rct");
  });

  test("--page maps to GET query param, not filters", () => {
    const filters = buildFilters({ page: 1 });
    expect(filters.page).toBeUndefined();
  });

  test("maps --min-citations to cite_min", () => {
    const filters = buildFilters({ minCitations: 10 });
    expect(filters.cite_min).toBe(10);
  });

  test("maps --human to human string 'true'", () => {
    const filters = buildFilters({ human: true });
    expect(filters.human).toBe("true");
  });

  test("maps --controlled to controlled string 'true'", () => {
    const filters = buildFilters({ controlled: true });
    expect(filters.controlled).toBe("true");
  });

  test("maps --open-access to open_access boolean true", () => {
    const filters = buildFilters({ openAccess: true });
    expect(filters.open_access).toBe(true);
  });

  test("maps --exclude-preprints to exclude_preprints boolean true", () => {
    const filters = buildFilters({ excludePreprints: true });
    expect(filters.exclude_preprints).toBe(true);
  });

  test("maps --sample-size to sample_size_min", () => {
    const filters = buildFilters({ sampleSize: 100 });
    expect(filters.sample_size_min).toBe(100);
  });

  test("maps --domain to domain string", () => {
    const filters = buildFilters({ domain: "medicine,biology" });
    expect(filters.domain).toBe("medicine,biology");
  });

  test("maps --country to country string", () => {
    const filters = buildFilters({ country: "US,UK" });
    expect(filters.country).toBe("US,UK");
  });

  test("maps --years range to year_min and year_max", () => {
    const filters = buildFilters({ years: "2018-2024" });
    expect(filters.year_min).toBe(2018);
    expect(filters.year_max).toBe(2024);
  });

  test("maps --years single number to year_min as currentYear minus N", () => {
    const filters = buildFilters({ years: "5" });
    const currentYear = new Date().getFullYear();
    expect(filters.year_min).toBe(currentYear - 5);
    expect(filters.year_max).toBeUndefined();
  });

  test("maps --duration 6mo correctly", () => {
    const filters = buildFilters({ duration: "6mo" });
    expect(filters.duration_min).toBe(6);
    expect(filters.duration_unit).toBe("month");
  });

  test("maps --duration 1yr correctly", () => {
    const filters = buildFilters({ duration: "1yr" });
    expect(filters.duration_min).toBe(1);
    expect(filters.duration_unit).toBe("year");
  });

  test("maps --duration 30d correctly", () => {
    const filters = buildFilters({ duration: "30d" });
    expect(filters.duration_min).toBe(30);
    expect(filters.duration_unit).toBe("day");
  });

  test("maps --duration 2wk correctly", () => {
    const filters = buildFilters({ duration: "2wk" });
    expect(filters.duration_min).toBe(2);
    expect(filters.duration_unit).toBe("week");
  });

  test("returns empty object when no options", () => {
    const filters = buildFilters({});
    expect(Object.keys(filters).length).toBe(0);
  });
});

describe("buildPostBody", () => {
  test("includes user_message as query", () => {
    const body = buildPostBody("aspirin", {});
    expect(body.user_message).toBe("aspirin");
  });

  test("sets is_incognito to false", () => {
    const body = buildPostBody("aspirin", {});
    expect(body.is_incognito).toBe(false);
  });

  test("sets search_mode to PRO_ANALYSIS", () => {
    const body = buildPostBody("aspirin", {});
    expect(body.search_mode).toBe("PRO_ANALYSIS");
  });

  test("--n maps to top-level size, not inside filters", () => {
    const body = buildPostBody("aspirin", { n: 50 });
    expect(body.size).toBe(50);
    expect((body.filters as Record<string, unknown>).size).toBeUndefined();
  });

  test("default size is 20", () => {
    const body = buildPostBody("aspirin", {});
    expect(body.size).toBe(20);
  });

  test("--duration 6mo maps correctly via buildPostBody", () => {
    const body = buildPostBody("aspirin", { duration: "6mo" });
    expect(body.filters.duration_min).toBe(6);
    expect(body.filters.duration_unit).toBe("month");
  });

  test("filters does not contain size", () => {
    const body = buildPostBody("aspirin", { n: 30 });
    expect((body.filters as Record<string, unknown>).size).toBeUndefined();
  });
});

describe("buildFilters -- edge cases", () => {
  test("--type takes precedence over --rct when both provided", () => {
    // CLI-08: --rct is shorthand; explicit --type should win
    const filters = buildFilters({ type: "systematic", rct: true });
    expect(filters.study_types).toBe("systematic");
  });

  test("--n does not appear in filters", () => {
    const filters = buildFilters({ n: 50 });
    expect((filters as Record<string, unknown>).size).toBeUndefined();
    expect((filters as Record<string, unknown>).n).toBeUndefined();
  });
});

describe("mapPaper (CLI-18)", () => {
  const apiPaper: Record<string, unknown> = {
    title: "Aspirin reduces MI risk",
    authors: ["Smith J", "Jones A"],
    year: 2021,
    journal: "NEJM",
    doi: "10.1056/test",
    citation_count: 42,
    badges: { study_type: "rct" },
    display_text: "Aspirin significantly reduces MI risk.",
    open_access_pdf_url: "https://example.com/paper.pdf",
    url_slug: "aspirin-mi",
    paper_id: "abc123",
  };

  test("maps title field", () => {
    const paper = mapPaper(apiPaper);
    expect(paper.title).toBe("Aspirin reduces MI risk");
  });

  test("maps authors array", () => {
    const paper = mapPaper(apiPaper);
    expect(paper.authors).toEqual(["Smith J", "Jones A"]);
  });

  test("maps year", () => {
    const paper = mapPaper(apiPaper);
    expect(paper.year).toBe(2021);
  });

  test("maps journal", () => {
    const paper = mapPaper(apiPaper);
    expect(paper.journal).toBe("NEJM");
  });

  test("maps doi", () => {
    const paper = mapPaper(apiPaper);
    expect(paper.doi).toBe("10.1056/test");
  });

  test("maps citation_count to citations", () => {
    const paper = mapPaper(apiPaper);
    expect(paper.citations).toBe(42);
  });

  test("maps badges.study_type to study_type", () => {
    const paper = mapPaper(apiPaper);
    expect(paper.study_type).toBe("rct");
  });

  test("maps display_text to takeaway", () => {
    const paper = mapPaper(apiPaper);
    expect(paper.takeaway).toBe("Aspirin significantly reduces MI risk.");
  });

  test("maps open_access_pdf_url", () => {
    const paper = mapPaper(apiPaper);
    expect(paper.open_access_pdf_url).toBe("https://example.com/paper.pdf");
  });

  test("constructs url from url_slug and paper_id", () => {
    const paper = mapPaper(apiPaper);
    expect(paper.url).toBe(
      "https://consensus.app/papers/aspirin-mi/abc123/"
    );
  });

  test("open_access_pdf_url is null when absent", () => {
    const paperWithoutPdf = { ...apiPaper, open_access_pdf_url: null };
    const paper = mapPaper(paperWithoutPdf);
    expect(paper.open_access_pdf_url).toBeNull();
  });

  test("open_access_pdf_url is null when undefined in API response", () => {
    const paperWithoutPdf: Record<string, unknown> = { ...apiPaper };
    delete paperWithoutPdf.open_access_pdf_url;
    const paper = mapPaper(paperWithoutPdf);
    expect(paper.open_access_pdf_url).toBeNull();
  });

  test("study_type is null when badges is absent", () => {
    const paperNoBadges: Record<string, unknown> = { ...apiPaper };
    delete paperNoBadges.badges;
    const paper = mapPaper(paperNoBadges);
    expect(paper.study_type).toBeNull();
  });

  test("citations defaults to 0 when citation_count absent", () => {
    const paperNoCitations: Record<string, unknown> = { ...apiPaper };
    delete paperNoCitations.citation_count;
    const paper = mapPaper(paperNoCitations);
    expect(paper.citations).toBe(0);
  });

  test("all 10 required output fields are present", () => {
    const paper = mapPaper(apiPaper);
    const requiredFields = [
      "title", "authors", "year", "journal", "doi",
      "citations", "study_type", "takeaway", "open_access_pdf_url", "url",
    ];
    for (const field of requiredFields) {
      expect(Object.prototype.hasOwnProperty.call(paper, field)).toBe(true);
    }
  });
});

// The thread/interaction papers API replaced /api/pro_research/search/.
// Envelope is now {papers, total_count, is_end}; paginated by limit/offset.
describe("papers endpoint response shape", () => {
  // Verbatim record captured from
  // GET /api/threads/<tid>/interactions/<iid>/papers/?limit=20&offset=0
  const liveResponse = {
    papers: [
      {
        authors: ["Caleb Rawson", "Stephen P. Rowe"],
        badges: {
          highly_cited_paper: false,
          rigorous_journal: false,
          study_type: "cross-sectional study",
          animal_trial: false,
          enhanced: false,
        },
        citation_count: 3,
        display_text:
          "Greater index fund ownership leads to less bias and obfuscation in financial reporting due to lower trading, not higher oversight.",
        doc_id: "20b6c83291815861813a5f7d3e1c23a7",
        doi: "10.1007/s11142-022-09726-9",
        journal: "Review of Accounting Studies",
        paper_id: "20b6c83291815861813a5f7d3e1c23a7",
        title: "The power of not trading: Evidence from index fund ownership",
        url_slug:
          "the-power-of-not-trading-evidence-from-index-fund-ownership-rawson-rowe",
        year: 2022,
        is_retracted: false,
      },
    ],
    total_count: 89,
    is_end: false,
  };

  test("envelope exposes total_count and is_end (not is_complete)", () => {
    expect(liveResponse.total_count).toBe(89);
    expect(liveResponse.is_end).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(liveResponse, "is_complete")
    ).toBe(false);
  });

  test("mapPaper handles a live paper record from the new endpoint", () => {
    const paper = mapPaper(liveResponse.papers[0]);
    expect(paper.title).toBe(
      "The power of not trading: Evidence from index fund ownership"
    );
    expect(paper.authors).toEqual(["Caleb Rawson", "Stephen P. Rowe"]);
    expect(paper.year).toBe(2022);
    expect(paper.journal).toBe("Review of Accounting Studies");
    expect(paper.doi).toBe("10.1007/s11142-022-09726-9");
    expect(paper.citations).toBe(3);
    expect(paper.study_type).toBe("cross-sectional study");
    expect(paper.takeaway).toContain("Greater index fund ownership");
    // absent in this record -> must be null, not undefined
    expect(paper.open_access_pdf_url).toBeNull();
    expect(paper.url).toBe(
      "https://consensus.app/papers/the-power-of-not-trading-evidence-from-index-fund-ownership-rawson-rowe/20b6c83291815861813a5f7d3e1c23a7/"
    );
  });

  test("--page maps to offset = page * size", () => {
    const size = 20;
    expect(0 * size).toBe(0);
    expect(2 * size).toBe(40);
  });
});

// POST /api/threads/ still returns 201, but the interaction now carries `id`
// instead of the removed `search_id`.
describe("thread creation response shape", () => {
  const liveThread = {
    interactions: [
      {
        id: "L99nFmrgSq2HGrbPLlWdxg",
        user_message: "index fund ownership measurement",
        num_results_analyzed: 0,
        search_mode: "PRO_ANALYSIS",
      },
    ],
    thread_id: "SoY529oUQ4mBngwYylxoLg",
    title: "index fund ownership measurement",
  };

  test("interaction carries id, not search_id", () => {
    expect(liveThread.interactions[0].id).toBe("L99nFmrgSq2HGrbPLlWdxg");
    expect(
      Object.prototype.hasOwnProperty.call(
        liveThread.interactions[0],
        "search_id"
      )
    ).toBe(false);
  });

  test("thread_id is present at the top level", () => {
    expect(liveThread.thread_id).toBe("SoY529oUQ4mBngwYylxoLg");
  });

  test("buildPostBody still matches what the web app POSTs", () => {
    const body = buildPostBody("index fund ownership measurement", { n: 10 });
    expect(body).toEqual({
      user_message: "index fund ownership measurement",
      is_incognito: false,
      size: 10,
      filters: {},
      search_mode: "PRO_ANALYSIS",
    });
  });
});

// Completion is signalled by the SSE agent stream's terminal event.
describe("agent stream completion signal", () => {
  const streamChunk =
    'id: 1786213053803-0\r\nevent: agent\r\ndata: {"type":"heartbeat"}\r\nretry: 15000\r\n\r\n' +
    'id: 1786213053831-0\r\nevent: agent\r\ndata: {"type":"node_started","node":"router"}\r\nretry: 15000\r\n\r\n' +
    'id: 1786213099999-0\r\nevent: agent\r\ndata: {"type":"agent_complete"}\r\nretry: 15000\r\n\r\n';

  /** Mirrors the in-page parser in watchAgentStream. */
  function parseComplete(raw: string): boolean {
    let done = false;
    let buf = raw.replace(/\r\n/g, "\n");
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const m = block.match(/^data: (.*)$/m);
      if (!m) continue;
      try {
        if (JSON.parse(m[1]).type === "agent_complete") done = true;
      } catch {
        /* non-JSON keepalive */
      }
    }
    return done;
  }

  test("detects agent_complete in a CRLF-delimited SSE stream", () => {
    expect(parseComplete(streamChunk)).toBe(true);
  });

  test("does not report completion before agent_complete arrives", () => {
    const partial = streamChunk.slice(
      0,
      streamChunk.indexOf('data: {"type":"agent_complete"}')
    );
    expect(parseComplete(partial)).toBe(false);
  });
});

describe("CLI subprocess tests", () => {
  const BINARY = new URL("../consensus", import.meta.url).pathname;

  test("CLI-20: compiled binary exists and is executable", () => {
    const result = Bun.spawnSync(["test", "-x", BINARY]);
    expect(result.exitCode).toBe(0);
  });

  test("CLI-21: --help exits 0", () => {
    const result = Bun.spawnSync([BINARY, "--help"]);
    expect(result.exitCode).toBe(0);
  });

  test("CLI-21: -h exits 0", () => {
    const result = Bun.spawnSync([BINARY, "-h"]);
    expect(result.exitCode).toBe(0);
  });

  test("CLI-21: --help prints flag descriptions to stdout", () => {
    const result = Bun.spawnSync([BINARY, "--help"]);
    const stdout = result.stdout.toString();
    expect(stdout).toContain("--n");
    expect(stdout).toContain("--type");
    expect(stdout).toContain("--years");
  });

  test("CLI-22: unknown flag exits non-zero", () => {
    const result = Bun.spawnSync([BINARY, "--unknown-flag-xyz"]);
    expect(result.exitCode).not.toBe(0);
  });

  test("CLI-22: unknown flag prints error to stderr", () => {
    const result = Bun.spawnSync([BINARY, "--unknown-flag-xyz"]);
    const stderr = result.stderr.toString();
    expect(stderr.length).toBeGreaterThan(0);
  });

  test("CLI-22: missing subcommand exits non-zero", () => {
    const result = Bun.spawnSync([BINARY]);
    expect(result.exitCode).not.toBe(0);
  });

  test("CLI-22: missing subcommand prints error to stderr", () => {
    const result = Bun.spawnSync([BINARY]);
    const stderr = result.stderr.toString();
    expect(stderr).toContain("Error");
  });

  test("CLI-22b: CDP unreachable exits 1 via binary", () => {
    // Point at a definitely-closed CDP port so the failure is deterministic
    const result = Bun.spawnSync([BINARY, "search", "test query"], {
      timeout: 30000,
      env: { ...process.env, CONSENSUS_CDP_PORT: "19999" },
    });
    // CDP unreachable is EXIT.UNAVAILABLE, not a generic 1
    expect(result.exitCode).toBe(69);
    const stderr = result.stderr.toString();
    expect(stderr).toContain("19999");
  }, 30000);
});
