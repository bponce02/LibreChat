import { projectArtifactPayload } from '@librechat/agents';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';

import { formatToolContent, resolveMCPToolProvider } from '../parsers';

const cases: Array<[string, Buffer]> = [
  ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff])],
  ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
  ['image/webp', Buffer.from('RIFF\xffWEBP', 'latin1')],
];

describe('MCP reader images at the OpenAI model boundary', () => {
  it('uses a resolved provider instead of a custom endpoint display name', () => {
    expect(resolveMCPToolProvider('Codex Subscription', 'openai')).toBe('openai');
    expect(resolveMCPToolProvider('Local Pi', 'openai')).toBe('openai');
    expect(
      resolveMCPToolProvider('Codex Subscription', undefined, [{ name: 'Codex Subscription' }]),
    ).toBe('openai');
    expect(
      resolveMCPToolProvider('Luna', undefined, [{ name: 'Luna', provider: 'anthropic' }]),
    ).toBe('anthropic');
    expect(
      resolveMCPToolProvider('codex subscription', undefined, [{ name: 'Codex Subscription' }]),
    ).toBe('codex subscription');
    expect(resolveMCPToolProvider('ANTHROPIC', 'openai')).toBe('anthropic');
    expect(resolveMCPToolProvider(undefined, 'OpenAI')).toBe('openai');
    expect(resolveMCPToolProvider('unknown', 'unsupported')).toBe('unknown');
    expect(resolveMCPToolProvider()).toBeUndefined();
  });
  it.each(cases)('preserves %s as an image, not serialized tool text', (mimeType, bytes) => {
    const data = bytes.toString('base64');
    const [content, artifact] = formatToolContent(
      { content: [{ type: 'image', mimeType, data }] },
      resolveMCPToolProvider('Codex Subscription', 'openai') as 'openai',
    );
    expect(content).toBe('');
    const messages = projectArtifactPayload([
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'read_1', name: 'read_file', args: { path: '/tmp/image' } }],
      }),
      new ToolMessage({ content, artifact, name: 'read_file', tool_call_id: 'read_1' }),
    ]);
    const visible = messages[messages.length - 1];
    expect(visible).toBeInstanceOf(HumanMessage);
    expect(visible.content).toEqual([
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${data}` } },
    ]);
    expect(messages[1].content).not.toContain(data);
    expect(Buffer.from(data, 'base64')).toEqual(bytes);
  });
});
