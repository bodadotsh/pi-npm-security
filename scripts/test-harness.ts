/**
 * Standalone smoke test for extensions/socket-mcp.ts, run outside of pi itself.
 * Mocks the minimal ExtensionAPI/ExtensionContext surface the extension touches.
 *
 * Usage: npx tsx scripts/test-harness.ts
 */
import extensionFactory from "../extensions/socket-mcp.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<void> | void;

const handlers: Record<string, Handler> = {};
const tools: any[] = [];

const fakePi: any = {
	on(event: string, handler: Handler) {
		handlers[event] = handler;
	},
	registerTool(tool: any) {
		tools.push(tool);
		console.log("registered tool:", tool.name, "-", tool.description);
	},
	registerCommand() {},
	registerFlag() {},
	registerShortcut() {},
};

await extensionFactory(fakePi);

const fakeCtx: any = {
	ui: {
		theme: { fg: (_c: string, t: string) => t },
		setStatus: (k: string, v: unknown) => console.log("[status]", k, v),
		notify: (msg: string, level: string) => console.log(`[notify:${level}]`, msg),
	},
};

console.log("--- triggering session_start (spawns Socket MCP subprocess) ---");
await handlers.session_start({}, fakeCtx);

console.log(
	"--- tools registered:",
	tools.map((t) => t.name),
);

const depscore = tools.find((t) => t.name === "socket_depscore");
if (depscore) {
	console.log("--- calling socket_depscore for express@4.18.2 ---");
	const result = await depscore.execute(
		"test-call-1",
		{ packages: [{ ecosystem: "npm", depname: "express", version: "4.18.2" }] },
		undefined,
		undefined,
		fakeCtx,
	);
	console.log(JSON.stringify(result, null, 2));
}

console.log("--- triggering session_shutdown ---");
await handlers.session_shutdown({}, fakeCtx);

process.exit(0);
