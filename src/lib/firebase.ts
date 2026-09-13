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

/**
 * Who may read and write is decided by firestore.rules alone. A second list
 * shipped in the bundle could only ever drift from it, and it protected
 * nothing: NEXT_PUBLIC_ values are readable in the served JavaScript and a
 * caller can skip this UI and reach Firestore directly. This check therefore
 * establishes identity, never authorization.
 */
export function isGoogleFirebaseUser(user: User | null): user is User {
  if (!user) return false;
  return user.providerData.some(
    (provider) => provider.providerId === "google.com",
  );
}

/**
 * Asks Firestore whether this user is allowed, instead of guessing from a
 * bundled list. The marker document is read with the same `isOwner` rule that
 * guards every collection, so a rejected read means the rules reject the
 * account. A missing document still reads successfully and is not a refusal.
 */
export async function hasFirestoreAccess(user: User): Promise<boolean> {
  if (!db) return false;
  const { doc, getDoc } = await import("firebase/firestore");
  try {
    await getDoc(doc(db, "users", user.uid, "settings", "workCategories"));
    return true;
  } catch (error) {
    if (isPermissionDenied(error)) return false;
    throw error;
  }
}

export function isPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  return code === "permission-denied" || code === "firestore/permission-denied";
}
