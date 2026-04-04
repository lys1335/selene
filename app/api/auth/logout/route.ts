import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, clearUserCache } from "@/lib/auth/local-auth";
import { isSecureRequest } from "@/lib/auth/request-utils";

export async function POST(req: NextRequest) {
  try {
    clearUserCache();

    const response = NextResponse.json({ success: true });

    // Clear the session cookie
    response.cookies.set(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" && isSecureRequest(req),
      sameSite: "lax",
      maxAge: 0, // Expire immediately
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("[Auth] Logout error:", error);
    return NextResponse.json({ error: "Logout failed" }, { status: 500 });
  }
}
