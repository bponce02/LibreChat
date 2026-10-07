const { createPiNotificationHandler, webPushSender } = require('@librechat/api');
const {
  piSyncStore,
  enqueueNotification,
  getPushSubscriptions,
  revokePushDevice,
} = require('~/models');
const { getAppConfig } = require('~/server/services/Config');

module.exports = createPiNotificationHandler({
  store: piSyncStore,
  getConfig: getAppConfig,
  key: process.env.PI_SYNC_KEY,
  standalone: process.env.TENANT_ISOLATION_STRICT !== 'true',
  enqueue: enqueueNotification,
  push: {
    getPushSubscriptions,
    revokePushDevice,
    send: webPushSender,
    privateKey: process.env.LIBRECHAT_WEB_PUSH_PRIVATE_KEY,
  },
});
