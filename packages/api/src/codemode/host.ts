import { createHash } from 'node:crypto';
import { codemodeConfigSchema, hasActivePiiFields } from 'librechat-data-provider';
import type { CodemodeConfig, CodemodeImage, FiltersConfig } from 'librechat-data-provider';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { LCToolRegistry } from '@librechat/agents';
import { extractToolArgumentContent } from '~/protection/adapters/submissions';
import { assertDirectToolOutputAllowed } from '~/tools/protection';
import { assertToolApprovalExecution } from '~/tools/approval';
import { inspectContent } from '~/protection/runtime';
import { createCodemodeTool } from './tool';

const excluded = new Set([
  'codemode',
  'tool_search',
  'programmatic_tool_calling',
  'bash_programmatic_tool_calling',
  'ask_user_question',
  'check_background_task',
]);

export function getCodemodeToolNames(
  requested: string[],
  selected: string[] | undefined,
  policy?: Partial<CodemodeConfig>,
): string[] {
  if (!policy?.enabled || !requested.includes('codemode')) return requested;
  return [...new Set([...requested, ...(selected ?? []).filter((name) => !excluded.has(name))])];
}

export function attachCodemodeHost(deps: {
  tools: StructuredToolInterface[];
  registry?: LCToolRegistry;
  policy?: Partial<CodemodeConfig>;
  filters?: FiltersConfig;
}): void {
  const index = deps.tools.findIndex((tool) => tool.name === 'codemode');
  if (index < 0) return;
  const permitted = new Map(
    deps.tools.filter((tool) => !excluded.has(tool.name)).map((tool) => [tool.name, tool]),
  );
  const policy = codemodeConfigSchema.parse(deps.policy ?? {});
  const tool = createCodemodeTool({
    policy,
    getHost: async (config) => {
      const images = new Map<string, CodemodeImage>();
      const projectResult = (value: unknown): unknown => {
        if (!Array.isArray(value)) return value;
        return value.map((block) => {
          if (!block || typeof block !== 'object' || block.type !== 'image_url') return block;
          const url = typeof block.image_url === 'string' ? block.image_url : block.image_url?.url;
          if (
            typeof url !== 'string' ||
            Buffer.byteLength(url) > policy.maxImageBytes ||
            !/^(https:\/\/|data:image\/(png|jpeg|webp|gif);base64,)/.test(url)
          )
            throw new Error('Invalid tool image');
          const ref = `image-${createHash('sha256').update(url).digest('hex')}`;
          if (!images.has(ref) && images.size >= policy.maxImages) throw new Error('Image limit');
          images.set(ref, { type: 'image_url', image_url: { url } });
          return { type: 'image', ref };
        });
      };
      return {
        getImage: (ref) => images.get(ref),
        tools: [...permitted.values()].map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: deps.registry?.get(tool.name)?.parameters ?? {},
        })),
        async invoke(name, input, signal, callId) {
          const target = permitted.get(name);
          if (!target || signal.aborted) throw new Error('Tool unavailable');
          if (!input || typeof input !== 'object' || Array.isArray(input))
            throw new Error('Tool arguments must be an object');
          const args = input as Record<string, unknown>;
          const pii = deps.filters?.toolArguments?.pii;
          if (hasActivePiiFields(pii, ['name', 'arguments'])) {
            const finding = inspectContent(
              extractToolArgumentContent({
                ...((pii?.fields == null || pii.fields.includes('name')) && { name }),
                ...((pii?.fields == null || pii.fields.includes('arguments')) && {
                  arguments: input,
                }),
              }),
              { filters: deps.filters },
            );
            if (finding) throw new Error('Tool input blocked');
          }
          const nestedConfig = {
            ...config,
            signal,
            toolCall: { id: callId, name, args },
            metadata: {
              ...config.metadata,
              executingAgentId:
                typeof config.metadata?.executingAgentId === 'string'
                  ? config.metadata.executingAgentId
                  : undefined,
              codemode: true,
            },
          };
          await assertToolApprovalExecution(target, nestedConfig);
          const result = await target.invoke(input, nestedConfig);
          assertDirectToolOutputAllowed(deps.filters, name, result);
          if (typeof result === 'object' && result !== null && 'content' in result)
            return projectResult(result.content);
          return projectResult(result);
        },
      };
    },
  });
  if (!tool) {
    deps.tools.splice(index, 1);
    return;
  }
  deps.tools[index] = tool;
}
