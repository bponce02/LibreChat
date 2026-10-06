(() => {
  const notificationIdPattern = /^[a-f0-9]{64}$/;
  const conversationIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

  function validIdentity(value) {
    return (
      value &&
      typeof value.notificationId === 'string' &&
      notificationIdPattern.test(value.notificationId) &&
      typeof value.conversationId === 'string' &&
      conversationIdPattern.test(value.conversationId)
    );
  }

  self.addEventListener('push', (event) => {
    let payload;
    try {
      const text = event.data?.text();
      if (!text || text.length > 4096) return;
      payload = JSON.parse(text);
    } catch {
      return;
    }
    if (
      !validIdentity(payload) ||
      payload.version !== 1 ||
      typeof payload.title !== 'string' ||
      !payload.title.trim() ||
      payload.title.length > 120 ||
      typeof payload.body !== 'string' ||
      !payload.body.trim() ||
      payload.body.length > 512
    )
      return;

    event.waitUntil(
      self.registration.showNotification(payload.title, {
        body: payload.body,
        tag: `librechat-${payload.notificationId}`,
        icon: new URL('assets/icon-192x192.png', self.registration.scope).href,
        data: { notificationId: payload.notificationId, conversationId: payload.conversationId },
      }),
    );
  });

  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const data = event.notification.data;
    if (!validIdentity(data)) return;
    const scope = new URL(self.registration.scope);
    const destination = new URL(`c/${encodeURIComponent(data.conversationId)}`, scope).href;
    event.waitUntil(
      (async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windows) {
          const current = new URL(client.url);
          if (current.origin !== scope.origin || !current.pathname.startsWith(scope.pathname))
            continue;
          if (client.url === destination) return client.focus();
        }
        return self.clients.openWindow(destination);
      })(),
    );
  });
})();
