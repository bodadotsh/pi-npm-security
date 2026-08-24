---
name: npm-security
description: Prevent JavaScript/TypeScript projects from supply-chain attacks across package managers like npm, pnpm, yarn, bun, and deno. Use whenever planning, installing, updating packages or configuring package managers
---

Apply the following security best practices. Never override an explicit user opt-in config (lifecycle scripts, cooldowns, save prefix, etc) unless they ask.

Always check current package manager's verions, and verify against their official documentations. See "References" for links or perfom web searches.

## Environment defaults

For the following best practices, we are using `npm` as example but you should check to see which package manager is available and apply the configurations according.

### Lifecycle scripts

Unless explicitly defined otherwiese, package managers should have lifecycle scripts set as **off**, for example `preinstall` and `postinstall`.

In `.npmrc`, this can be set as `ignore-scripts=true`, or through install command: `npm install --ignore-scripts `.

### Cooldowns / minimum release age

Unless explicitly defined otherwiese, package installations should respect a cooldown period (default to 1 day).

In `.npmrc`, this can be set as `min-release-age=1`, or through install command `npm install --min-release-age=1 `.

### Exact versions

Unless explicitly defined otherwise, package installations should install the expact version instead of a semver range.

In `.npmrc`, this can be set as `save-exact=true`, or through install command `npm install --save-exact `

> Persist these defaults in the project `.npmrc` (or the package manager’s equivalent), merging only keys that are unset; never overwrite existing values unless the user asks.

## Planning stage / package scorer

When planning third-party dependencies, score package candidates first. This reduces risk of greyware (trollware, abandonware, low quality, etc.). Prefer the Socket tools registered by this package's Socket MCP bridge extension; use another scorer only if the user configured one explicitly.

### Primary tool: `socket_depscore`

Before adding or recommending a dependency, call `socket_depscore` with the candidate packages (ecosystem, name, version — use `"unknown"` if the version is not known yet). Also score imports found in code, not only manifest entries.

Example:

```json
{
  "packages": [
    { "ecosystem": "npm", "depname": "express", "version": "4.18.2" },
    { "ecosystem": "npm", "depname": "lodash", "version": "unknown" }
  ]
}
```

If any metric (quality, supply chain, maintenance, vulnerability, license, etc.) is low (for example ≤60), stop and ask the user how to proceed — suggest alternatives or decline to install without confirmation.

### Deeper inspection (when needed)

- `socket_package_files` — list files shipped in a package before installing
- `socket_package_file_contents` / `socket_package_file_grep` — read or search a specific file (use the hash from `socket_package_files`)
- `socket_organizations` → `socket_alerts` / `socket_threat_feed` — org-wide alerts and threat intel (requires a token with org access)

If Socket tools are unavailable (extension not connected / missing `SOCKET_API_TOKEN`), tell the user and do not pretend packages were scored.

## Install stage / package scanner

When time to install third-party dependencies, we should validate them against a package scanner first. This reduces risk of compromises as the scanner will check against a real-time intelligence database.

A free scanner solution is the Socket Firewall Free cli `sfw`. Can use other package scanners if user configured explicitly.

The `sfw` cli can be downloaded first through `npm i -g sfw` or through `npx`: `npx sfw npm install `

If any package got compromised, as soon as the Socket security updated their database, the `sfw` cli can reject the package installations in real-time even before the malicious tarball reaches the user.

## References

Package managers:

- npm: https://docs.npmjs.com/cli/
- pnpm: https://pnpm.io/
- yarn: https://yarnpkg.com/
- bun: https://bun.sh/llms.txt/
- deno: https://docs.deno.com/runtime/

Socket products:

- https://docs.socket.dev/docs/guide-to-socket-mcp
- https://github.com/SocketDev/socket-mcp
- https://docs.socket.dev/docs/socket-firewall-free
