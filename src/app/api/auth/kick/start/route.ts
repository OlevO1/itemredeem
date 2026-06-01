import { NextRequest, NextResponse } from "next/server";
import { createPkce, randomToken, setOAuthCookie } from "@/lib/server/kick-session";
import { getKickClientId, getRedirectUri } from "@/lib/server/kick-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { codeChallenge, codeVerifier } = createPkce();
  const state = randomToken(24);
  const redirectUri = getRedirectUri(request.nextUrl.origin);
  const authorizeUrl = new URL("https://id.kick.com/oauth/authorize");

  authorizeUrl.searchParams.set("client_id", getKickClientId());
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "chat:write user:read");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(authorizeUrl);
  setOAuthCookie(response, {
    state,
    codeVerifier,
    createdAt: Date.now(),
  });

  return response;
}
