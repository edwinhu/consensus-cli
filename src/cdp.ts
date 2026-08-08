/**
 * Chrome DevTools Protocol (CDP) module
 * Connects to Chrome/Dia browser via CDP WebSocket.
 * Port defaults to 9250; override with CONSENSUS_CDP_PORT.
 */

export interface CDPSession {
  targetId: string;
  sessionId: string;
  wsUrl: string;
}

interface CDPTarget {
  id: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
  type: string;
}

interface CDPResponse {
  id: number;
  result?: {
    result?: {
      type: string;
      value: unknown;
      description?: string;
    };
    exceptionDetails?: {
      text: string;
      exception?: { description?: string };
    };
  };
  error?: {
    code: number;
    message: string;
  };
}

// Default targets the dedicated automation profile
// (--user-data-dir=~/.config/chrome-cdp); port 9222 is a Chrome on the default
// profile — the user's primary browser — and driving it steals focus.
const DEFAULT_CDP_PORT = 9250;

function isValidPort(p: number | undefined): p is number {
  return typeof p === "number" && Number.isInteger(p) && p > 0 && p < 65536;
}

/**
 * Resolve the CDP port. Precedence: CONSENSUS_CDP_PORT > CDP_PORT > default.
 * Invalid values at any level fall through to the next.
 *
 * CDP_PORT is the shared fallback: setting it configures every CLI in this
 * family at once, while the tool-specific variable still wins.
 */
export function cdpPort(): number {
  for (const name of ["CONSENSUS_CDP_PORT", "CDP_PORT"]) {
    const raw = process.env[name];
    if (raw !== undefined) {
      const parsed = parseInt(raw, 10);
      if (isValidPort(parsed)) {
        return parsed;
      }
    }
  }
  return DEFAULT_CDP_PORT;
}

/**
 * Exit codes shared across this CLI family, following sysexits conventions so
 * scripts and cron can branch on the cause without parsing stderr.
 */
export const EXIT = {
  OK: 0,
  UNAVAILABLE: 69,
  NOPERM: 77,
  TEMPFAIL: 75,
} as const;

/** An auth/environment failure carrying the exit code the CLI should use. */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly exitCode: number
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function browserUnreachable(port: number): AuthError {
  return new AuthError(
    `Chrome not reachable on CDP port ${port}. Start Chrome with ` +
      `--remote-debugging-port=${port} (automation profile: ~/.config/chrome-cdp), then retry.`,
    EXIT.UNAVAILABLE
  );
}

export function notSignedIn(service: string, port: number): AuthError {
  return new AuthError(
    `Not signed in to ${service} in the Chrome on CDP port ${port}. ` +
      `Sign in there, then retry.`,
    EXIT.NOPERM
  );
}

export function blocked(service: string, port: number): AuthError {
  return new AuthError(
    `${service} returned a CAPTCHA or rate limit. Solve it in Chrome on CDP ` +
      `port ${port}, then retry.`,
    EXIT.TEMPFAIL
  );
}

function unreachableError(port: number): Error {
  return browserUnreachable(port);
}

/**
 * Connect to CDP on a specific port (exported for testing).
 * Throws with the standard error message when unreachable.
 */
export async function connectToCDPOnPort(port: number): Promise<CDPSession> {
  let targets: CDPTarget[];

  try {
    const response = await fetch(`http://localhost:${port}/json`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    targets = (await response.json()) as CDPTarget[];
  } catch {
    throw unreachableError(port);
  }

  const pageTargets = targets.filter((t) => t.type === "page");
  if (pageTargets.length === 0) {
    throw unreachableError(port);
  }

  const target = pageTargets[0];
  return {
    targetId: target.id,
    sessionId: target.id,
    wsUrl: target.webSocketDebuggerUrl,
  };
}

/**
 * Connect to CDP on the configured port.
 */
export async function connectToCDP(): Promise<CDPSession> {
  return connectToCDPOnPort(cdpPort());
}

/**
 * Ensure a tab is open on consensus.app and return a CDPSession pointing to it.
 * If a tab is already on consensus.app, return a session for that tab.
 * If no tab is on consensus.app, navigate the current session's tab to it,
 * wait 3s for the page to load, then return the updated session.
 */
export async function ensureConsensusTab(session: CDPSession): Promise<CDPSession> {
  let targets: CDPTarget[];
  const port = cdpPort();

  try {
    const response = await fetch(`http://localhost:${port}/json`);
    targets = (await response.json()) as CDPTarget[];
  } catch {
    throw unreachableError(port);
  }

  const consensusTab = targets.find(
    (t) => t.type === "page" && t.url.includes("consensus.app")
  );

  if (consensusTab) {
    // Return a session pointing to the existing consensus.app tab
    return {
      targetId: consensusTab.id,
      sessionId: consensusTab.id,
      wsUrl: consensusTab.webSocketDebuggerUrl,
    };
  }

  // Navigate the current session's tab to consensus.app and wait for load
  await sendCDPCommand(session.wsUrl, "Page.navigate", {
    url: "https://consensus.app",
  });
  await new Promise((resolve) => setTimeout(resolve, 3000));

  return {
    targetId: session.targetId,
    sessionId: session.sessionId,
    wsUrl: session.wsUrl,
  };
}

/**
 * Send a CDP command over WebSocket and return the result.
 */
async function sendCDPCommand(
  wsUrl: string,
  method: string,
  params: Record<string, unknown> = {}
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const messageId = 1;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          id: messageId,
          method,
          params,
        })
      );
    };

    ws.onmessage = (event: MessageEvent) => {
      const response = JSON.parse(event.data as string) as CDPResponse;

      if (response.id === messageId) {
        ws.close();

        if (response.error) {
          reject(new Error(`CDP error: ${response.error.message}`));
          return;
        }

        if (response.result?.exceptionDetails) {
          const details = response.result.exceptionDetails;
          const msg =
            details.exception?.description ?? details.text ?? "Script threw an exception";
          reject(new Error(`Script exception: ${msg}`));
          return;
        }

        resolve(response.result?.result?.value);
      }
    };

    ws.onerror = (event: Event) => {
      ws.close();
      reject(new Error(`WebSocket error connecting to ${wsUrl}: ${String(event)}`));
    };

    ws.onclose = () => {
      // no-op; handled via message/error
    };
  });
}

/**
 * Evaluate a JavaScript expression in the context of the CDP session tab.
 * Returns the evaluated result value.
 */
export async function evaluateScript(
  session: CDPSession,
  script: string
): Promise<unknown> {
  return sendCDPCommand(session.wsUrl, "Runtime.evaluate", {
    expression: script,
    awaitPromise: true,
    returnByValue: true,
  });
}
