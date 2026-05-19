export const API_BASE_URL = process.env.CUSTENA_API_URL ?? 'https://api.custena.com';
export const MCP_URL = `${API_BASE_URL}/mcp`;
export const HOOKS_URL = `${API_BASE_URL}/api/v1/hooks/tool-use`;
export const TOKEN_STORE_PATH = `${process.env.HOME}/.custena/token.json`;
export const HOOK_QUEUE_PATH = `${process.env.HOME}/.custena/hook-queue.ndjson`;
// The pre-registered public OAuth client for Custena Connect, defined in the
// realm (apps/keycloak/realm.json). Passing this to `claude mcp add --client-id`
// avoids Dynamic Client Registration - every user of this CLI shares the same
// client ID, which is safe for public clients because PKCE prevents token theft.
// Override for self-hosted / staging via CUSTENA_OAUTH_CLIENT_ID.
export const OAUTH_CLIENT_ID = process.env.CUSTENA_OAUTH_CLIENT_ID ?? 'custena-connect-cli';
export const SKILL_TEXT = `
# custena-pay-skill

Custena handles paid HTTP for you. To call any URL that may require payment - whether it's on
the Custena network or external - use \`custena.fetch(url, method, headers?, body?)\`. The
backend observes any 402, runs spending governance, settles against your platform balance or
configured rail, retries the upstream call with the issued payment headers, and returns the
upstream body inline.

## Action - one tool

### custena.fetch

Use this for ANY HTTP call that might be metered. Pass the absolute URL and the HTTP method;
include \`headers\` and \`body\` if the upstream needs them.

**Do not** detect 402s yourself. **Do not** extract challenge headers. **Do not** retry.

The response shape is:

\`\`\`
{
  "status": "success" | "pending_approval" | "policy_blocked" | "insufficient_balance"
            | "rail_unavailable" | "upstream_error",
  "upstreamStatus": <int>,           // when status="success"
  "body": <upstream JSON>,            // when status="success"
  "paid": null | {                    // null when no payment was needed
    "transactionId": "...",
    "rail": "PLATFORM_BALANCE" | "X402" | "MPP" | "L402",
    "amountDebited": "0.01",
    "signedHeaders": { ... }
  },
  "approvalId": "...", "streamUrl": "...", "pollUrl": "...",  // when status="pending_approval"
  "reason": "...", "detail": "..."    // when status is a denial state
}
\`\`\`

How to react to each status:

- **success** -> Use \`body\` as the upstream response. Mention the \`paid\` rail + amount briefly
  if \`paid\` is non-null; stay quiet if it's null (free upstream, no transaction to surface).
- **pending_approval** -> Tell the user the call is held for human approval and share the
  approval link. Stop. Do not retry.
- **policy_blocked** / **insufficient_balance** / **rail_unavailable** -> Surface \`reason\` and
  \`detail\` verbatim. Do not retry.
- **upstream_error** -> The upstream URL itself failed (timeout, connection refused, blocked).
  No payment was attempted. Surface the \`detail\` and stop.

## Discovery - call this before fetch when you don't know the URL

### custena.discover

Use this when the user wants to use a paid API but hasn't named a specific URL. Searches the
Custena service catalogue for sellers that have opted into agent discovery and returns service
names, descriptions, per-endpoint proxy URLs (the exact strings to pass to \`custena.fetch\`),
and price per call. Pass an optional \`query\` keyword to narrow results.

Trigger phrases: "paid search", "paid API for X", "paid data source for Y", "paid weather /
news / financial / market / anything API", "what paid services can I call", "is there a paid
<anything>", "find a paid <anything>", "I need a paid <thing>". If the user asks for an API or
data source that sounds metered and you don't already have a URL for it, call discover first.

After discover returns, hand a \`proxyUrl\` straight to \`custena.fetch\` - the URL is already the
Custena proxy URL; do NOT look up sellers, slugs, or assemble paths yourself.

## Read tools - read-only; only invoke when the user explicitly asks

These tools are passive. Do not call them during a payment flow, do not call them to "check
state" before deciding whether to invoke \`custena.fetch\`, do not call them speculatively.
Invoke each ONLY when the user has just asked a question that maps directly to its output.

### custena.balance

Read-only; only invoke when the user explicitly asks. Returns the current platform balance,
spending limits, and per-rail funded state.

Trigger phrases: "what's my balance", "how much can I spend", "is my agent frozen".

### custena.transactions

Read-only; only invoke when the user explicitly asks. Returns the most recent transactions
including auto-paid, blocked, and rejected ones. Each row has \`rail\`, \`amount\`, \`status\`,
\`sellerHost\`, \`paidAt\`, and \`denialReason\` (when the row didn't settle cleanly).

Trigger phrases: "what did I pay yesterday", "why was that rejected", "show me my recent calls".

### custena.policies

Read-only; only invoke when the user explicitly asks. Returns the buyer's active spending
policy: per-transaction cap, daily / monthly budgets, approval threshold, and allowlist /
denylist domains.

Trigger phrases: "what's my approval threshold", "which domains can I call", "what are my
spending limits".

## Hard rules

1. The ONLY payment-capable tool is \`custena.fetch\`. Do not invoke \`custena.pay_challenge\` -
   it's a legacy escape hatch for SDK callers who already hold a 402, not for agent use.
2. Never extract response headers from a 402. Never splice payment headers onto a retry. Never
   retry after a 402 yourself. The backend handles all of it.
3. Never gate \`custena.fetch\` calls on \`custena.balance\` output. Spending governance runs
   server-side; trust the response status, not pre-checks.
4. Never invoke a read tool unprompted. The user must have asked something that maps to the
   tool's output.
`.trim();
