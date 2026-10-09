# Open Terminal reader image transport

The reported JPEG/PNG decoding errors originate in the homelab REST-to-MCP adapter, not corrupt images or LibreChat's attachment uploader. Open Terminal `0.14.0` serves these files correctly as `image/jpeg` and `image/png`; its OpenAPI response declares JSON. FastMCP `2.14.5`'s generated handler tries JSON decoding and catches `JSONDecodeError`, but binary image decoding raises `UnicodeDecodeError`. Returning fallback text would not fix model vision.

The homelab fix is `librechat/terminal-mcp/server.py` on `feat/open-terminal-image-content`: an explicit `read_file` emits MCP image blocks based on the actual response MIME type before attempting any text decoding. Other generated tools, authentication and selected tool names remain unchanged. The patch is deployed as `local/librechat-terminal-mcp:59cbb67`.

## LibreChat model boundary

For the current OpenAI-compatible Codex endpoint, `formatToolContent` extracts MCP image blocks into `artifact.content` as inline `image_url` blocks. The agent's `projectArtifactPayload` carries those blocks into a model-visible Human message; the placeholder tool response is text, but the accompanying image is not. The connector translates the inline URL into the Pi library's image block and the Codex provider sends an image input.

Regression: `packages/api/src/mcp/__tests__/images.test.ts` checks PNG/JPEG/WebP through the real parser and artifact projection. Together with the existing parser suite, 162 tests passed; API typechecking, ESLint and Prettier passed. Homelab also adds a connector regression for tool-image and projected-user-image turns (9 connector tests plus typechecking passed).

## Actual-file verification

A disposable adapter read the exact reported `/home/user/slop-repo/projects/vision-tetris-agent/runs/20261008-174529/smoke.jpg` and `/tmp/tetris.png` from the existing REST service. Their serialized MCP results contained actual image blocks with the correct MIME types and original bytes. The existing `gpt-6.1-sol` connector/model visually identified both as a Tetris start menu, including the green PLAY button, LEVEL: 1, dark-gray panel, rainbow logo and purple surroundings. The decoded MCP images were personally viewed and matched those descriptions.

Camofox's actual screenshot tool returned an MCP PNG image block from a temporary public-page tab. The same model interpreted its rendered multilingual documentation-domain page and book icon, matching the personally viewed screenshot. No screenshot serialization fault was reproduced. The tab was closed. Private-network blocking was not changed or bypassed; serving files on localhost is not needed for the fixed reader.

The subsequent approved deployment recreated only the `terminal-mcp` adapter service. Its deployed HTTP MCP endpoint returned proper JPEG/PNG image blocks, and both were visually identified by the existing Codex model; a transient failure on one PNG verification request passed on retry. LibreChat's owner MCP connection was reinitialized successfully, without restarting the app or adding OAuth. General retained 82 tools. Open Terminal and its files were preserved. These direct verification requests did not create persisted chats or change General. Python tests used the existing FastMCP image in capped disposable containers; local checks ran serially under systemd CPU/memory limits. Remote CI/review remains unchecked. See the homelab adapter README for the adapter-only deployment and private rollback location.
