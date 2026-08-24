# pi-npm-security

A [pi](https://github.com/earendil-works/pi-mono) package for npm / supply-chain
security workflows. It bundles multiple resources under one installable
package rather than a single extension:

- **Extension: Socket MCP bridge** (`extensions/socket-mcp.ts`) — bridges the
  [Socket MCP server](https://github.com/SocketDev/socket-mcp) into pi as
  native tools (dependency scoring, org alerts, threat feed, package file
  inspection).
- **Skill: npm security best practices** (`skills/npm-security/`) — guidance for
  the agent on secure package-manager defaults, scoring candidates via Socket
  MCP before adding deps, and scanning installs with Socket Firewall (`sfw`).
- More resources (prompts, additional extensions) can be added under their
  own conventional directories (`prompts/`, more files in `extensions/`) as
  the package grows.

## Structure

```
pi-npm-security/
  package.json          # pi package manifest (extensions + skills)
  extensions/
    socket-mcp.ts        # Socket MCP bridge extension
  skills/
    npm-security/
      SKILL.md           # npm security best-practices skill
  scripts/
    test-harness.ts      # standalone smoke test, no pi CLI required
```

`package.json` declares both directories in its `pi` manifest:

```json
"pi": {
  "extensions": ["./extensions"],
  "skills": ["./skills"]
}
```

Any `.ts`/`.js` file dropped into `extensions/` or `SKILL.md` folder dropped
into `skills/` is picked up automatically — no manifest changes needed.

## Socket MCP bridge extension

Pi has no built-in MCP client, so this extension spawns the Socket MCP server
(`@socketsecurity/mcp`) as a local stdio subprocess using the official
`@modelcontextprotocol/sdk` client, discovers its tools at session start, and
registers one pi tool per MCP tool: `socket_depscore`, `socket_organizations`,
`socket_alerts`, `socket_threat_feed`, `socket_package_files`,
`socket_package_file_contents`, `socket_package_file_grep`.

### Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a Socket API token with the `packages:list` scope. See
   [Creating and managing API tokens](https://docs.socket.dev/reference/creating-and-managing-api-tokens).

3. Export the token before launching pi. **The self-hosted stdio server
   requires a token to start at all** — this was confirmed against the real
   package, which exits immediately without one:

   ```bash
   export SOCKET_API_TOKEN="sktsec_..."
   ```

4. Try it out:

   ```bash
   pi -e ./extensions/socket-mcp.ts
   ```

   Or install the whole package (extension + skill together) as a
   project/user package so it loads automatically:

   ```bash
   pi install ./pi-npm-security      # or npm:pi-npm-security / git:... once published
   ```

### Commands

- `/socket-mcp-status` — show connection state and registered tools.
- `/socket-mcp-reconnect` — restart the Socket MCP subprocess and re-register
  its tools (useful after rotating the token).

### Configuration (env vars)

| Variable             | Default                            | Description                                                                                                   |
| -------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `SOCKET_API_TOKEN`   | —                                    | Socket API token. Aliases `SOCKET_API_KEY`, `SOCKET_CLI_API_TOKEN`, `SOCKET_CLI_API_KEY`, `SOCKET_SECURITY_API_TOKEN`, `SOCKET_SECURITY_API_KEY` are also read. |
| `SOCKET_MCP_COMMAND` | `npx`                                | Command used to launch the MCP server.                                                                          |
| `SOCKET_MCP_ARGS`    | `-y @socketsecurity/mcp@latest`      | Space-separated args passed to `SOCKET_MCP_COMMAND`. Override to point at a locally installed binary instead of `npx`. |

To avoid the `npx` startup cost / version drift on every launch, this package
lists `@socketsecurity/mcp` as a direct dependency, so you can point at it
directly instead:

```bash
export SOCKET_MCP_COMMAND="node"
export SOCKET_MCP_ARGS="./node_modules/@socketsecurity/mcp/dist/index.cjs"
```

### How it works

- `session_start`: spawns the server via `StdioClientTransport`, connects an
  MCP `Client`, calls `listTools()`, and registers each tool with
  `pi.registerTool()`. Tool `inputSchema` (plain JSON Schema) is passed
  through via `Type.Unsafe(...)` from `typebox` instead of being hand-ported.
- Tool `execute()` forwards to `client.callTool(...)` and maps MCP content
  blocks (`text`, `image`, and anything else as a JSON-stringified text
  fallback) into pi's `(TextContent | ImageContent)[]` result shape. MCP
  `isError` results are re-thrown so pi marks the tool call as failed.
- `session_shutdown`: closes the client, killing the subprocess.

## npm security best-practices skill

It instructs the agent to:

- Prefer safe package-manager defaults (`ignore-scripts`, `min-release-age`,
  `save-exact`) without overwriting user-set values
- Score candidate packages (e.g. via Socket MCP / `socket_depscore`) before
  adding dependencies, and flag low quality/supply-chain/maintenance metrics
- Wrap installs with a package scanner such as Socket Firewall Free (`sfw`)
  when available

## Development

```bash
npm run check                    # tsc --noEmit
npx tsx scripts/test-harness.ts  # smoke test outside of pi (mocks ExtensionAPI)
```

`scripts/test-harness.ts` loads the Socket MCP extension directly, fires a
fake `session_start`, prints the discovered tools, and calls
`socket_depscore` once so you can sanity check the full spawn → connect →
list → call path without going through the pi CLI.

## Notes

- Only the self-hosted stdio transport is implemented. Socket also offers a
  public hosted server at `https://mcp.socket.dev/` over HTTP with OAuth,
  which would need a separate (OAuth-capable) transport if you want to avoid
  managing an API token.
