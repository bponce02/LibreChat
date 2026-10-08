const { createServer } = require('node:http');

createServer(async (req, res) => {
  if (req.url === '/health') {
    res.end('ok');
    return;
  }
  if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
    res.writeHead(404).end();
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  if (
    req.headers.authorization !== 'Bearer e2e-codex-client-key' ||
    body.tool_choice !== 'required' ||
    !body.tools?.some((tool) => tool.type === 'web_search' && tool.external_web_access === true)
  ) {
    res.writeHead(400).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      choices: [
        {
          message: {
            content: 'Grounded native search answer',
            native_search: {
              performed: true,
              sources: [
                { title: 'Official Codex docs', url: 'https://developers.openai.com/codex/' },
              ],
            },
          },
        },
      ],
    }),
  );
}).listen(8792, '127.0.0.1');
