import { NextResponse } from "next/server";
import {
  clearKimiAuth,
  getKimiAuthState,
  invalidateKimiAuthCache,
  isKimiOAuthAuthenticated,
} from "@/lib/auth/kimi-auth";
import { KIMI_MODEL_IDS } from "@/lib/auth/kimi-models";
import { invalidateProviderCacheFor } from "@/lib/ai/providers";
import { invalidateSettingsCache } from "@/lib/settings/settings-manager";
import { authRouteErrorResponse } from "@/lib/api/shared-handlers";

export async function GET() {
  try {
    invalidateSettingsCache();
    invalidateKimiAuthCache();
    const authState = getKimiAuthState();
    const authenticated = isKimiOAuthAuthenticated();
    return NextResponse.json({
      success: true,
      authenticated,
      email: authState.email,
      expiresAt: authState.expiresAt,
      availableModels: authenticated ? KIMI_MODEL_IDS : [],
    });
  } catch (error) {
    console.error("[KimiAuth] Failed to get auth status:", error);
    return authRouteErrorResponse("Failed to get authentication status");
  }
}

export async function DELETE() {
  try {
    clearKimiAuth();
    invalidateProviderCacheFor("kimi");
    return NextResponse.json({
      success: true,
      message: "Kimi authentication cleared",
    });
  } catch (error) {
    console.error("[KimiAuth] Failed to clear auth:", error);
    return authRouteErrorResponse("Failed to clear authentication");
  }
}
