// ===== MITTEILIGE (Push) =====
// Lauft über Firebase Cloud Messaging. S'Versände mache d'Cloud Functions,
// do inne wird nume d'Erlaubnis gholt und dr Token gspeicheret.
import { getMessaging, getToken, isSupported, deleteToken } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging.js";
import { doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { VAPID_KEY } from './firebase-config.js';

const LS = 'gott_push_token';
let messaging = null, ready = null;

const isiOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function supported() {
  try { return await isSupported(); } catch (e) { return false; }
}

async function getMsg(app) {
  if (ready) return ready;
  ready = (async () => {
    messaging = getMessaging(app);
    // Eigene Bereich, damit dr normal sw.js nid überschriebe wird
    const reg = await navigator.serviceWorker.register('./firebase-messaging-sw.js', { scope: './fcm/' });
    await navigator.serviceWorker.ready.catch(() => {});
    return { messaging, reg };
  })();
  return ready;
}

// Erlaubnis hole und Token spichere. Mues us eme Tipp vom Benutzer chuu.
export async function enablePush(app, db, user, group) {
  if (!(await supported())) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'default';
  const { messaging, reg } = await getMsg(app);
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) return 'error';
  await setDoc(doc(db, 'pushTokens', token), {
    userId: user.uid,
    userName: user.displayName || user.email || '',
    groupId: group,
    updatedAt: Date.now(),
    platform: isiOS() ? 'ios' : 'web'
  });
  try { localStorage.setItem(LS, token); } catch (e) {}
  return 'granted';
}

// Token uffrische, wenn d'Erlaubnis scho da isch (z.B. nach eme Gruppe-Wächsel)
export async function refreshPush(app, db, user, group) {
  if (Notification.permission !== 'granted') return;
  try {
    if (!(await supported())) return;
    const { messaging, reg } = await getMsg(app);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) return;
    await setDoc(doc(db, 'pushTokens', token), {
      userId: user.uid,
      userName: user.displayName || user.email || '',
      groupId: group,
      updatedAt: Date.now(),
      platform: isiOS() ? 'ios' : 'web'
    });
    try { localStorage.setItem(LS, token); } catch (e) {}
  } catch (e) { console.warn('push refresh:', e.message); }
}

// Abmälde: Token lösche, d'Erlaubnis sälber blibt bestah
export async function disablePush(app, db) {
  let token = null;
  try { token = localStorage.getItem(LS); } catch (e) {}
  try {
    const { messaging } = await getMsg(app);
    await deleteToken(messaging).catch(() => {});
  } catch (e) {}
  if (token) { try { await deleteDoc(doc(db, 'pushTokens', token)); } catch (e) {} }
  try { localStorage.removeItem(LS); } catch (e) {}
}

export const pushOn = () => { try { return !!localStorage.getItem(LS); } catch (e) { return false; } };
