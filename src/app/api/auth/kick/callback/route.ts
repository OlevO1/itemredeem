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

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code") || "";
  const state = request.nextUrl.searchParams.get("state") || "";
  const stored = readOAuthState(request);
  const homeUrl = new URL("/", request.nextUrl.origin);

  if (!code || !state || !stored || !safeEquals(state, stored.state)) {
    homeUrl.searchParams.set("auth", "failed");
    return NextResponse.redirect(homeUrl);
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
