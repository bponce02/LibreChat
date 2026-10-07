const express = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const handlers = require('~/server/services/Pi');

const router = express.Router();
router.post('/', handlers.sync);
router.get('/:conversationId', requireJwtAuth, handlers.status);
module.exports = router;
