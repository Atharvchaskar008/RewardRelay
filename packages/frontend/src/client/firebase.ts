"use client";

import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  RecaptchaVerifier,
  connectAuthEmulator,
  getAuth,
  signInWithPhoneNumber,
  type Auth,
  type ConfirmationResult,
} from "firebase/auth";
import { authEmulatorHost, firebaseConfigured, firebaseWebConfig } from "./config";

/**
 * Firebase phone sign-in for the browser. The demo uses Firebase test phone numbers (configured in the
 * Firebase console, never in the repo); the invisible reCAPTCHA is Firebase's abuse check, not a browser
 * permission prompt.
 */

let auth: Auth | undefined;

export function firebaseAuth(): Auth | undefined {
  if (!firebaseConfigured) return undefined;
  if (!auth) {
    const app: FirebaseApp =
      getApps()[0] ??
      initializeApp({
        ...firebaseWebConfig,
        apiKey: firebaseWebConfig.apiKey || "emulator",
        projectId: firebaseWebConfig.projectId || "demo-rewardrelay",
      });
    auth = getAuth(app);
    if (authEmulatorHost)
      connectAuthEmulator(auth, `http://${authEmulatorHost}`, { disableWarnings: true });
  }
  return auth;
}

let verifier: RecaptchaVerifier | undefined;

/** Sends the OTP; `containerId` is an empty element for the invisible reCAPTCHA. */
export async function sendOtp(
  phoneNumber: string,
  containerId: string,
): Promise<ConfirmationResult> {
  const instance = firebaseAuth();
  if (!instance) throw new Error("Phone sign-in is not configured yet.");
  verifier ??= new RecaptchaVerifier(instance, containerId, { size: "invisible" });
  return signInWithPhoneNumber(instance, phoneNumber, verifier);
}

export async function signOut(): Promise<void> {
  await firebaseAuth()?.signOut();
}
