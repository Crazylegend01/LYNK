// ============================================================
// LYNK By Legends — Firebase Configuration (SDK v10.14.1)
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { isSupported, getAnalytics } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyCjwWg4FcMGv3utGjQZ9PXRor8NqO0bMno",
  authDomain: "lynk-a6c6e.firebaseapp.com",
  projectId: "lynk-a6c6e",
  storageBucket: "lynk-a6c6e.firebasestorage.app",
  messagingSenderId: "415646266101",
  appId: "1:415646266101:web:d5d2685dfbeb1455860bbc",
  measurementId: "G-PTYKWXVY60"
};

// Initialize Firebase app
const app = initializeApp(firebaseConfig);

// Auth — persist session in localStorage so token refresh survives page reloads
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

// Firestore — use experimentalForceLongPolling to avoid QUIC/WebSocket failures
// (fixes ERR_QUIC_PROTOCOL_ERROR and ERR_CONNECTION_CLOSED at securetoken.googleapis.com)
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  experimentalAutoDetectLongPolling: true,
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// Storage
export const storage = getStorage(app);

// Analytics — guard with isSupported() to prevent ERR_TIMED_OUT on blocked networks
export let analytics = null;
isSupported().then((supported) => {
  if (supported) {
    analytics = getAnalytics(app);
  }
}).catch(() => {});

export default app;
