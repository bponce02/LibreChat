const { createPiSyncHandlers, GenerationJobManager } = require('@librechat/api');
const { piSyncStore } = require('~/models');
const { getAppConfig } = require('~/server/services/Config');

module.exports = createPiSyncHandlers({
  store: piSyncStore,
  getConfig: getAppConfig,
  key: process.env.PI_SYNC_KEY,
  standalone: process.env.TENANT_ISOLATION_STRICT !== 'true',
  getJob: GenerationJobManager.getJob.bind(GenerationJobManager),
});
