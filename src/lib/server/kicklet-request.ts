import { ProxyAgent, request } from "undici";
import { backendRequest } from "@/lib/server/backend-client";

const KICKLET_REQUEST_TIMEOUT_MS = 10_000;
const KICKLET_UNAVAILABLE_ERROR = "Kicklet API jelenleg nem elérhető";
const kickletHeaders = {
  accept: "application/json, text/plain, */*",
  "accept-language": "hu-HU,hu;q=0.9,en;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  referer: "https://kicklet.app/",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

type KickletMethod = "GET" | "PATCH";

type KickletTarget = {
  label: string;
  proxyUrl: string | null;
};

export type KickletRequestResult = {
  ok: boolean;
  status: number;
  data: unknown;
  unavailable: boolean;
};

const proxyAgents = new Map<string, ProxyAgent>();
let preferredTargetLabel: string | null = null;

export function normalizeKickletApiToken(value: string | null | undefined) {
  return String(value || "").trim().replace(/^apitoken\s+/i, "");
}

function configuredProxyUrls() {
  const explicit = (process.env.PROXY_URLS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (explicit.length) {
    return [...new Set(explicit)];
  }

  const template = String(process.env.PROXY_TEMPLATE || "").trim();

  if (!template) {
    return [];
  }

  const count = Math.min(
    20,
    Math.max(1, Number.parseInt(process.env.KICKLET_PROXY_COUNT || "5", 10) || 5),
  );

  return Array.from({ length: count }, (_, index) =>
    template.replaceAll("{index}", String(index + 1)),
  );
}

function requestTargets(method: KickletMethod) {
  const targets: KickletTarget[] = [
    { label: "direct", proxyUrl: null },
    ...configuredProxyUrls().map((proxyUrl, index) => ({
      label: `proxy#${index + 1}`,
      proxyUrl,
    })),
  ];
  const preferredIndex = targets.findIndex(
    (target) => target.label === preferredTargetLabel,
  );

  if (preferredIndex > 0) {
    const [preferred] = targets.splice(preferredIndex, 1);
    targets.unshift(preferred);
  }

  return method === "GET" ? targets : targets.slice(0, 1);
}

function dispatcherFor(proxyUrl: string | null) {
  if (!proxyUrl) {
    return undefined;
  }

  if (!proxyAgents.has(proxyUrl)) {
    proxyAgents.set(proxyUrl, new ProxyAgent(proxyUrl));
  }

  return proxyAgents.get(proxyUrl);
}

function isLikelyHtml(text: string) {
  return /(?:^\s*<!doctype html|^\s*<html\b|<title>Just a moment|cf-chl|cloudflare)/iu.test(
    text,
  );
}

function parseResponse(text: string, contentType: string) {
  if (!text) {
    return {
      data: null,
      nonJson: false,
      html: false,
    };
  }

  try {
    return {
      data: JSON.parse(text) as unknown,
      nonJson: false,
      html: false,
    };
  } catch {
    const html = contentType.includes("text/html") || isLikelyHtml(text);

    return {
      data: {
        message: html
          ? KICKLET_UNAVAILABLE_ERROR
          : "Kicklet API nem JSON választ adott",
        nonJsonResponse: true,
        htmlResponse: html,
      },
      nonJson: true,
      html,
    };
  }
}

function compactLogBody(value: string) {
  return value.replace(/\s+/gu, " ").trim().slice(0, 4000);
}

function logKickletFailure(
  source: string,
  method: KickletMethod,
  url: string,
  status: number,
  body: string,
) {
  const endpoint = `${new URL(url).pathname}${new URL(url).search}`;
  const response = compactLogBody(body);

  console.error(`[Kicklet] ${method} ${source} request failed`, {
    endpoint,
    status,
    response,
  });

  void backendRequest("/logs/kicklet", {
    method: "POST",
    body: JSON.stringify({
      source: `${method} ${source}`,
      endpoint,
      status,
      response,
    }),
  }).catch(() => {});
}

function shouldRetryGet(result: KickletRequestResult) {
  return (
    result.unavailable &&
    (result.status === 0 ||
      result.status === 403 ||
      result.status === 429 ||
      result.status === 502 ||
      result.status === 503)
  );
}

async function executeKickletRequest(
  url: string,
  target: KickletTarget,
  options: {
    method: KickletMethod;
    apiToken?: string;
    body?: unknown;
  },
): Promise<KickletRequestResult> {
  const cleanToken = normalizeKickletApiToken(options.apiToken);
  const authorization = cleanToken ? `apitoken ${cleanToken}` : "";

  try {
    const response = await request(url, {
      method: options.method,
      headers: {
        ...kickletHeaders,
        ...(authorization ? { authorization } : {}),
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      dispatcher: dispatcherFor(target.proxyUrl),
      maxRedirections: 3,
      headersTimeout: KICKLET_REQUEST_TIMEOUT_MS,
      bodyTimeout: KICKLET_REQUEST_TIMEOUT_MS,
    });
    const text = await response.body.text();
    const contentType = String(response.headers["content-type"] || "").toLowerCase();
    const parsed = parseResponse(text, contentType);
    const unavailable =
      parsed.html ||
      (parsed.nonJson && response.statusCode >= 200 && response.statusCode < 300);
    const ok =
      response.statusCode >= 200 &&
      response.statusCode < 300 &&
      !parsed.nonJson;

    if (!ok) {
      logKickletFailure(
        target.label,
        options.method,
        url,
        response.statusCode,
        text,
      );
    }

    return {
      ok,
      status: response.statusCode,
      data: parsed.data,
      unavailable,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logKickletFailure(target.label, options.method, url, 0, message);

    return {
      ok: false,
      status: 0,
      data: {
        message: KICKLET_UNAVAILABLE_ERROR,
        requestFailed: true,
      },
      unavailable: true,
    };
  }
}

export async function requestKickletJson(
  url: string,
  options: {
    method?: KickletMethod;
    apiToken?: string;
    body?: unknown;
  } = {},
) {
  const method = options.method || "GET";
  const targets = requestTargets(method);
  let lastResult: KickletRequestResult = {
    ok: false,
    status: 503,
    data: { message: KICKLET_UNAVAILABLE_ERROR },
    unavailable: true,
  };

  for (const target of targets) {
    const result = await executeKickletRequest(url, target, {
      ...options,
      method,
    });
    lastResult = result;

    if (result.ok) {
      preferredTargetLabel = target.label;
      return result;
    }

    if (method !== "GET" || !shouldRetryGet(result)) {
      return result;
    }
  }

  return lastResult;
}

export function fetchKickletJson(url: string) {
  return requestKickletJson(url);
}
