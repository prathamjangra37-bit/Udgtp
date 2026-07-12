import { initializeApp, getApps, App } from "firebase-admin/app";
import { getFirestore, Firestore, FieldValue } from "firebase-admin/firestore";
import { getAuth, Auth, UserRecord } from "firebase-admin/auth";
import { GoogleGenAI } from "@google/genai";
import firebaseConfig from "../../firebase-applet-config.json";

// Initialize Firebase Admin dynamically using local configurations or ADC
let dbAdmin: Firestore;
let authAdmin: Auth;

export function initFirebaseAdmin() {
  if (getApps().length === 0) {
    const projectId = firebaseConfig.projectId || process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;

    if (!projectId) {
      console.warn("Firebase Project ID not found in firebase-applet-config.json or environment.");
    }

    initializeApp({
      projectId: projectId
    });
    console.log("Firebase Admin SDK successfully initialized for project:", projectId);
  }
  
  dbAdmin = getFirestore();
  authAdmin = getAuth();
}

// Helper to lazily initialize Firebase Admin only when needed
function ensureFirebaseAdmin() {
  if (!dbAdmin || !authAdmin) {
    initFirebaseAdmin();
  }
}

/**
 * Gets or creates a Firebase Auth user based on their WhatsApp phone number.
 * This links Meta WhatsApp users directly with the secure Firebase Auth ecosystem.
 */
export async function getOrCreateFirebaseUserByPhone(phone: string, displayName: string | null): Promise<UserRecord> {
  ensureFirebaseAdmin();
  // Ensure the phone number conforms to E.164 format (starts with +)
  const formattedPhone = phone.startsWith("+") ? phone : `+${phone}`;
  
  try {
    const userRecord = await authAdmin.getUserByPhoneNumber(formattedPhone);
    return userRecord;
  } catch (err: any) {
    if (err.code === "auth/user-not-found") {
      console.log(`User not found for phone ${formattedPhone}. Creating a new Firebase Authentication profile...`);
      const newUser = await authAdmin.createUser({
        phoneNumber: formattedPhone,
        displayName: displayName || "WhatsApp User",
        disabled: false
      });
      return newUser;
    }
    throw err;
  }
}

/**
 * Registers or updates a user record in the global users_directory collection.
 * This makes the user visible to the Admin panel and aligns with existing schemas.
 */
export async function syncUserInDirectory(uid: string, phone: string, displayName: string | null) {
  ensureFirebaseAdmin();
  const formattedPhone = phone.startsWith("+") ? phone : `+${phone}`;
  const docRef = dbAdmin.collection("users_directory").doc(uid);
  
  // Developer check
  const isDev = formattedPhone === "+918168233737" || formattedPhone === "+919812404040"; // Custom developer phone support
  const role = isDev ? "Developer" : "Member";

  await docRef.set({
    uid,
    email: `${phone}@whatsapp.local`, // Custom derived email for WhatsApp users
    displayName: displayName || "WhatsApp User",
    isAnonymous: false,
    role,
    lastLogin: FieldValue.serverTimestamp(),
    lastActivePlatform: "WhatsApp",
    phoneNumber: formattedPhone
  }, { merge: true });
}

/**
 * Saves or updates conversation history inside the user's Firestore subcollection:
 * users/{uid}/conversations/whatsapp_session
 */
export async function loadWhatsAppConversation(uid: string) {
  ensureFirebaseAdmin();
  const convRef = dbAdmin
    .collection("users")
    .doc(uid)
    .collection("conversations")
    .doc("whatsapp_session");

  const docSnap = await convRef.get();
  
  if (docSnap.exists) {
    const data = docSnap.data() || {};
    return {
      messages: data.messages || [],
      title: data.title || "WhatsApp Chat with JX AI",
      createdAt: data.createdAt ? (typeof data.createdAt.toDate === "function" ? data.createdAt.toDate() : new Date(data.createdAt)) : new Date()
    };
  }

  return {
    messages: [],
    title: "WhatsApp Chat with JX AI",
    createdAt: new Date()
  };
}

export async function saveWhatsAppConversation(uid: string, messages: any[], title: string, createdAt: Date) {
  ensureFirebaseAdmin();
  const convRef = dbAdmin
    .collection("users")
    .doc(uid)
    .collection("conversations")
    .doc("whatsapp_session");

  await convRef.set({
    id: "whatsapp_session",
    title,
    createdAt,
    messages: messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content || "",
      timestamp: m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp)
    })),
    updatedAt: FieldValue.serverTimestamp()
  });
}

/**
 * Send messages back to the user via the official Meta WhatsApp Cloud API.
 */
export async function sendWhatsAppTextMessage(
  phoneId: string,
  toPhone: string,
  text: string,
  accessToken: string
) {
  const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
  
  console.log(`Sending WhatsApp message to ${toPhone} from Phone ID ${phoneId}...`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toPhone,
      type: "text",
      text: {
        preview_url: false,
        body: text
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`WhatsApp Cloud API returned error (HTTP ${response.status}):`, errText);
    throw new Error(`WhatsApp API error: ${errText}`);
  }

  const result = await response.json();
  console.log("WhatsApp message sent successfully:", result);
  return result;
}

/**
 * Clean up text returned by the LLM into WhatsApp-compatible formatting.
 * For example, converts Markdown headers (###) to WhatsApp *bold*.
 */
export function formatTextForWhatsApp(text: string): string {
  if (!text) return "";

  let cleaned = text;

  // 1. Replace Markdown Headers (### Header, ## Header, # Header) with *Header*
  cleaned = cleaned.replace(/^(?:#{1,6})\s+(.+)$/gm, "*$1*");

  // 2. Clean up list check-boxes (e.g., - [ ] Item -> • Item)
  cleaned = cleaned.replace(/^\s*-\s*\[\s*[xX ]?\s*\]\s+(.+)$/gm, "• $1");

  // 3. Simple list bullet clean-ups
  cleaned = cleaned.replace(/^\s*-\s+(.+)$/gm, "• $1");

  // 4. Ensure bold formatting doesn't have redundant double-stars (**bold** -> *bold*)
  cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, "*$1*");

  // 5. Trim extra blank lines (allow at most 2 consecutive newlines)
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  return cleaned.trim();
}
