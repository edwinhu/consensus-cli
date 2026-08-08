import { test, expect, describe } from "bun:test";

describe("consensus search CLI", () => {
  test("search returns papers with required fields", () => {
    const result = Bun.spawnSync(
      [
        "bun",
        "run",
        "src/index.ts",
        "search",
        "aspirin heart attack",
        "--n",
        "5",
        "--type",
        "rct",
      ],
      { cwd: new URL("..", import.meta.url).pathname }
    );

    expect(result.exitCode).toBe(0);

    const stdout = result.stdout.toString();
    const papers = JSON.parse(stdout);

    expect(Array.isArray(papers)).toBe(true);
    expect(papers.length).toBeGreaterThan(0);

    const paper = papers[0];
    expect(paper.title).toBeTruthy();
    expect(paper.doi).toBeTruthy();
    expect(paper.takeaway).toBeTruthy();
    expect(paper.year).toBeDefined();
    expect(paper.citations).toBeDefined();
  }, 120000);
});
