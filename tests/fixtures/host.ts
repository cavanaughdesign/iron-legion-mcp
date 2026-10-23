import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
void (async () => {
  const frame = document.getElementById("app") as HTMLIFrameElement;
  const params = new URLSearchParams(location.search);
  const bridge = new AppBridge(
    null,
    { name: "Iron Legion QA host", version: "1.0.0" },
    { serverTools: {}, openLinks: {} },
    {
      hostContext: {
        theme: params.has("light") ? "light" : "dark",
        displayMode: "inline",
        availableDisplayModes: params.has("nofullscreen")
          ? ["inline"]
          : ["inline", "fullscreen"],
      },
    },
  );
  bridge.oncalltool = async (p) =>
    (await fetch("/tool", { method: "POST", body: JSON.stringify(p) })).json();
  bridge.onopenlink = async () => {
    if (params.has("linkerror")) throw new Error("Fixture host rejected link.");
    (window as any).openedLink = true;
    return {};
  };
  bridge.onrequestdisplaymode = async ({ mode }) => {
    const actual = params.has("rejectmode") ? "inline" : mode;
    (window as any).displayMode = actual;
    bridge.setHostContext({ displayMode: actual });
    return { mode: actual };
  };
  bridge.oninitialized = () => {
    (window as any).appInitialized = true;
  };
  await bridge.connect(
    new PostMessageTransport(frame.contentWindow!, frame.contentWindow!),
  );
  frame.src = "/app";
})();
