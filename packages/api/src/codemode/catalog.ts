import type { CodemodeConfig, TPlugin } from 'librechat-data-provider';
import type { ExtendedJsonSchema } from '~/tools/registry/schema';

export const codemodeDefinition: {
  name: string;
  description: string;
  parameters: ExtendedJsonSchema;
} = {
  name: 'codemode',
  description:
    'Run isolated JavaScript to discover and batch this agent’s enabled tools. Use top-level await, searchTools, describeTool, tools[name](args), text, and return. No filesystem, network, Node or module access.',
  parameters: {
    type: 'object',
    properties: { code: { type: 'string', description: 'JavaScript code.' } },
    required: ['code'],
    additionalProperties: false,
  },
};
export function getCodemodeCatalogTools(
  included: string[],
  filtered: string[],
): Array<{ type: 'function'; function: typeof codemodeDefinition }> {
  if (included.length ? !included.includes('codemode') : filtered.includes('codemode')) return [];
  return [{ type: 'function', function: codemodeDefinition }];
}
export function filterCodemodePlugins(
  plugins: TPlugin[],
  policy?: Partial<CodemodeConfig>,
): TPlugin[] {
  return policy?.enabled ? plugins : plugins.filter((plugin) => plugin.pluginKey !== 'codemode');
}
