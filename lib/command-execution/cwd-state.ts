import { getSession, updateSession } from "@/lib/db/queries";

const COMMAND_EXECUTION_METADATA_KEY = "commandExecution";
const CWD_METADATA_KEY = "cwd";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : {};
}

export async function getPersistedCommandCwd(sessionId: string): Promise<string | null> {
  if (!sessionId || sessionId === "UNSCOPED") {
    return null;
  }

  const session = await getSession(sessionId);
  if (!session?.metadata || typeof session.metadata !== "object") {
    return null;
  }

  const metadata = session.metadata as Record<string, unknown>;
  const commandExecution = metadata[COMMAND_EXECUTION_METADATA_KEY];
  if (!commandExecution || typeof commandExecution !== "object") {
    return null;
  }

  const cwd = (commandExecution as Record<string, unknown>)[CWD_METADATA_KEY];
  return typeof cwd === "string" && cwd.trim().length > 0 ? cwd : null;
}

export async function setPersistedCommandCwd(
  sessionId: string,
  cwd: string | null | undefined
): Promise<void> {
  if (!sessionId || sessionId === "UNSCOPED") {
    return;
  }

  const session = await getSession(sessionId);
  if (!session) {
    return;
  }

  const metadata = asObject(session.metadata);
  const commandExecution = asObject(metadata[COMMAND_EXECUTION_METADATA_KEY]);

  if (!cwd || cwd.trim().length === 0) {
    delete commandExecution[CWD_METADATA_KEY];
  } else {
    commandExecution[CWD_METADATA_KEY] = cwd;
  }

  metadata[COMMAND_EXECUTION_METADATA_KEY] = commandExecution;
  await updateSession(sessionId, { metadata });
}
