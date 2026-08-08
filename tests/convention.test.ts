// Golden values for the auth convention shared with google-scholar-cli.
//
// These strings and exit codes are duplicated VERBATIM in
// ~/projects/google-scholar-cli/src/cdp.ts, deliberately by convention rather
// than through a shared package: the common surface is ~40 lines, and a shared
// dependency would mean a third versioned artifact plus a coordinated release
// (and a nix hash bump on both CLIs) every time it changed.
//
// The cost of that choice is drift. This file is the thing that notices.
// If you change any value here, change it in the sibling repo too.

import { describe, test, expect } from "bun:test";
import {
  EXIT,
  AuthError,
  browserUnreachable,
  notSignedIn,
  blocked,
} from "../src/cdp.ts";

// The exact shared wording. notSignedIn is a PREFIX: scholar appends a
// tool-specific re-auth hint, which consensus has no equivalent of because it
// drives the live browser and keeps no cookie snapshot to go stale.
const GOLDEN = {
  exit: { OK: 0, UNAVAILABLE: 69, NOPERM: 77, TEMPFAIL: 75 },
  browserUnreachable:
    "Chrome not reachable on CDP port 9250. Start Chrome with " +
    "--remote-debugging-port=9250 (automation profile: ~/.config/chrome-cdp), then retry.",
  notSignedInPrefix:
    "Not signed in to example.com in the Chrome on CDP port 9250. Sign in there, then retry.",
  blocked:
    "example.com returned a CAPTCHA or rate limit. Solve it in Chrome on CDP port 9250, then retry.",
};

describe("auth convention (golden)", () => {
  test("EXIT codes are exactly the shared sysexits set", () => {
    expect(EXIT).toEqual(GOLDEN.exit);
  });

  test("browserUnreachable matches the shared wording", () => {
    const e = browserUnreachable(9250);
    expect(e).toBeInstanceOf(AuthError);
    expect(e.message).toBe(GOLDEN.browserUnreachable);
    expect(e.exitCode).toBe(GOLDEN.exit.UNAVAILABLE);
  });

  test("notSignedIn matches the shared wording", () => {
    const e = notSignedIn("example.com", 9250);
    expect(e.message).toStartWith(GOLDEN.notSignedInPrefix);
    expect(e.exitCode).toBe(GOLDEN.exit.NOPERM);
  });

  test("consensus adds no tool-specific suffix to notSignedIn", () => {
    // scholar appends a re-auth hint here; consensus must not, since it has no
    // snapshot to refresh — there would be no command to point the user at.
    expect(notSignedIn("example.com", 9250).message).toBe(
      GOLDEN.notSignedInPrefix
    );
  });

  test("blocked matches the shared wording", () => {
    const e = blocked("example.com", 9250);
    expect(e.message).toBe(GOLDEN.blocked);
    expect(e.exitCode).toBe(GOLDEN.exit.TEMPFAIL);
  });
});

// Golden values above catch an unintended edit *here*. They cannot catch the
// sibling repo drifting away on its own, so when that checkout is present,
// compare against it directly. Skipped rather than failed when absent, so CI
// (which has only this repo) stays green.
const SIBLING = `${process.env.HOME}/projects/google-scholar-cli/src/cdp.ts`;
const siblingExists = await Bun.file(SIBLING).exists();

describe.if(siblingExists)("cross-repo parity with google-scholar-cli", () => {
  test("EXIT and all three messages agree across repos", async () => {
    const sib = await import(SIBLING);

    expect(sib.EXIT).toEqual(EXIT);
    expect(sib.browserUnreachable(9250).message).toBe(
      browserUnreachable(9250).message
    );
    expect(sib.browserUnreachable(9250).exitCode).toBe(EXIT.UNAVAILABLE);

    // shared prefix only — scholar's tool-specific suffix is expected
    expect(sib.notSignedIn("example.com", 9250).message).toStartWith(
      GOLDEN.notSignedInPrefix
    );
    expect(sib.notSignedIn("example.com", 9250).exitCode).toBe(EXIT.NOPERM);

    expect(sib.blocked("example.com", 9250).message).toBe(
      blocked("example.com", 9250).message
    );
    expect(sib.blocked("example.com", 9250).exitCode).toBe(EXIT.TEMPFAIL);
  });
});
