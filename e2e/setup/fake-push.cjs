const webPush = require('web-push');

webPush.sendNotification = async (subscription, payload, options) => {
  if (!subscription.endpoint.startsWith('https://fcm.googleapis.com/fcm/send/e2e-')) {
    throw new Error('The push fixture never contacts external providers');
  }
  const request = webPush.generateRequestDetails(subscription, payload, options);
  if (request.headers['Content-Encoding'] !== 'aes128gcm' || !request.body?.length) {
    throw new Error('Expected an encrypted Web Push request');
  }
  return { statusCode: 201, headers: {}, body: '' };
};
