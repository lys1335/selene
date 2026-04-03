/**
 * Shared utilities for the WAN 2.2 API clients (imagen + video).
 */

export interface Wan22AsyncResult {
  jobId: string;
  status: string;
  statusUrl: string;
  modelName?: string;
  createdAt?: string;
}

/**
 * Parse a WAN 2.2 API error response, throwing a descriptive error.
 *
 * @param response - The failed fetch Response (response.ok === false)
 * @param apiName  - Human-readable API name, e.g. "WAN 2.2 Imagen API"
 */
export async function throwWan22ApiError(
  response: Response,
  apiName: string
): Promise<never> {
  const errorText = await response.text();

  if (response.status === 401) {
    throw new Error(`${apiName} authentication failed: Invalid API key`);
  } else if (response.status === 422) {
    throw new Error(`${apiName} validation error: ${errorText}`);
  } else if (response.status === 503) {
    throw new Error(`${apiName} is temporarily unavailable. Please try again later.`);
  } else {
    throw new Error(`${apiName} error: ${response.status} - ${errorText}`);
  }
}

/**
 * Extract the standard async job fields from a WAN 2.2 API response body.
 */
export function parseWan22AsyncResult(data: Record<string, unknown>): Wan22AsyncResult {
  return {
    jobId: data.job_id as string,
    status: data.status as string,
    statusUrl: data.status_url as string,
    modelName: data.model_name as string | undefined,
    createdAt: data.created_at as string | undefined,
  };
}
