import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { serverEnv } from "./env";

/**
 * Firebase Admin, initialised once per process. With the emulators configured (env.ts emulator
 * mode) the SDK talks to them without credentials; otherwise it uses the service account from env.
 */

const APP_NAME = "rewardrelay-server";

let firestore: Firestore | undefined;

export function firebaseApp(): App {
  const existing = getApps().find((app) => app.name === APP_NAME);
  if (existing) return existing;
  const env = serverEnv();
  if (env.firebaseEmulator) {
    return initializeApp({ projectId: env.FIREBASE_PROJECT_ID }, APP_NAME);
  }
  return initializeApp(
    {
      projectId: env.FIREBASE_PROJECT_ID,
      credential: cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY,
      }),
    },
    APP_NAME,
  );
}

export function adminAuth(): Auth {
  return getAuth(firebaseApp());
}

export function db(): Firestore {
  if (!firestore) {
    firestore = getFirestore(firebaseApp());
    firestore.settings({ ignoreUndefinedProperties: true });
  }
  return firestore;
}
