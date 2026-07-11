import { 
  collection, 
  doc, 
  setDoc, 
  getDoc,
  getDocs, 
  deleteDoc, 
  query, 
  orderBy,
  writeBatch
} from "firebase/firestore";
import { db } from "./firebaseAuth";
import { Conversation, Message } from "../types";

// Helper to safely convert any firestore/string date back to a standard JavaScript Date object
const toDate = (val: any): Date => {
  if (!val) return new Date();
  if (typeof val.toDate === "function") return val.toDate(); // Firestore Timestamp
  if (val instanceof Date) return val;
  if (typeof val === "string" || typeof val === "number") return new Date(val);
  return new Date();
};

/**
 * Saves a conversation to Firestore under the user's subcollection:
 * users/{uid}/conversations/{conversationId}
 */
export const saveUserConversation = async (uid: string, conv: Conversation): Promise<void> => {
  if (!uid) return;
  try {
    const docRef = doc(db, "users", uid, "conversations", conv.id);
    
    // Normalize messages and convert Date objects to standard forms
    const messagesNormalized = conv.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content || "",
      timestamp: toDate(m.timestamp),
      attachments: m.attachments || []
    }));

    await setDoc(docRef, {
      id: conv.id,
      title: conv.title || "New Session",
      createdAt: toDate(conv.createdAt),
      messages: messagesNormalized,
      updatedAt: new Date()
    });
  } catch (error) {
    console.error(`Error saving conversation ${conv.id} for user ${uid}:`, error);
    throw error;
  }
};

/**
 * Deletes a conversation from Firestore for the user
 */
export const deleteUserConversation = async (uid: string, convId: string): Promise<void> => {
  if (!uid || !convId) return;
  try {
    const docRef = doc(db, "users", uid, "conversations", convId);
    await deleteDoc(docRef);
  } catch (error) {
    console.error(`Error deleting conversation ${convId} for user ${uid}:`, error);
    throw error;
  }
};

/**
 * Loads all conversations for a specific user from Firestore
 */
export const getUserConversations = async (uid: string): Promise<Conversation[]> => {
  if (!uid) return [];
  try {
    const colRef = collection(db, "users", uid, "conversations");
    const q = query(colRef, orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);
    
    const conversations: Conversation[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      
      const messages: Message[] = (data.messages || []).map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content || "",
        timestamp: toDate(m.timestamp),
        attachments: m.attachments || []
      }));

      conversations.push({
        id: data.id || docSnap.id,
        title: data.title || "Untitled Session",
        createdAt: toDate(data.createdAt),
        messages: messages
      });
    });

    // Ensure we sort by createdAt descending just in case query ordering had issues
    return conversations.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } catch (error) {
    console.error(`Error loading conversations for user ${uid}:`, error);
    throw error;
  }
};

/**
 * Transfers all conversations from an anonymous UID to a Google UID
 */
export const transferUserConversations = async (fromUid: string, toUid: string): Promise<void> => {
  if (!fromUid || !toUid || fromUid === toUid) return;
  try {
    const fromColRef = collection(db, "users", fromUid, "conversations");
    const snapshot = await getDocs(fromColRef);
    if (snapshot.empty) return;

    const batch = writeBatch(db);
    
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const targetDocRef = doc(db, "users", toUid, "conversations", docSnap.id);
      
      // Copy to new location
      batch.set(targetDocRef, {
        ...data,
        updatedAt: new Date()
      });
      
      // Delete old document
      const sourceDocRef = doc(db, "users", fromUid, "conversations", docSnap.id);
      batch.delete(sourceDocRef);
    });

    await batch.commit();
    console.log(`Successfully transferred conversations from ${fromUid} to ${toUid}`);
  } catch (error) {
    console.error(`Error transferring conversations from ${fromUid} to ${toUid}:`, error);
    throw error;
  }
};

/**
 * Registers/updates a user inside the global users_directory collection
 */
export const registerUserInDirectory = async (
  uid: string, 
  email: string | null, 
  displayName: string | null, 
  isAnonymous: boolean
): Promise<void> => {
  if (!uid) return;
  try {
    const docRef = doc(db, "users_directory", uid);
    const resolvedEmail = email || "anonymous@guest.local";
    const resolvedRole = resolvedEmail === "prathamjangra37@gmail.com" ? "Developer" : "Member";
    await setDoc(docRef, {
      uid,
      email: resolvedEmail,
      displayName: displayName || "Guest User",
      isAnonymous: isAnonymous,
      role: resolvedRole,
      lastLogin: new Date()
    }, { merge: true });
  } catch (error) {
    console.error(`Error registering user ${uid} in directory:`, error);
  }
};

/**
 * Gets all registered users from users_directory
 */
export const getAllUsersFromDirectory = async (): Promise<any[]> => {
  try {
    const colRef = collection(db, "users_directory");
    const snapshot = await getDocs(colRef);
    const users: any[] = [];
    snapshot.forEach((d) => {
      const data = d.data();
      users.push({
        uid: data.uid || d.id,
        email: data.email || "anonymous@guest.local",
        displayName: data.displayName || "Guest User",
        isAnonymous: data.isAnonymous || false,
        role: data.role || "Member",
        lastLogin: data.lastLogin ? toDate(data.lastLogin) : new Date()
      });
    });
    return users;
  } catch (error) {
    console.error("Error getting users directory:", error);
    return [];
  }
};

/**
 * Admin: simulated updates on users
 */
export const adminUpdateUserMetadata = async (uid: string, data: any): Promise<void> => {
  if (!uid) return;
  try {
    const docRef = doc(db, "users_directory", uid);
    await setDoc(docRef, data, { merge: true });
  } catch (error) {
    console.error(`Error updating user metadata for ${uid}:`, error);
    throw error;
  }
};

/**
 * Retrieves the user's custom profile from their users_directory document.
 */
export const getUserProfile = async (uid: string): Promise<any> => {
  if (!uid) return null;
  try {
    const docRef = doc(db, "users_directory", uid);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data();
    }
    return null;
  } catch (error) {
    console.error(`Error getting user profile for ${uid}:`, error);
    return null;
  }
};

/**
 * Saves/updates a user's profile fields in Firestore.
 */
export const saveUserProfile = async (
  uid: string,
  profile: { displayName?: string; bio?: string; photoURL?: string }
): Promise<void> => {
  if (!uid) return;
  try {
    const docRef = doc(db, "users_directory", uid);
    await setDoc(docRef, {
      ...profile,
      updatedAt: new Date()
    }, { merge: true });
  } catch (error) {
    console.error(`Error saving user profile for ${uid}:`, error);
    throw error;
  }
};

