/**
 * Chrome DevTools Protocol (CDP) module
 * Connects to Chrome/Dia browser via CDP WebSocket on port 9222.
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

const CDP_PORT = 9222;

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
    throw new Error(
      "Dia browser not running (CDP port 9222 unreachable)"
    );
  }

  const pageTargets = targets.filter((t) => t.type === "page");
  if (pageTargets.length === 0) {
    throw new Error(
      "Dia browser not running (CDP port 9222 unreachable)"
    );
  }

  const target = pageTargets[0];
  return {
    targetId: target.id,
    sessionId: target.id,
    wsUrl: target.webSocketDebuggerUrl,
  };
}

/**
 * Connect to CDP on the default port (9222).
 */
export async function connectToCDP(): Promise<CDPSession> {
  return connectToCDPOnPort(CDP_PORT);
}

/**
 * Ensure a tab is open on consensus.app and return a CDPSession pointing to it.
 * If a tab is already on consensus.app, return a session for that tab.
 * If no tab is on consensus.app, navigate the current session's tab to it,
 * wait 3s for the page to load, then return the updated session.
 */
export async function ensureConsensusTab(session: CDPSession): Promise<CDPSession> {
  let targets: CDPTarget[];

  try {
    const response = await fetch(`http://localhost:9222/json`);
    targets = (await response.json()) as CDPTarget[];
  } catch {
    throw new Error(
      "Dia browser not running (CDP port 9222 unreachable)"
    );
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
