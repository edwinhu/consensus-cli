/**
 * CLI entry point for consensus-cli.
 * Usage: consensus search "<query>" [options]
 */

import { parseArgs } from "util";
import { connectToCDP, ensureConsensusTab } from "./cdp.ts";
import { searchConsensus } from "./search.ts";
import type { SearchOptions } from "./search.ts";

const HELP_TEXT = `Usage: consensus search "<query>" [options]

Options:
  --n <int>              Number of results (default: 20, max: 100)
  --type <csv>           Study types: rct,systematic,meta,non_rct,observational,lit_review,case,animal,in_vitro
  --years <range>        Year range: 2018-2024 or past N years (e.g. 5)
  --min-citations <int>  Minimum citation count
  --rank <q1|q2|q3|q4>  Journal quartile filter
  --human                Restrict to human studies
  --rct                  Shorthand for --type rct
  --open-access          Open access papers only
  --exclude-preprints    Exclude preprints
  --sample-size <int>    Minimum sample size
  --duration <value>     Minimum duration: 6mo, 1yr, 30d, 2wk
  --domain <csv>         Fields of study: Medicine,Chemistry,...
  --country <csv>        Country filter: USA,UK,...
  --controlled           Controlled studies only
  --page <int>           Page number (default: 0)
  --sort <field>         Sort results: citations (client-side, desc)
  --stream               Emit NDJSON poll events as results arrive
  -h, --help             Show this help

Prerequisites:
  Dia browser must be running with CDP enabled on port 9222.
`;

async function main(): Promise<void> {
  let values: ReturnType<typeof parseArgs>["values"];
  let positionals: string[];

  try {
    const parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        n: { type: "string", default: "20" },
        type: { type: "string" },
        years: { type: "string" },
        "min-citations": { type: "string" },
        rank: { type: "string" },
        human: { type: "boolean", default: false },
        rct: { type: "boolean", default: false },
        "open-access": { type: "boolean", default: false },
        "exclude-preprints": { type: "boolean", default: false },
        "sample-size": { type: "string" },
        duration: { type: "string" },
        domain: { type: "string" },
        country: { type: "string" },
        controlled: { type: "boolean", default: false },
        page: { type: "string", default: "0" },
        sort: { type: "string" },
        stream: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        format: { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (err) {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  }

  if (values.help) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }

  const subcommand = positionals[0];
  if (subcommand !== "search") {
    const msg =
      subcommand === undefined
        ? "Error: subcommand required. Usage: consensus search \"<query>\" [options]"
        : `Error: unknown subcommand "${subcommand}". Did you mean "search"?`;
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  }

  const query = positionals[1];
  if (!query) {
    process.stderr.write(
      'Error: search query is required. Usage: consensus search "<query>" [options]\n'
    );
    process.exit(1);
  }

  const n = values.n ? parseInt(values.n as string, 10) : 20;
  if (n < 1 || n > 100) {
    process.stderr.write("Error: --n must be between 1 and 100\n");
    process.exit(1);
  }

  const opts: SearchOptions = {
    n,
    type: values.type as string | undefined,
    years: values.years as string | undefined,
    minCitations: values["min-citations"]
      ? parseInt(values["min-citations"] as string, 10)
      : undefined,
    rank: values.rank as string | undefined,
    human: values.human as boolean,
    rct: values.rct as boolean,
    openAccess: values["open-access"] as boolean,
    excludePreprints: values["exclude-preprints"] as boolean,
    sampleSize: values["sample-size"]
      ? parseInt(values["sample-size"] as string, 10)
      : undefined,
    duration: values.duration as string | undefined,
    domain: values.domain as string | undefined,
    country: values.country as string | undefined,
    controlled: values.controlled as boolean,
    page: values.page ? parseInt(values.page as string, 10) : 0,
    sort: values.sort as string | undefined,
    stream: values.stream as boolean,
  };

  const initialSession = await connectToCDP();
  const session = await ensureConsensusTab(initialSession);
  const papers = await searchConsensus(query, opts, session);
  process.stdout.write(JSON.stringify(papers, null, 2) + "\n");
}

main().catch((err: unknown) => {
  process.stderr.write(
    `${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
