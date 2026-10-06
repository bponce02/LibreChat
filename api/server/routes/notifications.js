const express = require('express');
const { createNotificationHandlers, createPushDeviceHandlers } = require('@librechat/api');
const { requireJwtAuth, configMiddleware } = require('~/server/middleware');
const {
  listNotifications,
  readNotification,
  registerPushDevice,
  listPushDevices,
  revokePushDevice,
} = require('~/models');

const router = express.Router();
const handlers = createNotificationHandlers({ listNotifications, readNotification });
const devices = createPushDeviceHandlers({ registerPushDevice, listPushDevices, revokePushDevice });
router.use(requireJwtAuth, configMiddleware);
router.get('/devices', devices.list);
router.post('/devices', devices.register);
router.delete('/devices/:id', devices.revoke);
router.get('/config', handlers.config);
router.get('/', handlers.list);
router.patch('/:id/read', handlers.read);
module.exports = router;
