import type { KickSession } from "./kick-session";

const KICK_ID_BASE_URL = "https://id.kick.com";
const KICK_API_BASE_URL = "https://api.kick.com/public/v1";
const KICK_WEB_BASE_URL = "https://kick.com/api/v2";
const TARGET_CHANNEL_SLUG = "eazykeee";

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
};

type KickChatResponse = {
  ok?: boolean;
  messageId?: string | null;
  data?: {
    is_sent?: boolean;
    message_id?: string;
  };
  message?: string;
};

type KickUserResponse = {
  data?: Array<{
    user_id?: number | string;
    id?: number | string;
    name?: string;
    username?: string;
  }>;
};

let broadcasterUserIdCache: number | null = null;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

export function getKickClientId() {
  return requiredEnv("KICK_CLIENT_ID");
}

export function getKickClientSecret() {
  return requiredEnv("KICK_CLIENT_SECRET");
}

export function getRedirectUri(origin: string) {
  return (
    process.env.KICK_REDIRECT_URI?.trim() ||
    `${origin.replace(/\/$/, "")}/api/auth/kick/callback`
  );
}

export function getRedeemDelayMs() {
  const raw = Number.parseInt(process.env.REDEEM_DELAY_MS || "5000", 10);

  return Number.isFinite(raw) ? Math.max(1000, raw) : 5000;
}

export function getMaxRedeemQuantity() {
  const raw = Number.parseInt(process.env.MAX_REDEEM_QUANTITY || "100", 10);

  return Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 500) : 100;
}

export function isKickConfigured() {
  return Boolean(process.env.KICK_CLIENT_ID && process.env.KICK_CLIENT_SECRET);
}

export async function exchangeCodeForSession({
  code,
  codeVerifier,
  redirectUri,
}: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<KickSession> {
  const body = new URLSearchParams({
    code,
    client_id: getKickClientId(),
    client_secret: getKickClientSecret(),
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  });

  const response = await fetch(`${KICK_ID_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Kick token exchange failed (${response.status})`);
  }

  const session = tokenResponseToSession((await response.json()) as TokenResponse);

  return attachCurrentUser(session);
}

export async function refreshKickSession(
  session: KickSession,
): Promise<KickSession> {
  const body = new URLSearchParams({
    refresh_token: session.refreshToken,
    client_id: getKickClientId(),
    client_secret: getKickClientSecret(),
    grant_type: "refresh_token",
  });

  const response = await fetch(`${KICK_ID_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Kick token refresh failed (${response.status})`);
  }

  return {
    ...(await attachCurrentUser(
      tokenResponseToSession((await response.json()) as TokenResponse),
    )),
  };
}

export async function ensureFreshSession(session: KickSession) {
  if (session.expiresAt - Date.now() > 60_000) {
    return { session, refreshed: false };
  }

  return {
    session: await refreshKickSession(session),
    refreshed: true,
  };
}

function tokenResponseToSession(data: TokenResponse): KickSession {
  if (!data.access_token || !data.refresh_token) {
    throw new Error("Kick token response is missing tokens");
  }

  const expiresIn = Number(data.expires_in || 3600);

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
    scope: data.scope,
    tokenType: data.token_type,
  };
}

export async function getCurrentKickUser(accessToken: string) {
  const response = await fetch(`${KICK_API_BASE_URL}/users`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Kick user lookup failed (${response.status})`);
  }

  const body = (await response.json()) as KickUserResponse;
  const user = body.data?.[0];
  const userId = Number(user?.user_id || user?.id);
  const userName = String(user?.name || user?.username || "").trim();

  if (!userName) {
    throw new Error("Kick user response is missing username");
  }

  return {
    userId: Number.isFinite(userId) ? userId : null,
    userName,
  };
}

async function attachCurrentUser(session: KickSession): Promise<KickSession> {
  const user = await getCurrentKickUser(session.accessToken);

  return {
    ...session,
    userId: user.userId,
    userName: user.userName,
  };
}

async function resolveBroadcasterUserId() {
  const configured = Number.parseInt(
    process.env.KICK_BROADCASTER_USER_ID || "",
    10,
  );

  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }

  if (broadcasterUserIdCache) {
    return broadcasterUserIdCache;
  }

  const slug = process.env.KICK_TARGET_CHANNEL || TARGET_CHANNEL_SLUG;
  const response = await fetch(
    `${KICK_WEB_BASE_URL}/channels/${encodeURIComponent(slug)}`,
    {
      headers: {
        accept: "application/json",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`Could not resolve ${slug} broadcaster (${response.status})`);
  }

  const data = (await response.json()) as {
    user?: { id?: number | string };
    user_id?: number | string;
  };
  const id = Number(data.user?.id || data.user_id);

  if (!Number.isFinite(id) || id < 1) {
    throw new Error(`Could not resolve ${slug} broadcaster id`);
  }

  broadcasterUserIdCache = id;
  return id;
}

export async function sendKickChatMessage({
  accessToken,
  content,
}: {
  accessToken: string;
  content: string;
}) {
  const trimmed = content.trim().slice(0, 500);

  if (!trimmed) {
    throw new Error("Empty chat message");
  }

  const gatewayUrl = process.env.KICK_CHAT_GATEWAY_URL || "http://127.0.0.1:2320";
  const gatewayToken = process.env.KICK_CHAT_GATEWAY_TOKEN || "";
  const gatewayClientName = process.env.KICK_CHAT_GATEWAY_CLIENT_NAME || "kickletbulkredeem";
  const response = await fetch(`${gatewayUrl.replace(/\/$/, "")}/send`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-backend-name": gatewayClientName,
      ...(gatewayToken ? { authorization: `Bearer ${gatewayToken}` } : {}),
    },
    body: JSON.stringify({
      accessToken,
      broadcasterUserId: await resolveBroadcasterUserId(),
      clientName: gatewayClientName,
      content: trimmed,
    }),
  });

  const body = (await response.json().catch(() => null)) as KickChatResponse | null;

  if (!response.ok) {
    throw new Error(body?.message || `Kick chat send failed (${response.status})`);
  }

  return {
    sent: body?.ok === true || body?.data?.is_sent !== false,
    messageId: body?.messageId || body?.data?.message_id || null,
  };
}
