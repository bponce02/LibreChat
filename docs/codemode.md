# JavaScript codemode foundation

Personal-app scope: one run-local JavaScript sandbox, no account management, persisted script state, delivery queues, or separate codemode service.

The runtime uses QuickJS WebAssembly inside a terminable Node worker. Model code runs inside QuickJS, not Node `vm`. The worker has a wall-clock deadline, QuickJS memory/stack limits and a parent termination timer. Tool dispatch has bounded concurrency and call count. Code, crossing values and output are bounded. Cancellation aborts the host signal and terminates the worker; it cannot roll back completed tool effects.

Script APIs implemented: top-level `await`, `tools[name](args)`, `searchTools(query)`, `describeTool(name)`, `text(value)` and explicit `return`. Discovery contains only descriptors supplied by the host. Tool results are serialized data, never evaluated as code. Script code has no filesystem, fetch, process, environment, require, or module-loader globals. Host exception text is not returned to scripts.

`createCodemodeTool` accepts a run-local **authorized host dispatcher**, requires the outer tool-call ID, and gives each nested call a stable `<outer-id>:<sequence>` identity. It rejects recursive codemode exposure. The dispatcher must enforce existing argument validation, approval policy, cancellation, tool-result protection and tracing. It must not directly expose raw provider/MCP clients or unguarded `tool.invoke` calls.

## Current availability

The runtime and tool factory are implemented and tested. **The tool is not yet registered or available to agents.** Host integration remains pending: wire the existing authoritative dispatcher, including approval-required nested calls and continuation/replay, before registering it. No fake approval bypass is provided merely because this is a single-user deployment.

Image forwarding remains pending; only text/JSON output is supported now. No deferred tool exposure or cross-script storage is added.

## Configuration

`codemode` is disabled by default in `librechat.yaml`. Fields: `enabled`, `timeoutMs` (30000), `memoryBytes` (33554432), `maxCodeBytes` (65536), `maxOutputBytes` (32768), `maxValueBytes` (131072), `maxToolCalls` (50), and `concurrency` (4). Enabling config alone does not register the unfinished host integration.

Focused tests run the real QuickJS engine and worker: parallel asynchronous calls, discovery, selected output, missing host globals, synchronous infinite loops, unresolved promises, cancellation, code/value/output/call bounds, sanitized tool failures, untrusted result text and stable nested identity. Real app approval/replay verification is required when the dispatcher is connected.
