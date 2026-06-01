import { NextResponse } from "next/server";
import { clearAuthCookies } from "@/lib/server/kick-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearAuthCookies(response);

  return response;
}
