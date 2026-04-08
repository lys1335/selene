import { NextResponse } from "next/server";
import {
  getKimiOAuthToken,
  needsKimiTokenRefresh,
  refreshKimiToken,
  invalidateKimiAuthCache,
} from "@/lib/auth/kimi-auth";
import { invalidateSettingsCache } from "@/lib/settings/settings-manager";

export async function POST() {
  try {
    // Invalidate caches first to prevent race conditions
    invalidateSettingsCache();
    invalidateKimiAuthCache();

    const token = getKimiOAuthToken();
    if (!token) {
      return NextResponse.json({ refreshed: false, reason: "no_token" });
    }
    const now = Date.now();
    const isExpired = token.expires_at <= now;
    const needsRefresh = needsKimiTokenRefresh() || isExpired;
    if (needsRefresh && token.refresh_token) {
      const success = await refreshKimiToken();
      return NextResponse.json({
        refreshed: success,
        reason: success ? "refreshed" : "refresh_failed",
      });
    }
    return NextResponse.json({ refreshed: false, reason: "not_needed" });
  } catch (error) {
    console.error("[KimiRefresh] Error:", error);
    return NextResponse.json(
      { refreshed: false, reason: "error" },
      { status: 500 }
    );
  }
}
