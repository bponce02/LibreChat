# Codex native web search

`codex_web_search` searches through the existing Pi Codex connector and its subscription OAuth store. It returns a grounded answer and source links. Any agent with this tool selected can use it, including an agent running a non-Codex model. JavaScript codemode can discover and invoke the same selected tool:

```js
const result = await tools.codex_web_search({ query: 'Official Codex documentation' });
text(result);
```

This is a separate **Codex Web Search** entry in the agent builder, not LibreChat's ordinary Web Search toggle. Other search and browser tools remain unchanged. It does not install Hermes, invoke the Codex CLI, add a login, or revive CLIProxyAPI.

## Configuration

Disabled by default. Set the following in `librechat.yaml` and provide the existing connector client key as server-only `CODEX_CONNECTOR_API_KEY`:

```yaml
codexSearch:
  enabled: true
  baseUrl: http://codex-connector:8788/v1
  model: gpt-6.1-sol
  timeoutMs: 120000
  maxQueryLength: 4000
  maxAnswerLength: 16000
  maxResponseBytes: 131072
  maxSources: 20
```

Then add **Codex Web Search** to the agent's selected tools. The configured model must exist in the connector's catalog and support hosted search. Endpoint, model, and credentials are fixed by server configuration, not supplied by the agent. The URL is administrator-controlled and may intentionally point to the private Docker network. Redirects are rejected to avoid forwarding its client key to another host.

## Reuse and transport

The small native payload helper is adapted from [Evizero/pi-codex-web-search](https://github.com/Evizero/pi-codex-web-search), revision `c37a88c376ce2023da3322806b367a000a351c23`. Its MIT notice is retained in the homelab repository at `pi-connectors/CODEX-SEARCH-LICENSE`. The rest of the adapter uses our existing Pi AI library for OAuth refresh, cancellation, request conversion and SSE parsing; no provider implementation was copied.

[Hermes's implementation](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-search#openai-native-codex-responses) confirms the same Responses built-in `{"type":"web_search"}` approach. The extension's default always-on/cached policy is deliberately not reused: this integration declares live native search only when the selected LibreChat tool is invoked.

LibreChat sends an authenticated, nonstreaming connector request containing only that native tool and `tool_choice: required`. The connector inserts it through Pi's `onPayload` hook and observes raw provider events through `onProviderStreamEvent`. It requests `web_search_call.action.sources`, preserves URL citations, strips OpenAI's tracking parameter, deduplicates links and bounds source metadata. Native search calls are never exposed as client-executable function calls.

A successful result requires a completed native search call; ordinary text without it is not reported as a successful search. Source links allow only HTTP(S), with no URL credentials. Response bytes, query length, answer length, sources, and duration are bounded. Failures expose safe codes, not provider payloads or credentials. Cancellation continues through LangChain and codemode's existing policies; there are no new approval prompts.

Sources and answers are untrusted web/model content. Links are not automatically fetched. Use a browser or extraction tool when a full document is needed. Native Responses search can open pages internally when the provider chooses to, but this tool is not a general URL-extraction endpoint.

## Verification

- Connector tests exercise the real Pi Codex SSE adapter against fake HTTP events, including payload injection and citation forwarding.
- Tool tests cover configuration, caller override rejection, malformed/failed results, response bounds and cancellation.
- App configuration tests ensure the policy reaches request configuration.
- `e2e/playwright.config.search.ts` covers direct agent and agent → codemode → tool execution, plus visible clickable citations, against a disposable database and fake external connector.
- An isolated real-subscription preflight completed hosted search and returned official OpenAI sources without changing existing chats or reloading a Pi session.
