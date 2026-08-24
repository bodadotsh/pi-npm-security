/**
 * Socket MCP Bridge Extension
 *
 * Bridges the Socket MCP server (https://github.com/SocketDev/socket-mcp) into pi
 * as native tools. Pi has no built-in MCP client, so this extension spawns the
 * Socket MCP server as a local stdio subprocess using the official
 * @modelcontextprotocol/sdk client, discovers its tools at session start, and
 * registers one pi tool per MCP tool.
 *
 * Setup:
 *   1. `npm install` in this package directory (installs @modelcontextprotocol/sdk
 *      and @socketsecurity/mcp).
 *   2. Create a Socket API token with the `packages:list` scope:
 *      https://docs.socket.dev/reference/creating-and-managing-api-tokens
 *   3. `export SOCKET_API_TOKEN="sktsec_..."` before launching pi. The self-hosted
 *      stdio server requires a token to start at all (confirmed against the real
 *      package: it exits immediately without one). Once running, `socket_depscore`
 *      works for any authenticated token; org-scoped tools (`socket_organizations`,
 *      `socket_alerts`, `socket_threat_feed`, `socket_package_files`) need a token
 *      with the right org permissions and return an auth error otherwise.
 *
 * Commands:
 *   /socket-mcp-status      Show connection state and registered tools
 *   /socket-mcp-reconnect   Restart the Socket MCP subprocess
 *
 * Configuration (env vars):
 *   SOCKET_API_TOKEN   Socket API token (aliases SOCKET_API_KEY etc. also honored
 *                      by the server itself; see socket-mcp docs)
 *   SOCKET_MCP_COMMAND Override the command used to launch the server
 *                      (default: "npx")
 *   SOCKET_MCP_ARGS    Space-separated args for SOCKET_MCP_COMMAND
 *                      (default: "-y @socketsecurity/mcp@latest")
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Type } from "typebox";

const TOOL_PREFIX = "socket_";
const STATUS_KEY = "socket-mcp";

interface McpToolInfo {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
}

type ToolContentItem = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

/** Map arbitrary MCP content blocks to the (TextContent | ImageContent)[] shape pi tools expect. */
function toPiContent(items: unknown[]): ToolContentItem[] {
	if (!Array.isArray(items) || items.length === 0) {
		return [{ type: "text", text: "(empty result)" }];
	}
	return items.map((raw): ToolContentItem => {
		const item = raw as { type?: string; text?: string; data?: string; mimeType?: string };
		if (item?.type === "text" && typeof item.text === "string") {
			return { type: "text", text: item.text };
		}
		if (item?.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string") {
			return { type: "image", data: item.data, mimeType: item.mimeType };
		}
		// Fallback for resource/audio/resource_link/unknown block types: surface as JSON text.
		return { type: "text", text: JSON.stringify(raw) };
	});
}

function getServerCommand(): { command: string; args: string[] } {
	const command = process.env.SOCKET_MCP_COMMAND?.trim() || "npx";
	const args = process.env.SOCKET_MCP_ARGS?.trim()
		? process.env.SOCKET_MCP_ARGS.trim().split(/\s+/)
		: ["-y", "@socketsecurity/mcp@latest"];
	return { command, args };
}

function getSocketToken(): string | undefined {
	return (
		process.env.SOCKET_API_TOKEN ??
		process.env.SOCKET_API_KEY ??
		process.env.SOCKET_CLI_API_TOKEN ??
		process.env.SOCKET_CLI_API_KEY ??
		process.env.SOCKET_SECURITY_API_TOKEN ??
		process.env.SOCKET_SECURITY_API_KEY
	);
}

export default function (pi: ExtensionAPI) {
	let client: Client | undefined;
	let transport: StdioClientTransport | undefined;
	let connectPromise: Promise<void> | undefined;
	const registeredTools = new Set<string>();

	function registerMcpTool(tool: McpToolInfo) {
		const toolName = `${TOOL_PREFIX}${tool.name}`;
		if (registeredTools.has(toolName)) return;
		registeredTools.add(toolName);

		pi.registerTool({
			name: toolName,
			label: `Socket: ${tool.name}`,
			description: tool.description?.trim() || `Socket MCP tool: ${tool.name}`,
			promptSnippet: `Query Socket.dev supply-chain security data via ${tool.name}`,
			// MCP tools ship plain JSON Schema; pass it through as-is instead of
			// hand-porting each schema to TypeBox.
			parameters: Type.Unsafe<Record<string, unknown>>(tool.inputSchema ?? { type: "object", properties: {} }),
			async execute(_toolCallId, params, signal) {
				if (!client) {
					throw new Error("Socket MCP server is not connected. Run /socket-mcp-reconnect.");
				}
				const result = await client.callTool(
					{ name: tool.name, arguments: params as Record<string, unknown> },
					undefined,
					{ signal },
				);

				const content = toPiContent((result.content as unknown[]) ?? []);
				if (result.isError) {
					const message = content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
					throw new Error(message || `${tool.name} failed`);
				}

				return { content, details: { raw: result } };
			},
		});
	}

	async function connect(ctx?: ExtensionContext): Promise<void> {
		if (client) return;
		if (connectPromise) return connectPromise;

		connectPromise = (async () => {
			const { command, args } = getServerCommand();
			const token = getSocketToken();

			if (!token) {
				ctx?.ui.notify(
					"Socket MCP: SOCKET_API_TOKEN is not set. The self-hosted stdio server requires a token to start " +
						"(create one with the packages:list scope at https://docs.socket.dev/reference/creating-and-managing-api-tokens). " +
						"Connection will likely fail until it is exported.",
					"warning",
				);
			}

			ctx?.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", "Socket MCP: connecting..."));

			const nextTransport = new StdioClientTransport({
				command,
				args,
				env: {
					...(process.env as Record<string, string>),
					...(token ? { SOCKET_API_TOKEN: token } : {}),
				},
			});

			const nextClient = new Client({ name: "pi-npm-security", version: "0.1.0" }, { capabilities: {} });

			try {
				await nextClient.connect(nextTransport);
			} catch (err) {
				transport = undefined;
				ctx?.ui.setStatus(STATUS_KEY, undefined);
				ctx?.ui.notify(`Socket MCP: failed to connect (${(err as Error).message})`, "error");
				throw err;
			}

			transport = nextTransport;
			client = nextClient;

			const { tools } = await client.listTools();
			for (const tool of tools as McpToolInfo[]) {
				registerMcpTool(tool);
			}

			ctx?.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("success", `Socket MCP: ${registeredTools.size} tools`));
		})();

		try {
			await connectPromise;
		} finally {
			connectPromise = undefined;
		}
	}

	async function disconnect(): Promise<void> {
		registeredTools.clear();
		const closingClient = client;
		client = undefined;
		transport = undefined;
		try {
			await closingClient?.close();
		} catch {
			// Best-effort cleanup; the subprocess may already be gone.
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		try {
			await connect(ctx);
		} catch {
			// Error already surfaced via ctx.ui.notify in connect().
		}
	});

	pi.on("session_shutdown", async () => {
		await disconnect();
	});

	pi.registerCommand("socket-mcp-status", {
		description: "Show Socket MCP connection status and registered tools",
		handler: async (_args, ctx) => {
			if (!client) {
				ctx.ui.notify("Socket MCP: not connected", "warning");
				return;
			}
			const tokenState = getSocketToken() ? "token set" : "no token";
			ctx.ui.notify(
				`Socket MCP: connected (${tokenState}). Tools: ${[...registeredTools].join(", ") || "none"}`,
				"info",
			);
		},
	});

	pi.registerCommand("socket-mcp-reconnect", {
		description: "Restart the Socket MCP subprocess and re-register its tools",
		handler: async (_args, ctx) => {
			await disconnect();
			try {
				await connect(ctx);
				ctx.ui.notify("Socket MCP: reconnected", "info");
			} catch {
				// Error already surfaced via ctx.ui.notify in connect().
			}
		},
	});
}
