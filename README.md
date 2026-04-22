# custena-connect

Connect your AI coding agent to [Custena](https://custena.com) so it can pay HTTP 402 responses on your behalf — with a real spending account, real receipts, and real governance.

## Install

```bash
npm install -g custena-connect
```

Or run without installing:

```bash
npx custena-connect install
```

Requires **Node.js 20+**.

## Quick start

```bash
custena-connect install
```

This will:

1. Detect your installed coding agent (currently: **Claude Code**).
2. Open your browser to sign in to Custena (OAuth 2.0 with PKCE).
3. Register Custena as an MCP server in your agent.
4. Install a skill file describing how to use it.
5. Wire up hooks so tool/prompt events are reported to your Custena account.

From there, your agent can call any Custena-wrapped API or MCP server. When a seller returns HTTP 402, your agent pays from your Custena buyer balance — no prompt, no card, no context switch.

## Commands

| Command | Description |
|---------|-------------|
| `custena-connect install` | Detects your coding agent and wires it up end-to-end. |
| `custena-connect uninstall` | Removes Custena MCP config, hooks, and skill files. |
| `custena-connect doctor` | Checks OAuth token state and adapter health. |
| `custena-connect hook <event>` | Internal. Called by the coding agent's hook system. |

## Supported hosts

| Host | Status |
|------|--------|
| [Claude Code](https://claude.com/claude-code) | ✅ Supported |
| Cursor | 🔜 Planned |
| Cline | 🔜 Planned |
| VS Code Copilot | 🔜 Planned |

Want another host? [Open an issue](https://github.com/Custena/custena-connect-nodejs/issues).

## How it works

- **OAuth** — `custena-connect install` runs an OAuth 2.0 Authorization Code + PKCE flow against `auth.custena.com`, with a local callback on `http://localhost:9874/callback`. The resulting token is written to `~/.custena/token.json` (mode `0600`).
- **MCP** — Custena's MCP server lives at `https://api.custena.com/mcp`. The adapter registers it with your host via the host's native MCP config (for Claude Code: `claude mcp add --transport http --scope user`).
- **Hooks** — On hosts that support them, `custena-connect` installs `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, and `Stop` hooks that forward summaries to Custena for audit and governance. Events are queued locally if the network is unavailable and drained on the next successful call.

## Configuration

All configuration has sensible defaults. Override via environment variables if you're pointing at a different Custena environment:

| Variable | Default | Description |
|----------|---------|-------------|
| `CUSTENA_API_URL` | `https://api.custena.com` | Custena API base URL |
| `CUSTENA_KEYCLOAK_URL` | `https://auth.custena.com/realms/custena` | Keycloak realm URL |
| `CUSTENA_OAUTH_CLIENT_ID` | `custena-connect-cli` | OAuth client ID |

## Development

```bash
git clone https://github.com/Custena/custena-connect-nodejs.git
cd custena-connect-nodejs
npm install
npm run dev -- install    # run the CLI from source
npm test                   # run the test suite
npm run typecheck
npm run build
```

## Security

- Tokens are stored at `~/.custena/token.json` with file mode `0600`.
- OAuth uses PKCE; no client secret is embedded.
- Hook payloads are truncated to 4 KB and never include prompt/tool-response bodies in full.

Report security issues privately to `security@custena.com`.

## License

[MIT](./LICENSE) © Custena
