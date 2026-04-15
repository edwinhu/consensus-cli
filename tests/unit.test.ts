import { describe, test, expect } from "bun:test";
import { connectToCDP, connectToCDPOnPort } from "../src/cdp.ts";
import { buildFilters, buildPostBody, mapPaper } from "../src/search.ts";

describe("CDP module", () => {
  test("connectToCDP throws when port is unreachable", async () => {
    // Use a definitely-closed port for isolation
    await expect(connectToCDPOnPort(19999)).rejects.toThrow("9222");
  });

  test("connectToCDP error message contains 'Dia browser not running'", async () => {
    await expect(connectToCDPOnPort(19999)).rejects.toThrow(
      "Dia browser not running (CDP port 9222 unreachable)"
    );
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

describe("CLI subprocess tests", () => {
  const BINARY = "/Users/vwh7mb/projects/consensus-cli/consensus";

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
    // Run binary without Dia running — CDP port 9222 will be unreachable
    // We probe this by running `search` which will attempt CDP connection
    const result = Bun.spawnSync([BINARY, "search", "test query"], {
      timeout: 30000,
    });
    // If Dia is not running, exit code must be 1
    // If Dia IS running, this test is a no-op (exitCode 0 is also acceptable)
    if (result.exitCode !== 0) {
      expect(result.exitCode).toBe(1);
      const stderr = result.stderr.toString();
      expect(stderr).toContain("9222");
    }
  }, 30000);
});
