import { NextResponse } from "next/server";
import {
  pollKimiDeviceToken,
  saveKimiOAuthToken,
} from "@/lib/auth/kimi-auth";
import { invalidateProviderCacheFor } from "@/lib/ai/providers";
import { authRouteErrorResponse } from "@/lib/api/shared-handlers";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { device_code } = body;

    if (!device_code || typeof device_code !== "string") {
      return NextResponse.json(
        { success: false, error: "device_code is required and must be a string" },
        { status: 400 }
      );
    }

    const result = await pollKimiDeviceToken(device_code);

    if (result.status === "pending") {
      return NextResponse.json({ success: true, status: "pending" });
    }

    if (result.status === "slow_down") {
      return NextResponse.json({ success: true, status: "slow_down" });
    }

    if (result.status === "success" && result.token) {
      // Save the token and set kimi as active provider
      saveKimiOAuthToken(result.token, undefined, true);
      invalidateProviderCacheFor("kimi");

      return NextResponse.json({
        success: true,
        status: "success",
        expiresAt: result.token.expires_at,
      });
    }

    return NextResponse.json(
      { success: false, status: "error", error: result.error || "Unknown error" },
      { status: 400 }
    );
  } catch (error) {
    console.error("[KimiAuth] Device poll error:", error);
    return authRouteErrorResponse("Failed to poll device authorization");
  }
}
