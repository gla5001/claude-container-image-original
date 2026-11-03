import { useCallback, useEffect, useState } from 'react';

// unsupported: no service workers or Web Push here (plain http, or an iPhone page not on the Home Screen)
export type PushStatus = 'unsupported' | 'denied' | 'off' | 'on';

const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// The server's base64url VAPID key as bytes (atob tolerates the missing padding).
const decodeKey = (key: string) =>
  Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

const sameKey = (a: ArrayBuffer | null, b: Uint8Array) =>
  a !== null && a.byteLength === b.length && new Uint8Array(a).every((byte, i) => byte === b[i]);

/**
 * Subscribes this browser to the server's push notifications through the service worker in public/sw.js,
 * so they arrive with the tab closed or the phone locked. `register` hands the subscription to the server.
 */
export function usePush(serverKey: string | undefined, register: (subscription: PushSubscriptionJSON) => void) {
  const [status, setStatus] = useState<PushStatus>(() => {
    if (!supported) {
      return 'unsupported';
    }

    return Notification.permission === 'denied' ? 'denied' : 'off';
  });
  const [error, setError] = useState<string>();

  const subscribe = useCallback(async () => {
    if (!serverKey) {
      return;
    }

    const key = decodeKey(serverKey);
    await navigator.serviceWorker.register('/sw.js');
    // Subscribing needs an active worker, and a just-registered one may still be installing.
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    // The server makes a new key each time it starts, and a subscription only works with the key it was made with.
    if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
      await subscription.unsubscribe();
      subscription = null;
    }

    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    register(subscription.toJSON());
    setStatus('on');
  }, [serverKey, register]);

  // Already allowed: subscribe again whenever the server (and its key) is new, since it keeps
  // subscriptions in memory only.
  useEffect(() => {
    if (supported && Notification.permission === 'granted') {
      subscribe().catch(() => setStatus('off'));
    }
  }, [subscribe]);

  // Called from a click: browsers (Safari above all) only ask for permission from a user gesture.
  const enable = async () => {
    setError(undefined);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'off');
        return;
      }

      await subscribe();
    } catch (err) {
      setError(`Couldn't turn on notifications: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return { status, error, enable };
}
