const express = require('express');
const { createNotificationHandlers } = require('@librechat/api');
const { requireJwtAuth, configMiddleware } = require('~/server/middleware');
const { listNotifications, readNotification } = require('~/models');

const router = express.Router();
const handlers = createNotificationHandlers({ listNotifications, readNotification });
router.use(requireJwtAuth, configMiddleware);
router.get('/config', handlers.config);
router.get('/', handlers.list);
router.patch('/:id/read', handlers.read);
module.exports = router;
