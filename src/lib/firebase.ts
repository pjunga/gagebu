import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, type User } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId,
);

const app = isFirebaseConfigured
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

/** Comma-separated NEXT_PUBLIC_ALLOWED_GOOGLE_EMAIL. Keep firestore.rules in sync. */
export const allowedGoogleEmails = (process.env.NEXT_PUBLIC_ALLOWED_GOOGLE_EMAIL ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export function isAllowedFirebaseUser(user: User | null): boolean {
  if (!user || !allowedGoogleEmails.length) return false;
  const usesGoogle = user.providerData.some(
    (provider) => provider.providerId === "google.com",
  );
  const email = user.email?.trim().toLowerCase() ?? "";
  return usesGoogle && allowedGoogleEmails.includes(email);
}
