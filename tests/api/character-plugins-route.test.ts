import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(async () => "auth-user-1"),
}));

const settingsMocks = vi.hoisted(() => ({
  loadSettings: vi.fn(() => ({ localUserEmail: "local@example.com" })),
}));

const dbMocks = vi.hoisted(() => ({
  getOrCreateLocalUser: vi.fn(async () => ({ id: "user-1" })),
}));

const characterMocks = vi.hoisted(() => ({
  getCharacter: vi.fn(),
  updateCharacter: vi.fn(),
}));

const pluginRegistryMocks = vi.hoisted(() => ({
  getAvailablePluginsForAgent: vi.fn(),
  setPluginEnabledForAgent: vi.fn(),
}));

vi.mock("@/lib/db/sqlite-client", () => ({ db: {} }));
vi.mock("@/lib/auth/local-auth", () => authMocks);
vi.mock("@/lib/settings/settings-manager", () => settingsMocks);
vi.mock("@/lib/db/queries", () => dbMocks);
vi.mock("@/lib/characters/queries", () => characterMocks);
vi.mock("@/lib/plugins/registry", () => pluginRegistryMocks);

import { GET, POST } from "@/app/api/characters/[id]/plugins/route";

function createAssignment(pluginId: string, enabledForAgent: boolean, name = pluginId) {
  return {
    enabledForAgent,
    plugin: {
      id: pluginId,
      name,
      description: `${name} description`,
      version: "1.0.0",
      status: "active",
      components: {},
    },
  };
}

describe("/api/characters/[id]/plugins route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    characterMocks.getCharacter.mockResolvedValue({
      id: "character-1",
      userId: "user-1",
      metadata: {
        enabledPlugins: ["plugin-1"],
        purpose: "test agent",
      },
    });
    characterMocks.updateCharacter.mockResolvedValue({ id: "character-1" });
  });

  it("GET returns assignable plugins with no-store caching", async () => {
    pluginRegistryMocks.getAvailablePluginsForAgent.mockResolvedValue([
      createAssignment("plugin-1", true, "Plugin One"),
      createAssignment("plugin-2", false, "Plugin Two"),
    ]);

    const response = await GET(
      new Request("http://localhost/api/characters/character-1/plugins") as any,
      { params: Promise.resolve({ id: "character-1" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const payload = await response.json();
    expect(payload.plugins).toEqual([
      expect.objectContaining({ id: "plugin-1", enabledForAgent: true }),
      expect.objectContaining({ id: "plugin-2", enabledForAgent: false }),
    ]);
  });

  it("POST disables a plugin, persists refreshed enabledPlugins metadata, and returns refreshed assignments", async () => {
    pluginRegistryMocks.getAvailablePluginsForAgent
      .mockResolvedValueOnce([
        createAssignment("plugin-1", true, "Plugin One"),
        createAssignment("plugin-2", false, "Plugin Two"),
      ])
      .mockResolvedValueOnce([
        createAssignment("plugin-1", false, "Plugin One"),
        createAssignment("plugin-2", false, "Plugin Two"),
      ]);

    const response = await POST(
      new Request("http://localhost/api/characters/character-1/plugins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pluginId: "plugin-1", enabled: false }),
      }) as any,
      { params: Promise.resolve({ id: "character-1" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(pluginRegistryMocks.setPluginEnabledForAgent).toHaveBeenCalledWith(
      "character-1",
      "plugin-1",
      false
    );
    expect(characterMocks.updateCharacter).toHaveBeenCalledWith("character-1", {
      metadata: {
        enabledPlugins: [],
        purpose: "test agent",
      },
    });

    const payload = await response.json();
    expect(payload.enabledPluginIds).toEqual([]);
    expect(payload.plugins).toEqual([
      expect.objectContaining({ id: "plugin-1", enabledForAgent: false }),
      expect.objectContaining({ id: "plugin-2", enabledForAgent: false }),
    ]);
  });

  it("POST skips metadata writes when the refreshed enabled plugin ids already match", async () => {
    const charWithEmptyPlugins = {
      id: "character-1",
      userId: "user-1",
      metadata: {
        enabledPlugins: [],
        purpose: "test agent",
      },
    };
    // Called twice: once in requireCharacterAuth, once in the route handler
    characterMocks.getCharacter
      .mockResolvedValueOnce(charWithEmptyPlugins)
      .mockResolvedValueOnce(charWithEmptyPlugins);
    pluginRegistryMocks.getAvailablePluginsForAgent
      .mockResolvedValueOnce([createAssignment("plugin-1", false, "Plugin One")])
      .mockResolvedValueOnce([createAssignment("plugin-1", false, "Plugin One")]);

    const response = await POST(
      new Request("http://localhost/api/characters/character-1/plugins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pluginId: "plugin-1", enabled: false }),
      }) as any,
      { params: Promise.resolve({ id: "character-1" }) }
    );

    expect(response.status).toBe(200);
    expect(pluginRegistryMocks.setPluginEnabledForAgent).toHaveBeenCalledWith(
      "character-1",
      "plugin-1",
      false
    );
    expect(characterMocks.updateCharacter).not.toHaveBeenCalled();
  });
});
