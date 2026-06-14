import { ProxyAgent, request } from "undici";
import { backendRequest } from "@/lib/server/backend-client";

const kickletHeaders = {
  accept: "application/json, text/plain, */*",
  origin: "https://kicklet.app",
  referer: "https://kicklet.app/user/eazykeee/shop",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
};

let proxyAgent: ProxyAgent | null = null;
let preferProxy = false;

function getProxyUrl() {
  const proxyUrls = (process.env.PROXY_URLS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (proxyUrls.length) {
    return proxyUrls[0];
  }

  return (process.env.PROXY_TEMPLATE || "").replaceAll("{index}", "1").trim();
}

function getProxyAgent() {
  const proxyUrl = getProxyUrl();

  if (!proxyUrl) {
    return null;
  }

  proxyAgent ||= new ProxyAgent(proxyUrl);
  return proxyAgent;
}

async function parseJson(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function logKickletFailure(source: "direct" | "proxy", url: string, status: number, body: string) {
  const endpoint = new URL(url).pathname;

  console.error(`[Kicklet] ${source} request failed`, {
    endpoint,
    status,
    response: body,
  });

  void backendRequest("/logs/kicklet", {
    method: "POST",
    body: JSON.stringify({
      source,
      endpoint,
      status,
      response: body,
    }),
  }).catch(() => {});
}

async function requestThroughProxy(url: string) {
  const dispatcher = getProxyAgent();

  if (!dispatcher) {
    return null;
  }

  try {
    const response = await request(url, {
      method: "GET",
      headers: kickletHeaders,
      dispatcher,
      maxRedirections: 3,
      headersTimeout: 10_000,
      bodyTimeout: 15_000,
    });
    const text = await response.body.text();
    const ok = response.statusCode >= 200 && response.statusCode < 300;

    if (!ok) {
      logKickletFailure("proxy", url, response.statusCode, text);
    }

    return {
      ok,
      status: response.statusCode,
      data: await parseJson(text),
    };
  } catch (error) {
    console.error("[Kicklet] proxy request error", {
      endpoint: new URL(url).pathname,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      ok: false,
      status: 502,
      data: null,
    };
  }
}

export async function fetchKickletJson(url: string) {
  if (preferProxy) {
    const proxied = await requestThroughProxy(url);

    if (proxied) {
      return proxied;
    }
  }

  try {
    const response = await fetch(url, {
      headers: kickletHeaders,
      cache: "no-store",
    });
    const text = await response.text();
    const result = {
      ok: response.ok,
      status: response.status,
      data: await parseJson(text),
    };

    if (!response.ok) {
      logKickletFailure("direct", url, response.status, text);
    }

    if (response.status !== 403 && response.status !== 429) {
      return result;
    }

    preferProxy = true;
  } catch (error) {
    console.error("[Kicklet] direct request error", {
      endpoint: new URL(url).pathname,
      error: error instanceof Error ? error.message : String(error),
    });

    // The production IP may be blocked; retry through the configured proxy.
    preferProxy = true;
  }

  const proxied = await requestThroughProxy(url);

  if (proxied) {
    return proxied;
  }

  return {
    ok: false,
    status: 503,
    data: null,
  };
}
