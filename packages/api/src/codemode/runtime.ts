import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import type {
  CodemodeConfig,
  CodemodeToolDescriptor,
  CodemodeResult,
} from 'librechat-data-provider';
import { codemodeWorker } from './worker';

export interface CodemodeHost {
  tools: CodemodeToolDescriptor[];
  invoke(name: string, input: unknown, signal: AbortSignal, callId: string): Promise<unknown>;
}
type Call = { type: 'call'; id: number; name: string; input: unknown };
type Done = { type: 'done'; result: CodemodeResult };

export function runCodemode(
  code: string,
  policy: CodemodeConfig,
  host: CodemodeHost,
  signal?: AbortSignal,
): Promise<CodemodeResult> {
  if (!policy.enabled) return Promise.resolve({ ok: false, output: [], error: 'DISABLED' });
  if (typeof code !== 'string' || Buffer.byteLength(code) > policy.maxCodeBytes)
    return Promise.resolve({ ok: false, output: [], error: 'INVALID_CODE' });
  if (signal?.aborted) return Promise.resolve({ ok: false, output: [], error: 'CANCELLED' });
  const descriptors = JSON.stringify(host.tools);
  if (Buffer.byteLength(descriptors) > policy.maxValueBytes)
    return Promise.resolve({ ok: false, output: [], error: 'LIMIT' });
  return new Promise((resolve) => {
    const controller = new AbortController();
    const allowed = new Set(host.tools.map((tool) => tool.name));
    const waiting: Call[] = [];
    let finished = false;
    let calls = 0;
    let active = 0;
    let worker: Worker;
    const finish = (result: CodemodeResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      controller.abort();
      void worker?.terminate();
      resolve(result);
    };
    const cancel = () => finish({ ok: false, output: [], error: 'CANCELLED' });
    const timer = setTimeout(
      () => finish({ ok: false, output: [], error: 'TIMEOUT' }),
      policy.timeoutMs,
    );
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const require = createRequire(`${process.cwd()}/package.json`);
      worker = new Worker(codemodeWorker, {
        eval: true,
        workerData: {
          code,
          policy,
          tools: host.tools,
          engine: require.resolve('quickjs-emscripten'),
        },
        resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
      });
    } catch {
      finish({ ok: false, output: [], error: 'UNAVAILABLE' });
      return;
    }
    const drain = () => {
      while (!finished && active < policy.concurrency && waiting.length) {
        const call = waiting.shift()!;
        active++;
        void Promise.resolve()
          .then(() => {
            if (controller.signal.aborted) throw new Error('Cancelled');
            return host.invoke(call.name, call.input, controller.signal, String(call.id));
          })
          .then((value) => {
            if (finished) return;
            const encoded = JSON.stringify(value ?? null);
            if (Buffer.byteLength(encoded) > policy.maxValueBytes) {
              finish({ ok: false, output: [], error: 'LIMIT' });
              return;
            }
            worker.postMessage({ id: call.id, ok: true, value: JSON.parse(encoded) });
          })
          .catch(() => {
            if (!finished) worker.postMessage({ id: call.id, ok: false });
          })
          .finally(() => {
            active--;
            drain();
          });
      }
    };
    worker.on('message', (message: Call | Done) => {
      if (finished) return;
      if (message.type === 'done') {
        finish(message.result);
        return;
      }
      if (message.type !== 'call' || !allowed.has(message.name)) {
        finish({ ok: false, output: [], error: 'SCRIPT_ERROR' });
        return;
      }
      calls++;
      if (calls > policy.maxToolCalls) {
        finish({ ok: false, output: [], error: 'LIMIT' });
        return;
      }
      waiting.push(message);
      drain();
    });
    worker.on('error', () => finish({ ok: false, output: [], error: 'UNAVAILABLE' }));
    worker.on('exit', () => {
      if (!finished) finish({ ok: false, output: [], error: 'UNAVAILABLE' });
    });
  });
}
