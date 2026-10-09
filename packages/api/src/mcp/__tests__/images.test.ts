import { projectArtifactPayload } from '@librechat/agents';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';

import { formatToolContent } from '../parsers';

const cases: Array<[string, Buffer]> = [
  ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff])],
  ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
  ['image/webp', Buffer.from('RIFF\xffWEBP', 'latin1')],
];

describe('MCP reader images at the OpenAI model boundary', () => {
  it.each(cases)('preserves %s as an image, not serialized tool text', (mimeType, bytes) => {
    const data = bytes.toString('base64');
    const [content, artifact] = formatToolContent(
      { content: [{ type: 'image', mimeType, data }] },
      'openai',
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
