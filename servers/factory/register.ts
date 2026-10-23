import { readFile } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import type { FactoryService } from "./service.js";
import { clean } from "./service.js";
import type { Dashboard } from "./http.js";
import { actionSchema } from "./contracts.js";
import { appHtmlPath } from "./paths.js";
export const RESOURCE_URI = "ui://iron-legion/factory.html";
export function registerFactory(
  server: McpServer,
  service: FactoryService,
  dashboard: Dashboard,
) {
  const result = (data: any) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data,
  });
  registerAppTool(
    server,
    "factory__open",
    {
      title: "Iron Legion Factory",
      description:
        "Open the software factory control center, inspect release progress or retrieve an evidence artifact.",
      inputSchema: {
        releaseId: z.string().uuid().optional(),
        artifactId: z.string().uuid().optional(),
        popout: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { resourceUri: RESOURCE_URI, visibility: ["model", "app"] },
      },
    },
    async (input) => {
      try {
        if (input.artifactId)
          return result(service.store.publicArtifact(input.artifactId));
        const snapshot = service.snapshot(input.releaseId);
        return result({
          ...snapshot,
          ...(input.popout ? { standaloneUrl: dashboard.url() } : {}),
        });
      } catch (e) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: clean(e instanceof Error ? e.message : String(e)),
            },
          ],
        };
      }
    },
  );
  registerAppTool(
    server,
    "factory__control",
    {
      title: "Control factory",
      description:
        "Submit a validated factory action from the control center. Human decisions and merge actions belong to the interactive App.",
      inputSchema: { command: actionSchema },
      _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    },
    async ({ command }) => {
      try {
        return result({ result: await service.control(command) });
      } catch (e) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: clean(e instanceof Error ? e.message : String(e)),
            },
          ],
        };
      }
    },
  );
  registerAppResource(
    server,
    "Iron Legion Factory",
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [
        {
          uri: RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await readFile(appHtmlPath, "utf8"),
          _meta: {
            ui: {
              prefersBorder: false,
              csp: { connectDomains: [], resourceDomains: [] },
            },
          },
        },
      ],
    }),
  );
}
