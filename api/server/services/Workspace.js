const passport = require('passport');
const { WebSocket, WebSocketServer } = require('ws');
const { createWorkspaceService } = require('@librechat/api');
const { getAppConfig } = require('~/server/services/Config');

module.exports = createWorkspaceService({
  apiKey: process.env.OPEN_TERMINAL_API_KEY,
  fetch: globalThis.fetch,
  Socket: WebSocket,
  SocketServer: WebSocketServer,
  origin: process.env.DOMAIN_CLIENT,
  authenticate: passport.authenticate.bind(passport),
  getConfig: getAppConfig,
});
