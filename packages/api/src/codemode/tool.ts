import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { codemodeConfigSchema } from 'librechat-data-provider';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { CodemodeConfig } from 'librechat-data-provider';
import type { CodemodeHost } from './runtime';
import { runCodemode } from './runtime';

export function createCodemodeTool(deps: {
  policy?: Partial<CodemodeConfig>;
  getHost(config: RunnableConfig, parentToolCallId: string): Promise<CodemodeHost>;
}): StructuredToolInterface | null {
  const policy = codemodeConfigSchema.parse(deps.policy ?? {});
  if (!policy.enabled) return null;
  return tool(
    async ({ code }, config) => {
      const id = config.toolCall?.id;
      if (!id) return JSON.stringify({ ok: false, output: [], error: 'UNAVAILABLE' });
      try {
        const host = await deps.getHost(config, id);
        if (
          host.tools.some((descriptor) => descriptor.name === 'codemode') ||
          new Set(host.tools.map((descriptor) => descriptor.name)).size !== host.tools.length
        ) {
          return JSON.stringify({ ok: false, output: [], error: 'UNAVAILABLE' });
        }
        const result = await runCodemode(
          code,
          policy,
          {
            tools: host.tools,
            invoke: (name, input, signal, callId) =>
              host.invoke(name, input, signal, `${id}:${callId}`),
          },
          config.signal,
        );
        if (!result.ok || !result.images?.length) return JSON.stringify(result);
        const pictures = result.images.map((ref) => host.getImage?.(ref));
        if (pictures.some((picture) => !picture))
          return JSON.stringify({ ok: false, output: result.output, error: 'SCRIPT_ERROR' });
        return [
          { type: 'text' as const, text: JSON.stringify(result) },
          ...pictures.filter((picture) => picture !== undefined),
        ];
      } catch {
        return JSON.stringify({ ok: false, output: [], error: 'UNAVAILABLE' });
      }
    },
    {
      name: 'codemode',
      description:
        'Run isolated JavaScript with top-level await. Use searchTools(query), describeTool(name), tools[name](args), text(value), image(ref), and return. Image tool results expose opaque refs; only those refs can be displayed. Only authorized tools supplied by this run are available. No Node, filesystem, network or module imports. Select output instead of dumping intermediate tool results. Already executed tool effects are not rolled back by cancellation.',
      schema: z.object({ code: z.string().max(policy.maxCodeBytes) }).strict(),
    },
  );
}
