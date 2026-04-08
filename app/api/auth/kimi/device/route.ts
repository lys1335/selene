import { NextResponse } from "next/server";
import { initiateKimiDeviceAuth } from "@/lib/auth/kimi-auth";
import { authRouteErrorResponse } from "@/lib/api/shared-handlers";

export async function POST() {
  try {
    const result = await initiateKimiDeviceAuth();

    if (!result) {
      return NextResponse.json(
        { success: false, error: "Failed to initiate device authorization" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      user_code: result.user_code,
      device_code: result.device_code,
      verification_uri_complete: result.verification_uri_complete,
      interval: result.interval,
      expires_in: result.expires_in,
    });
  } catch (error) {
    console.error("[KimiAuth] Device authorization error:", error);
    return authRouteErrorResponse("Failed to initiate device authorization");
  }
}
