import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  signInAnonymously,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  linkWithPopup,
  PhoneAuthProvider
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import firebaseConfig from "../../firebase-applet-config.json";

// Initialize Firebase App and Auth once
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = getFirestore(app);

// Initialize Firebase Storage explicitly with proper bucket URL and fallbacks
const getStorageBucketUrl = (): string => {
  let bucket = firebaseConfig.storageBucket;
  if (!bucket && firebaseConfig.projectId) {
    bucket = `${firebaseConfig.projectId}.firebasestorage.app`;
  }
  if (bucket && !bucket.startsWith("gs://")) {
    return `gs://${bucket}`;
  }
  return bucket || "";
};

export const storage = getStorage(app, getStorageBucketUrl() || undefined);

export const provider = new GoogleAuthProvider();

// Scopes required for Google Calendar and Gmail
const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose"
];

// Add each scope to GoogleAuthProvider
SCOPES.forEach(scope => provider.addScope(scope));

let isSigningIn = false;
let cachedAccessToken: string | null = typeof window !== "undefined" ? localStorage.getItem("workspace_access_token") : null;

// Initialize auth state listener
export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
    } else {
      cachedAccessToken = null;
      if (typeof window !== "undefined") {
        localStorage.removeItem("workspace_access_token");
      }
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Sign in with Google Popup
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Failed to get access token from Google Auth");
    }

    cachedAccessToken = credential.accessToken;
    if (typeof window !== "undefined") {
      localStorage.setItem("workspace_access_token", cachedAccessToken);
    }
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error("Sign in error:", error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

// Email / Password signup
export const emailSignUp = async (email: string, password: string, displayName: string): Promise<User> => {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(result.user, { displayName });
    return result.user;
  } catch (error: any) {
    console.error("Email signup error:", error);
    throw error;
  }
};

// Email / Password signin
export const emailSignIn = async (email: string, password: string): Promise<User> => {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return result.user;
  } catch (error: any) {
    console.error("Email signin error:", error);
    throw error;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

// Continue as Guest (Anonymous Authentication)
export const guestSignIn = async (): Promise<User> => {
  try {
    const result = await signInAnonymously(auth);
    return result.user;
  } catch (error: any) {
    console.error("Anonymous login error:", error);
    throw error;
  }
};

// Link Anonymous Guest to Google Account
export const linkGuestToGoogle = async (): Promise<{ user: User; accessToken: string }> => {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error("No guest user is currently signed in.");
    
    const result = await linkWithPopup(currentUser, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Failed to get Google access token after linking.");
    }
    
    cachedAccessToken = credential.accessToken;
    if (typeof window !== "undefined") {
      localStorage.setItem("workspace_access_token", cachedAccessToken);
    }
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error("Link guest to Google error:", error);
    throw error;
  }
};

// Send Phone OTP
export const sendPhoneOTP = async (phoneNumber: string, recaptchaVerifier: any) => {
  try {
    const confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifier);
    return confirmationResult;
  } catch (error: any) {
    console.error("Phone OTP send error:", error);
    throw error;
  }
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
  if (typeof window !== "undefined") {
    localStorage.removeItem("workspace_access_token");
  }
};
