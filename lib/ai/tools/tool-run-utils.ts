import { updateToolRun, createImage } from "@/lib/db/queries";

/**
 * Returns the current time as an ISO string — used for SQLite timestamp fields.
 */
export const now = (): string => new Date().toISOString();

/**
 * Mark a tool run as failed and return the standard error response object.
 * Extracts the error message from any thrown value.
 */
export async function failToolRun(
  toolRunId: string,
  error: unknown
): Promise<{ status: "error"; error: string }> {
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  await updateToolRun(toolRunId, {
    status: "failed",
    error: errorMessage,
    completedAt: now(),
  });
  return { status: "error", error: errorMessage };
}

interface GeneratedVideoItem {
  url: string;
  localPath?: string;
  format: string;
  fps: number;
  duration: number;
}

interface VideoSyncResult {
  videos: GeneratedVideoItem[];
  timeTaken: number;
}

/**
 * Persist each generated video to the images table, mark the tool run as
 * succeeded, and return the standard "completed" response object.
 *
 * @param sessionId   - Active session ID
 * @param toolRunId   - ID of the already-created tool run record
 * @param result      - The sync result returned by the video generation client
 * @param prompt      - The prompt used for generation (stored in metadata)
 * @param extraMeta   - Any additional metadata fields (provider, model, toolType, …)
 */
export async function saveGeneratedVideos(
  sessionId: string,
  toolRunId: string,
  result: VideoSyncResult,
  prompt: string,
  extraMeta?: Record<string, unknown>
): Promise<{ status: "completed"; videos: GeneratedVideoItem[]; timeTaken: number }> {
  for (const video of result.videos) {
    await createImage({
      sessionId,
      toolRunId,
      role: "generated",
      localPath: video.localPath || video.url,
      url: video.url,
      format: video.format,
      metadata: {
        prompt,
        fps: video.fps,
        duration: video.duration,
        mediaType: "video",
        ...extraMeta,
      },
    });
  }

  await updateToolRun(toolRunId, {
    status: "succeeded",
    result: { videos: result.videos },
    completedAt: now(),
  });

  return {
    status: "completed",
    videos: result.videos,
    timeTaken: result.timeTaken,
  };
}
