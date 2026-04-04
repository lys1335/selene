/**
 * Shared provider utilities used by multiple AI provider fetch wrappers.
 */

/**
 * Read a BodyInit value into a plain string regardless of its concrete type.
 */
export async function readRequestBody(body: BodyInit): Promise<string> {
  if (typeof body === "string") {
    return body;
  }

  if (body instanceof ArrayBuffer) {
    return new TextDecoder().decode(body);
  }

  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    return new TextDecoder().decode(
      view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
    );
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  if (typeof (body as Blob).text === "function") {
    return await (body as Blob).text();
  }

  throw new Error("Unsupported request body type");
}
