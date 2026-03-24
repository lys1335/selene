import { saveBase64Video } from "@/lib/storage/local-storage";
import { loadSettings } from "@/lib/settings/settings-manager";

// Runway API configuration
// Docs: https://docs.dev.runwayml.com/
const BASE_URL = "https://api.dev.runwayml.com/v1";
const API_VERSION = "2024-11-06";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_TIME_MS = 300_000; // 5 minutes

const getApiSecret = () => {
  // Settings take priority, env var as fallback
  const settings = loadSettings();
  return settings.runwayApiSecret || process.env.RUNWAYML_API_SECRET;
};

export interface RunwayVideoInput {
  prompt: string;
  image_url?: string;
  model?: "gen4.5" | "gen4_turbo" | "gen3a_turbo";
  duration?: number;    // 2-10
  ratio?: "1280:720" | "720:1280" | "1104:832" | "960:960" | "832:1104" | "1584:672";
  seed?: number;
}

interface RunwayTaskResponse {
  id: string;
  status: "PENDING" | "THROTTLED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  output?: string[];
  failure?: string;
  failureCode?: string;
  progress?: number;
  createdAt?: string;
}

export interface RunwayVideoSyncResult {
  videos: Array<{
    url: string;
    localPath?: string;
    filePath?: string;
    width?: number;
    height?: number;
    format: string;
    fps: number;
    duration: number;
  }>;
  timeTaken: number;
  metadata?: {
    taskId?: string;
    model?: string;
  };
}

function getHeaders(): Record<string, string> {
  const apiSecret = getApiSecret();
  if (!apiSecret) {
    throw new Error("Runway API secret is not configured (set in Settings or RUNWAYML_API_SECRET env var)");
  }
  return {
    "Authorization": `Bearer ${apiSecret}`,
    "Content-Type": "application/json",
    "X-Runway-Version": API_VERSION,
  };
}

/**
 * Parse aspect ratio string into width/height pixels.
 * Runway ratios use pixel values like "1280:720".
 */
function parseRatioDimensions(ratio: string): { width: number; height: number } {
  const parts = ratio.split(":");
  if (parts.length === 2) {
    const w = parseInt(parts[0], 10);
    const h = parseInt(parts[1], 10);
    if (!isNaN(w) && !isNaN(h)) return { width: w, height: h };
  }
  return { width: 1280, height: 720 };
}

/**
 * Convert a local /api/media/ path or remote URL into a suitable image URL
 * for the Runway API. Runway accepts HTTPS URLs or data URIs.
 */
async function resolveImageUrl(imageUrl: string): Promise<string> {
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    return imageUrl;
  }

  if (imageUrl.startsWith("data:")) {
    return imageUrl;
  }

  // Local media path — read file and convert to data URI
  if (imageUrl.startsWith("/api/media/") || imageUrl.startsWith("local-media://")) {
    const { readLocalFile, fileExists } = await import("@/lib/storage/local-storage");
    let relativePath = imageUrl;
    if (imageUrl.startsWith("/api/media/")) {
      relativePath = imageUrl.replace("/api/media/", "");
    } else if (imageUrl.startsWith("local-media://")) {
      relativePath = imageUrl.replace("local-media://", "").replace(/^\/+/, "");
    }

    if (!fileExists(relativePath)) {
      throw new Error(`Local image file not found: ${relativePath}`);
    }

    const buffer = readLocalFile(relativePath);
    const ext = relativePath.split(".").pop()?.toLowerCase() ?? "png";
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
    return `data:${mime};base64,${buffer.toString("base64")}`;
  }

  throw new Error(`Unsupported image URL format: ${imageUrl}`);
}

/**
 * Submit a video generation job to Runway and poll until completion.
 * Returns a normalized result with locally-stored video assets.
 */
export async function callRunwayVideo(
  input: RunwayVideoInput,
  sessionId: string
): Promise<RunwayVideoSyncResult> {
  const headers = getHeaders();
  const hasImage = !!input.image_url;
  // gen4_turbo/gen3a_turbo are image-to-video only; gen4.5 supports both
  const model = input.model ?? (hasImage ? "gen4_turbo" : "gen4.5");
  const duration = input.duration ?? 5;
  const ratio = input.ratio ?? "1280:720";

  const startTime = Date.now();

  // Determine endpoint
  const endpoint = hasImage ? `${BASE_URL}/image_to_video` : `${BASE_URL}/text_to_video`;

  const body: Record<string, unknown> = {
    model,
    promptText: input.prompt,
    ratio,
    duration,
  };

  if (input.seed !== undefined) {
    body.seed = input.seed;
  }

  if (hasImage) {
    body.promptImage = await resolveImageUrl(input.image_url!);
  }

  // Submit job
  console.log(`[Runway Video] Submitting ${hasImage ? "image-to-video" : "text-to-video"} job (model=${model}, duration=${duration}s, ratio=${ratio})`);
  const submitResponse = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    if (submitResponse.status === 401) {
      throw new Error("Runway API authentication failed: Invalid API secret");
    } else if (submitResponse.status === 429) {
      const retryAfter = submitResponse.headers.get("Retry-After");
      throw new Error(`Runway API rate limited. ${retryAfter ? `Retry after ${retryAfter}s` : "Please try again later."}`);
    } else {
      throw new Error(`Runway API error: ${submitResponse.status} - ${errorText}`);
    }
  }

  const submitData = await submitResponse.json();
  const taskId: string = submitData.id;
  console.log(`[Runway Video] Job submitted: taskId=${taskId}`);

  // Poll for completion
  const pollUrl = `${BASE_URL}/tasks/${taskId}`;
  let taskResult: RunwayTaskResponse | null = null;
  const pollStart = Date.now();

  while (Date.now() - pollStart < MAX_POLL_TIME_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const pollResponse = await fetch(pollUrl, {
      method: "GET",
      headers,
    });

    if (!pollResponse.ok) {
      const errText = await pollResponse.text();
      // 429 during polling — back off and retry
      if (pollResponse.status === 429) {
        const retryAfter = parseInt(pollResponse.headers.get("Retry-After") ?? "10", 10);
        console.log(`[Runway Video] Rate limited during poll, waiting ${retryAfter}s`);
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        continue;
      }
      throw new Error(`Runway API poll error: ${pollResponse.status} - ${errText}`);
    }

    const task: RunwayTaskResponse = await pollResponse.json();
    console.log(`[Runway Video] Task status: ${task.status}${task.progress != null ? ` (${Math.round(task.progress * 100)}%)` : ""}`);

    if (task.status === "SUCCEEDED") {
      taskResult = task;
      break;
    } else if (task.status === "FAILED") {
      throw new Error(`Runway video generation failed: ${task.failure ?? "Unknown error"} (code: ${task.failureCode ?? "N/A"})`);
    } else if (task.status === "CANCELLED") {
      throw new Error("Runway video generation was cancelled");
    }
    // PENDING, THROTTLED, RUNNING → keep polling
  }

  if (!taskResult) {
    throw new Error(`Runway video generation timed out after ${MAX_POLL_TIME_MS / 1000}s`);
  }

  // Download output videos and store locally
  const outputUrls = taskResult.output ?? [];
  if (outputUrls.length === 0) {
    throw new Error("Runway returned no output videos");
  }

  const { width, height } = parseRatioDimensions(ratio);
  const videos: RunwayVideoSyncResult["videos"] = [];

  for (const outputUrl of outputUrls) {
    // Download the video from provider URL (these expire)
    const videoResponse = await fetch(outputUrl);
    if (!videoResponse.ok) {
      throw new Error(`Failed to download Runway video output: ${videoResponse.status}`);
    }
    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
    const base64Video = videoBuffer.toString("base64");

    const uploadResult = await saveBase64Video(base64Video, sessionId, "generated", "mp4");

    videos.push({
      url: uploadResult.url,
      localPath: uploadResult.localPath,
      filePath: uploadResult.filePath,
      width,
      height,
      format: "mp4",
      fps: 24, // Runway default output fps
      duration,
    });
  }

  const timeTaken = Date.now() - startTime;
  console.log(`[Runway Video] Completed in ${(timeTaken / 1000).toFixed(1)}s — ${videos.length} video(s)`);

  return {
    videos,
    timeTaken,
    metadata: {
      taskId,
      model,
    },
  };
}
