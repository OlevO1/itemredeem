import crypto from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

export const SESSION_COOKIE = "kick_session";
export const OAUTH_COOKIE = "kick_oauth";

const TEXT_ENCODER = new TextEncoder();

export type KickSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope?: string;
  tokenType?: string;
  userId?: number | null;
  userName?: string | null;
};

export type OAuthState = {
  state: string;
  codeVerifier: string;
  createdAt: number;
};

export function isTestAuthEnabled() {
  const raw = process.env.TEST ?? process.env.test ?? "";

  return /^(1|true|yes|on)$/iu.test(raw.trim());
}

function testSession(): KickSession {
  return {
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    expiresAt: Date.now() + 1000 * 60 * 60 * 24,
    scope: "chat:write user:read",
    tokenType: "Bearer",
    userId: 0,
    userName:
      process.env.TEST_KICK_USER_NAME?.trim() ||
      process.env.TEST_USER_NAME?.trim() ||
      "test-user",
  };
}

function getSessionSecret() {
  const secret =
    process.env.KICK_SESSION_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "";

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("KICK_SESSION_SECRET is required in production");
  }

  return "kickletbulkredeem-local-development-secret";
}

function key() {
  return crypto.createHash("sha256").update(getSessionSecret()).digest();
}

function toBase64Url(input: Buffer) {
  return input.toString("base64url");
}

function fromBase64Url(input: string) {
  return Buffer.from(input, "base64url");
}

export function randomToken(bytes = 32) {
  return toBase64Url(crypto.randomBytes(bytes));
}

export function sha256Base64Url(value: string) {
  return toBase64Url(crypto.createHash("sha256").update(value).digest());
}

export function encryptJson(value: unknown) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [toBase64Url(iv), toBase64Url(tag), toBase64Url(encrypted)].join(".");
}

export function decryptJson<T>(value: string): T | null {
  const parts = value.split(".");

  if (parts.length !== 3) {
    return null;
  }

  try {
    const [iv, tag, encrypted] = parts.map(fromBase64Url);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function createPkce() {
  const codeVerifier = randomToken(48);

  return {
    codeVerifier,
    codeChallenge: sha256Base64Url(codeVerifier),
  };
}

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export function setSessionCookie(response: NextResponse, session: KickSession) {
  response.cookies.set(
    SESSION_COOKIE,
    encryptJson(session),
    cookieOptions(60 * 60 * 24 * 14),
  );
}

export function setOAuthCookie(response: NextResponse, state: OAuthState) {
  response.cookies.set(
    OAUTH_COOKIE,
    encryptJson(state),
    cookieOptions(60 * 10),
  );
}

export function clearAuthCookies(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
  response.cookies.set(OAUTH_COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
}

export function isCompleteKickSession(
  session: KickSession | null,
): session is KickSession {
  return Boolean(
    session?.accessToken &&
      session.refreshToken &&
      session.userName &&
      Number.isFinite(session.expiresAt),
  );
}

export function readSession(request: NextRequest) {
  if (isTestAuthEnabled()) {
    return testSession();
  }

  const raw = request.cookies.get(SESSION_COOKIE)?.value;
  const session = raw ? decryptJson<KickSession>(raw) : null;

  return isCompleteKickSession(session) ? session : null;
}

export function readOAuthState(request: NextRequest) {
  const raw = request.cookies.get(OAUTH_COOKIE)?.value;

  return raw ? decryptJson<OAuthState>(raw) : null;
}

export function safeEquals(a: string, b: string) {
  const left = TEXT_ENCODER.encode(a);
  const right = TEXT_ENCODER.encode(b);

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}
