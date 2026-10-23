import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
let app: App | undefined;
let ready: Promise<void>;
const embedded = window.parent !== window;
const unpack = (result: any) => {
  if (result.isError)
    throw new Error(
      result.content?.find((c: any) => c.type === "text")?.text ||
        "Factory request failed.",
    );
  return (
    result.structuredContent ??
    JSON.parse(result.content.find((c: any) => c.type === "text").text)
  );
};
export function connect(
  onData: (value: any) => void,
  onError: (message: string) => void,
) {
  if (embedded) {
    app = new App(
      { name: "Iron Legion Factory", version: "1.0.0" },
      { availableDisplayModes: ["inline", "fullscreen"] },
    );
    app.ontoolresult = (result) => {
      try {
        const value = unpack(result);
        if (value.releases) onData(value);
      } catch (e) {
        onError(String(e));
      }
    };
    app.onhostcontextchanged = (context) => {
      if (context.theme) {
        applyDocumentTheme(context.theme);
        document.documentElement.dataset.theme = context.theme;
      }
      if (context.styles?.variables)
        applyHostStyleVariables(context.styles.variables);
      if (context.safeAreaInsets)
        document.body.style.padding = `${context.safeAreaInsets.top}px ${context.safeAreaInsets.right}px ${context.safeAreaInsets.bottom}px ${context.safeAreaInsets.left}px`;
    };
    app.onteardown = async () => {
      window.dispatchEvent(new Event("factory-teardown"));
      return {};
    };
    ready = app.connect().then(() => {
      const theme = app?.getHostContext()?.theme;
      if (theme) document.documentElement.dataset.theme = theme;
    });
  } else {
    ready = (async () => {
      const token = new URLSearchParams(location.hash.slice(1)).get("session");
      if (token) {
        history.replaceState(null, "", location.pathname);
        await request("/api/session", {
          method: "POST",
          body: JSON.stringify({ token }),
        });
      }
    })();
  }
  ready.catch((e) => onError(e instanceof Error ? e.message : String(e)));
}
async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    credentials: "same-origin",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}
export async function snapshot(releaseId?: string) {
  await ready;
  if (app)
    return unpack(
      await app.callServerTool({
        name: "factory__open",
        arguments: { ...(releaseId ? { releaseId } : {}) },
      }),
    );
  return request(
    `/api/snapshot${releaseId ? `?release=${encodeURIComponent(releaseId)}` : ""}`,
  );
}
export async function control(command: any) {
  await ready;
  if (app)
    return unpack(
      await app.callServerTool({
        name: "factory__control",
        arguments: { command },
      }),
    );
  return request("/api/control", {
    method: "POST",
    body: JSON.stringify(command),
  });
}
export async function artifact(id: string) {
  await ready;
  if (app)
    return unpack(
      await app.callServerTool({
        name: "factory__control",
        arguments: { command: { action: "read_artifact", artifactId: id } },
      }),
    ).result;
  return request(`/api/artifact?id=${encodeURIComponent(id)}`);
}
export async function fullscreen() {
  if (!app) {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
    return;
  }
  if (app.getHostContext()?.availableDisplayModes?.includes("fullscreen")) {
    try {
      const result = await app.requestDisplayMode({
        mode:
          app.getHostContext()?.displayMode === "fullscreen"
            ? "inline"
            : "fullscreen",
      });
      if (result.mode === "fullscreen") return;
    } catch {}
  }
  const data = unpack(
    await app.callServerTool({
      name: "factory__open",
      arguments: { popout: true },
    }),
  );
  const url = data.standaloneUrl;
  if (!url) throw new Error("Could not create a dashboard link.");
  if (app.getHostCapabilities()?.openLinks) {
    try {
      const result = await app.openLink({ url });
      if (!result.isError) return;
    } catch {}
  }
  return url as string;
}
