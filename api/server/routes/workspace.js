const express = require('express');
const { requireJwtAuth, configMiddleware } = require('~/server/middleware');
const { handlers } = require('~/server/services/Workspace');

const router = express.Router();
router.use(handlers.noStore, requireJwtAuth, configMiddleware);
router.get('/config', handlers.config);
router.get('/files', handlers.list);
router.get('/file', handlers.read);
router.post('/file', handlers.write);
router.post('/upload', handlers.upload);
router.get('/download', handlers.download);
router.get('/terminals', handlers.sessions);
router.post('/terminals', handlers.create);
router.delete('/terminals/:id', handlers.close);
module.exports = router;
