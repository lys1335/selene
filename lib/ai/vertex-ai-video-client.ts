import { saveBase64Video } from "@/lib/storage/local-storage";
import { loadSettings } from "@/lib/settings/settings-manager";

// Vertex AI Veo configuration
// Docs: https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/veo-video-generation
const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_TIME_MS = 600_000; // 10 minutes (Veo can be slow)

const getProjectId = () => {
  const settings = loadSettings();
  return settings.vertexAIProjectId || process.env.VERTEX_AI_PROJECT_ID;
};
const getLocation = () => {
  const settings = loadSettings();
  return settings.vertexAILocation || process.env.VERTEX_AI_LOCATION || "us-central1";
};

interface VertexAIVideoInput {
  prompt: string;
  image_url?: string;
  model?: string;
  duration_seconds?: number;     // Veo 2: 5-8, Veo 3: 4/6/8
  aspect_ratio?: "16:9" | "9:16";
  resolution?: "720p" | "1080p";
  negative_prompt?: string;
  seed?: number;
  generate_audio?: boolean;
  sample_count?: number;         // 1-4
}

interface VertexAIVideoSyncResult {
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
    operationName?: string;
    model?: string;
    raiFilteredCount?: number;
  };
}

/**
 * Get a Google Cloud access token using Application Default Credentials.
 * Uses google-auth-library if available, falls back to gcloud CLI.
 * GOOGLE_APPLICATION_CREDENTIALS is set by updateEnvFromSettings() at startup.
 */
async function getAccessToken(): Promise<string> {
  // Try google-auth-library first
  try {
    const { GoogleAuth } = await import("google-auth-library");
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    if (tokenResponse.token) {
      return tokenResponse.token;
    }
  } catch {
    // google-auth-library not available or failed, try gcloud CLI
  }

  // Fallback: use gcloud CLI
  try {
    const { execSync } = await import("child_process");
    const token = execSync("gcloud auth print-access-token", {
      encoding: "utf-8",
      timeout: 10_000,
    }).trim();
    if (token) return token;
  } catch {
    // gcloud CLI not available
  }

  throw new Error(
    "Could not obtain Google Cloud access token. " +
    "Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON file, " +
    "or ensure gcloud CLI is installed and authenticated."
  );
}

/**
 * Get video dimensions from aspect ratio and resolution.
 */
function getDimensions(
  aspectRatio: string,
  resolution: string
): { width: number; height: number } {
  if (resolution === "1080p") {
    return aspectRatio === "9:16"
      ? { width: 1080, height: 1920 }
      : { width: 1920, height: 1080 };
  }
  // 720p default
  return aspectRatio === "9:16"
    ? { width: 720, height: 1280 }
    : { width: 1280, height: 720 };
}

/**
 * Convert a local /api/media/ path or remote URL into base64 for the Vertex AI API.
 * Vertex AI expects base64-encoded images in the request body.
 */
async function resolveImageToBase64(
  imageUrl: string
): Promise<{ bytesBase64Encoded: string; mimeType: string }> {
  let buffer: Buffer;
  let mimeType = "image/png";

  if (imageUrl.startsWith("data:")) {
    const match = imageUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) {
      mimeType = match[1];
      buffer = Buffer.from(match[2], "base64");
    } else {
      throw new Error("Invalid data URI format");
    }
  } else if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
    buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("jpeg") || contentType?.includes("jpg")) {
      mimeType = "image/jpeg";
    }
  } else if (imageUrl.startsWith("/api/media/") || imageUrl.startsWith("local-media://")) {
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

    buffer = readLocalFile(relativePath);
    const ext = relativePath.split(".").pop()?.toLowerCase();
    if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
  } else {
    throw new Error(`Unsupported image URL format: ${imageUrl}`);
  }

  return {
    bytesBase64Encoded: buffer.toString("base64"),
    mimeType,
  };
}

/**
 * Submit a video generation job to Vertex AI Veo and poll until completion.
 * Returns a normalized result with locally-stored video assets.
 */
export async function callVertexAIVideo(
  input: VertexAIVideoInput,
  sessionId: string
): Promise<VertexAIVideoSyncResult> {
  const projectId = getProjectId();
  if (!projectId) {
    throw new Error("VERTEX_AI_PROJECT_ID environment variable is not configured");
  }

  const location = getLocation();
  const model = input.model ?? "veo-3.0-generate-001";
  const durationSeconds = input.duration_seconds ?? 8;
  const aspectRatio = input.aspect_ratio ?? "16:9";
  const resolution = input.resolution ?? "720p";

  const startTime = Date.now();
  const accessToken = await getAccessToken();

  const baseUrl = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}`;

  // Build request body
  const instance: Record<string, unknown> = {
    prompt: input.prompt,
  };

  // Image-to-video: add image to instance
  if (input.image_url) {
    const imageData = await resolveImageToBase64(input.image_url);
    instance.image = {
      bytesBase64Encoded: imageData.bytesBase64Encoded,
      mimeType: imageData.mimeType,
    };
  }

  const parameters: Record<string, unknown> = {
    aspectRatio,
    durationSeconds,
    resolution,
    sampleCount: input.sample_count ?? 1,
  };

  // Don't include storageUri — we want base64 bytes returned directly
  // so we don't need GCS bucket access

  if (input.negative_prompt) {
    parameters.negativePrompt = input.negative_prompt;
  }
  if (input.seed !== undefined) {
    parameters.seed = input.seed;
  }
  if (input.generate_audio !== undefined) {
    parameters.generateAudio = input.generate_audio;
  }

  // Veo 2 only: prompt enhancement
  if (model.includes("veo-2")) {
    parameters.enhancePrompt = true;
  }

  const requestBody = {
    instances: [instance],
    parameters,
  };

  // Submit long-running operation
  console.log(`[Vertex AI Veo] Submitting ${input.image_url ? "image-to-video" : "text-to-video"} job (model=${model}, duration=${durationSeconds}s, ratio=${aspectRatio}, resolution=${resolution})`);

  const submitResponse = await fetch(`${baseUrl}:predictLongRunning`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    if (submitResponse.status === 401 || submitResponse.status === 403) {
      throw new Error(`Vertex AI authentication failed: ${errorText}`);
    } else if (submitResponse.status === 429) {
      throw new Error("Vertex AI rate limited. Please try again later.");
    } else {
      throw new Error(`Vertex AI API error: ${submitResponse.status} - ${errorText}`);
    }
  }

  const submitData = await submitResponse.json();
  const operationName: string = submitData.name;
  if (!operationName) {
    throw new Error(`Vertex AI returned unexpected response: missing operation name`);
  }
  console.log(`[Vertex AI Veo] Operation submitted: ${operationName}`);

  // Poll for completion
  let result: Record<string, unknown> | null = null;
  const pollStart = Date.now();

  while (Date.now() - pollStart < MAX_POLL_TIME_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const pollResponse = await fetch(`${baseUrl}:fetchPredictOperation`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ operationName }),
    });

    if (!pollResponse.ok) {
      const errText = await pollResponse.text();
      if (pollResponse.status === 429) {
        console.log("[Vertex AI Veo] Rate limited during poll, waiting 15s");
        await new Promise((resolve) => setTimeout(resolve, 15_000));
        continue;
      }
      throw new Error(`Vertex AI poll error: ${pollResponse.status} - ${errText}`);
    }

    const operation = await pollResponse.json();
    console.log(`[Vertex AI Veo] Operation done=${operation.done ?? false}`);

    if (operation.done === true) {
      if (operation.error) {
        throw new Error(`Vertex AI video generation failed: ${JSON.stringify(operation.error)}`);
      }
      result = operation.response;
      break;
    }
  }

  if (!result) {
    throw new Error(`Vertex AI video generation timed out after ${MAX_POLL_TIME_MS / 1000}s`);
  }

  // Extract videos from response
  const responseVideos = (result as Record<string, unknown>).videos as Array<Record<string, string>> | undefined;
  const raiFilteredCount = (result as Record<string, unknown>).raiMediaFilteredCount as number | undefined;

  if (!responseVideos || responseVideos.length === 0) {
    if (raiFilteredCount && raiFilteredCount > 0) {
      throw new Error(`Vertex AI filtered all ${raiFilteredCount} video(s) due to safety policies`);
    }
    throw new Error("Vertex AI returned no output videos");
  }

  const { width, height } = getDimensions(aspectRatio, resolution);
  const videos: VertexAIVideoSyncResult["videos"] = [];

  for (const video of responseVideos) {
    let uploadResult;

    if (video.bytesBase64Encoded) {
      // Base64 response (no storageUri was provided)
      uploadResult = await saveBase64Video(video.bytesBase64Encoded, sessionId, "generated", "mp4");
    } else if (video.gcsUri) {
      // GCS URI — download via authenticated request
      // Convert gs://bucket/path to https://storage.googleapis.com/bucket/path
      const gcsUrl = video.gcsUri.replace("gs://", "https://storage.googleapis.com/");
      const videoResponse = await fetch(gcsUrl, {
        headers: { "Authorization": `Bearer ${accessToken}` },
      });
      if (!videoResponse.ok) {
        throw new Error(`Failed to download video from GCS: ${videoResponse.status}`);
      }
      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
      uploadResult = await saveBase64Video(videoBuffer.toString("base64"), sessionId, "generated", "mp4");
    } else {
      console.warn("[Vertex AI Veo] Video entry has neither bytesBase64Encoded nor gcsUri, skipping");
      continue;
    }

    videos.push({
      url: uploadResult.url,
      localPath: uploadResult.localPath,
      filePath: uploadResult.filePath,
      width,
      height,
      format: "mp4",
      fps: 24,
      duration: durationSeconds,
    });
  }

  if (videos.length === 0) {
    throw new Error("Failed to store any Vertex AI video outputs");
  }

  const timeTaken = Date.now() - startTime;
  console.log(`[Vertex AI Veo] Completed in ${(timeTaken / 1000).toFixed(1)}s — ${videos.length} video(s)${raiFilteredCount ? `, ${raiFilteredCount} filtered` : ""}`);

  return {
    videos,
    timeTaken,
    metadata: {
      operationName,
      model,
      raiFilteredCount: raiFilteredCount ?? 0,
    },
  };
}
