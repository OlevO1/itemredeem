import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForSession, getRedirectUri } from "@/lib/server/kick-api";
import {
  clearAuthCookies,
  cookieOptions,
  OAUTH_COOKIE,
  readOAuthState,
  safeEquals,
  setSessionCookie,
} from "@/lib/server/kick-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code") || "";
  const state = request.nextUrl.searchParams.get("state") || "";
  const stored = readOAuthState(request);
  const homeUrl = new URL("/", request.nextUrl.origin);

  const storedAge = stored ? Date.now() - stored.createdAt : Number.POSITIVE_INFINITY;
  const validStoredState =
    stored &&
    typeof stored.state === "string" &&
    typeof stored.codeVerifier === "string" &&
    Number.isFinite(stored.createdAt) &&
    storedAge >= 0 &&
    storedAge <= OAUTH_STATE_MAX_AGE_MS;

  if (!code || !state || !validStoredState || !safeEquals(state, stored.state)) {
    homeUrl.searchParams.set("auth", "failed");
    const response = NextResponse.redirect(homeUrl);
    response.cookies.set(OAUTH_COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
    return response;
  }

  try {
    const session = await exchangeCodeForSession({
      code,
      codeVerifier: stored.codeVerifier,
      redirectUri: getRedirectUri(request.nextUrl.origin),
    });
    const response = NextResponse.redirect(homeUrl);

    setSessionCookie(response, session);
    response.cookies.set(OAUTH_COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
    return response;
  } catch {
    homeUrl.searchParams.set("auth", "failed");
    const response = NextResponse.redirect(homeUrl);
    clearAuthCookies(response);
    return response;
  }
}
