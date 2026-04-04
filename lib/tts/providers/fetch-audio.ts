// fallow-ignore-file unused-file
/**
 * Shared HTTP fetch helper for TTS providers.
 *
 * Sends a POST request, checks for HTTP errors, and returns the response
 * body as a Buffer ready for TTSResult.audio.
 */
export async function fetchAudioBuffer(
  url: string,
  options: RequestInit,
  providerLabel: string
): Promise<Buffer> {
  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${providerLabel} API error ${response.status}: ${errorText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}
