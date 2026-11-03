import webpush, { type PushSubscription } from 'web-push';

// Web Push sent straight from this server: no account or third-party SDK. The browser's own push
// service (Google's for Chrome, Mozilla's, Apple's) carries the message, encrypted end to end, so it
// reaches the service worker with the tab closed or the phone locked.
// ponytail: keys and subscriptions live in memory, like the session itself. Pages re-subscribe on every
// connect, and a new key after a restart makes them replace their old subscription.
const keys = webpush.generateVAPIDKeys();
// Push services use this contact if the sender misbehaves. The container already has the owner's email.
webpush.setVapidDetails(
  `mailto:${process.env.GIT_AUTHOR_EMAIL || 'session-runner@example.com'}`,
  keys.publicKey,
  keys.privateKey,
);

export const publicKey = keys.publicKey;

const subscriptions = new Map<string, PushSubscription>(); // by endpoint, so a page re-subscribing replaces itself

export function subscribe(sub: unknown) {
  const { endpoint, keys } = (sub ?? {}) as Partial<PushSubscription>;
  if (typeof endpoint !== 'string' || typeof keys?.p256dh !== 'string' || typeof keys.auth !== 'string') {
    throw new Error('Not a push subscription.');
  }

  subscriptions.set(endpoint, { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
}

export function notify(payload: { title: string; body: string }) {
  console.log(`claude needs input: push to ${subscriptions.size} browser(s)`);
  for (const sub of subscriptions.values()) {
    // High urgency so phones in battery saving deliver it now, not at their next wake-up.
    webpush.sendNotification(sub, JSON.stringify(payload), { urgency: 'high' }).catch((err) => {
      // 404/410: the browser dropped the subscription (permission revoked, site data cleared).
      if (err.statusCode === 404 || err.statusCode === 410) {
        subscriptions.delete(sub.endpoint);
      } else {
        console.error(`push failed: ${err.statusCode ?? err.message}`);
      }
    });
  }
}
