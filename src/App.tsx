import React, { useState, useEffect, useRef } from "react";
import { 
  Send, 
  Trash2, 
  Laugh, 
  Briefcase, 
  Sprout, 
  Utensils, 
  Menu, 
  X, 
  Clock, 
  Sparkles, 
  MessageSquare, 
  RotateCcw, 
  AlertCircle,
  Plus,
  Settings as SettingsIcon,
  User as UserIcon,
  Copy,
  Check,
  StopCircle,
  Moon,
  Sun,
  Globe,
  Compass,
  Info,
  Search,
  Pencil,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Paperclip,
  Image as ImageIcon,
  FileText,
  Download,
  Wifi,
  WifiOff,
  HelpCircle,
  Mail,
  Calendar,
  LogOut,
  Terminal,
  ShieldAlert,
  Activity,
  Share,
  Database,
  Cpu,
  Layers,
  Users,
  Lock,
  Unlock,
  BookOpen,
  RefreshCw
} from "lucide-react";
import { SUGGESTIONS, PRINCIPLES } from "./data";
import { Message, Conversation, Attachment } from "./types";
import { MarkdownView } from "./components/MarkdownView";
import { TypewriterView } from "./components/TypewriterView";
import { motion, AnimatePresence } from "motion/react";

const JX_FALLBACK_SVG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' width='100' height='100'><rect width='100' height='100' rx='30' fill='%2309090b'/><circle cx='50' cy='50' r='35' fill='none' stroke='%233b82f6' stroke-width='4' stroke-dasharray='10, 5'/><text x='50' y='58' font-family='sans-serif' font-weight='bold' font-size='32' fill='%23ffffff' text-anchor='middle'>JX</text></svg>";

import { 
  initAuth, 
  googleSignIn, 
  logout, 
  emailSignUp, 
  emailSignIn,
  guestSignIn,
  linkGuestToGoogle,
  sendPhoneOTP,
  auth,
  storage
} from "./lib/firebaseAuth";
import { ref, uploadBytes, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { 
  saveUserConversation, 
  deleteUserConversation, 
  getUserConversations, 
  transferUserConversations,
  registerUserInDirectory,
  getAllUsersFromDirectory,
  adminUpdateUserMetadata,
  getUserProfile,
  saveUserProfile
} from "./lib/firestoreService";

// Helper components for Avatars with robust built-in fallbacks
const JXLogo = ({ 
  className = "w-8 h-8", 
  roundedClass = "rounded-xl",
  glowClass = "shadow-[0_0_12px_rgba(59,130,246,0.3)]",
  borderClass = "border border-zinc-800",
  bgClass = "bg-black"
}: { 
  className?: string; 
  roundedClass?: string;
  glowClass?: string;
  borderClass?: string;
  bgClass?: string;
}) => {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <div className={`flex items-center justify-center shrink-0 ${className} ${roundedClass} ${bgClass} ${borderClass} ${glowClass} text-blue-400`}>
        <Sparkles className="w-1/2 h-1/2 text-blue-400 animate-pulse" />
      </div>
    );
  }

  return (
    <img 
      src="/favicon.png" 
      alt="JX AI" 
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={`object-contain shrink-0 ${className} ${roundedClass} ${bgClass} ${borderClass} ${glowClass}`} 
    />
  );
};

const UserAvatar = ({ 
  className = "w-8 h-8 md:w-9 md:h-9", 
  photoUrl = "", 
  name = "" 
}: { 
  className?: string; 
  photoUrl?: string; 
  name?: string;
}) => {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [photoUrl]);

  if (photoUrl && !hasError) {
    return (
      <img
        src={photoUrl}
        alt={name || "User"}
        referrerPolicy="no-referrer"
        onError={() => setHasError(true)}
        className={`${className} rounded-full object-cover shrink-0 border border-zinc-750 shadow-sm`}
      />
    );
  }

  return (
    <div className={`${className} rounded-full bg-gradient-to-br from-zinc-850 to-zinc-950 border border-zinc-800 flex items-center justify-center shrink-0 shadow-sm`}>
      <UserIcon className="w-[45%] h-[45%] text-zinc-400" />
    </div>
  );
};

// Image Compression using HTML5 Canvas API (efficient client-side, zero external packages)
const compressImage = (file: File, maxWidth = 350, maxHeight = 350, quality = 0.85): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas 2D context not available"));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error("Compression failed"));
            }
          },
          "image/jpeg",
          quality
        );
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

// Automatic retry for asynchronous tasks
async function retryUpload<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (retries <= 1) throw err;
    console.warn(`Upload attempt failed. Retrying in ${delay}ms... (${retries - 1} retries left)`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return retryUpload(fn, retries - 1, delay * 1.5);
  }
}

// Uploads a blob to Firebase Storage and reports raw progress
const uploadToStorageWithProgress = (
  storageRef: any, 
  blob: Blob, 
  onProgress: (progress: number) => void
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const uploadTask = uploadBytesResumable(storageRef, blob);
    uploadTask.on(
      "state_changed",
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        onProgress(progress);
      },
      (error) => {
        reject(error);
      },
      async () => {
        try {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          resolve(downloadURL);
        } catch (err) {
          reject(err);
        }
      }
    );
  });
};
import { 
  listCalendarEvents, 
  createCalendarEvent, 
  deleteCalendarEvent, 
  listGmailMessages, 
  sendGmailEmail, 
  deleteGmailMessage,
  fetchGmailMessage
} from "./lib/workspaceService";

export default function App() {
  // Navigation / Tabs: "chat" | "calendar" | "gmail" | "profile" | "settings" | "help" | "developer"
  const [activeTab, setActiveTab] = useState<"chat" | "calendar" | "gmail" | "profile" | "settings" | "help" | "developer">("chat");

  // Google Workspace Integration States
  const [workspaceToken, setWorkspaceToken] = useState<string | null>(null);
  const [workspaceUser, setWorkspaceUser] = useState<any | null>(null);
  const [workspaceAuthNeedsClick, setWorkspaceAuthNeedsClick] = useState<boolean>(false);
  const [workspaceAuthLoading, setWorkspaceAuthLoading] = useState<boolean>(false);
  const [workspaceAuthError, setWorkspaceAuthError] = useState<string | null>(null);
  const [isInitializingAuth, setIsInitializingAuth] = useState<boolean>(true);

  // General Firebase Auth States
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const isDeveloper = currentUser?.email === "prathamjangra37@gmail.com";
  const [authMode, setAuthMode] = useState<"signin" | "signup" | "phone">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authDisplayName, setAuthDisplayName] = useState("");
  const [appAuthError, setAppAuthError] = useState<string | null>(null);
  const [appAuthLoading, setAppAuthLoading] = useState<boolean>(false);

  // Phone OTP States
  const [phoneStep, setPhoneStep] = useState<"enter-phone" | "enter-otp">("enter-phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [confirmationResult, setConfirmationResult] = useState<any>(null);
  const recaptchaVerifierRef = useRef<any>(null);
  
  // Calendar States
  const [calendarEvents, setCalendarEvents] = useState<any[]>([]);
  const [calendarLoading, setCalendarLoading] = useState<boolean>(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  
  // Calendar scheduling form states
  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventDate, setNewEventDate] = useState("");
  const [newEventStartTime, setNewEventStartTime] = useState("");
  const [newEventEndTime, setNewEventEndTime] = useState("");
  const [newEventDesc, setNewEventDesc] = useState("");
  const [newEventLocation, setNewEventLocation] = useState("");
  const [isSchedulingEvent, setIsSchedulingEvent] = useState(false);

  // Gmail States
  const [gmailEmails, setGmailEmails] = useState<any[]>([]);
  const [gmailLoading, setGmailLoading] = useState<boolean>(false);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const [gmailQuery, setGmailQuery] = useState("");
  
  // Gmail modal / details states
  const [selectedEmail, setSelectedEmail] = useState<any | null>(null);
  const [isComposingEmail, setIsComposingEmail] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");

  // Multi-session State
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  // Search & Rename States
  const [searchQuery, setSearchQuery] = useState("");
  const [editingConvId, setEditingConvId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  // Voice States
  const [isListening, setIsListening] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  // File Upload & Attachment States
  const [stagedAttachments, setStagedAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Input & Engine states
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  // User Profile States
  const [userName, setUserName] = useState(() => localStorage.getItem("jx_ai_profile_name") || "");
  const [userEmail, setUserEmail] = useState(() => localStorage.getItem("jx_ai_profile_email") || "");
  const [userBio, setUserBio] = useState("");
  const [userPhotoURL, setUserPhotoURL] = useState(() => localStorage.getItem("jx_ai_profile_photo") || "");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoUploadProgress, setPhotoUploadProgress] = useState<number | null>(null);

  // Settings states
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [language, setLanguage] = useState<"English" | "Hinglish" | "Hindi">("Hinglish");

  // Copy states
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Voice read-aloud toggle state
  const [isVoiceOn, setIsVoiceOn] = useState(() => localStorage.getItem("jx_ai_voice_on") === "true");

  // Image Generation States
  const [isGenerateImageMode, setIsGenerateImageMode] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState<"1:1" | "16:9" | "4:3" | "9:16">("1:1");
  const [showImagePremiumModal, setShowImagePremiumModal] = useState(false);

  // Developer Console States
  const [devSystemInstruction, setDevSystemInstruction] = useState("You are a professional development assistant.");
  const [devPrompt, setDevPrompt] = useState("Write a high-performance bubble sort function in TypeScript.");
  const [devModel, setDevModel] = useState("gemini-3.5-flash");
  const [devTemp, setDevTemp] = useState(0.7);
  const [devResult, setDevResult] = useState("");
  const [devPlaygroundLoading, setDevPlaygroundLoading] = useState(false);
  const [devLatency, setDevLatency] = useState<number | null>(null);
  const [devLatencyTesting, setDevLatencyTesting] = useState(false);
  const [devLogs, setDevLogs] = useState<Array<{ time: string; type: string; msg: string }>>([
    { time: new Date().toLocaleTimeString(), type: "info", msg: "Developer match authorized securely: prathamjangra37@gmail.com" },
    { time: new Date().toLocaleTimeString(), type: "success", msg: "Firebase Authentication context synced with developer role." },
    { time: new Date().toLocaleTimeString(), type: "system", msg: "Gemini Imagen endpoint active at /api/generate-image with Bypass permissions." },
  ]);

  // Developer Console Sub-Tabs & User Search
  const [devSubTab, setDevSubTab] = useState<"admin" | "users" | "playground" | "settings" | "whatsapp">("admin");
  const [usersSearchQuery, setUsersSearchQuery] = useState("");
  const [directoryUsers, setDirectoryUsers] = useState<any[]>([]);
  const [loadingUsersDirectory, setLoadingUsersDirectory] = useState(false);

  // WhatsApp Chatbot Developer states
  const [whatsappStatus, setWhatsappStatus] = useState<any>(null);
  const [loadingWhatsappStatus, setLoadingWhatsappStatus] = useState(false);
  const [testRecipientPhone, setTestRecipientPhone] = useState("");
  const [testMessageContent, setTestMessageContent] = useState("");
  const [sendingTestMessage, setSendingTestMessage] = useState(false);
  const [testMessageResult, setTestMessageResult] = useState<{ success: boolean; msg: string } | null>(null);

  // PWA Install States
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  // Online / Offline State
  const [isOnline, setIsOnline] = useState<boolean>(typeof window !== "undefined" ? window.navigator.onLine : true);

  // References
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Initialize Workspace Authentication
  useEffect(() => {
    let fired = false;
    
    // Backup safety timer to prevent getting stuck on the loading screen in case of sluggish initialization
    const safetyTimer = setTimeout(() => {
      if (!fired) {
        console.warn("Auth initialization safety timeout triggered. Forcing loading screen clear.");
        setIsInitializingAuth(false);
      }
    }, 4000);

    const unsubscribe = initAuth(
      (user, token) => {
        fired = true;
        clearTimeout(safetyTimer);
        setWorkspaceToken(token);
        setWorkspaceUser(user);
        setCurrentUser(user);
        setWorkspaceAuthNeedsClick(false);
        setIsInitializingAuth(false);
        if (user.displayName) {
          setUserName(user.displayName);
          localStorage.setItem("jx_ai_profile_name", user.displayName);
        }
        if (user.email) {
          setUserEmail(user.email);
          localStorage.setItem("jx_ai_profile_email", user.email);
        }
        
        // Load custom user profile from Firestore users_directory
        getUserProfile(user.uid)
          .then((profile) => {
            if (profile) {
              if (profile.displayName) {
                setUserName(profile.displayName);
                localStorage.setItem("jx_ai_profile_name", profile.displayName);
              }
              if (profile.bio) {
                setUserBio(profile.bio);
              }
              if (profile.photoURL) {
                setUserPhotoURL(profile.photoURL);
                localStorage.setItem("jx_ai_profile_photo", profile.photoURL);
              } else {
                setUserPhotoURL("");
                localStorage.removeItem("jx_ai_profile_photo");
              }
            }
          })
          .catch((err) => console.error("Error loading profile from Firestore:", err));
        
        // Sync user profile in Firebase users_directory securely
        registerUserInDirectory(
          user.uid,
          user.email,
          user.displayName || "Guest User",
          user.isAnonymous
        ).catch((err) => console.error("Auto-sync directory error:", err));
      },
      () => {
        fired = true;
        clearTimeout(safetyTimer);
        setWorkspaceToken(null);
        setWorkspaceUser(null);
        setCurrentUser(null);
        setWorkspaceAuthNeedsClick(true);
        setIsInitializingAuth(false);
      }
    );
    return () => {
      clearTimeout(safetyTimer);
      unsubscribe();
    };
  }, []);

  // Auto-fetch data based on activeTab
  useEffect(() => {
    if (!workspaceToken) return;

    if (activeTab === "calendar") {
      fetchUpcomingEvents();
    } else if (activeTab === "gmail") {
      fetchRecentEmails();
    }
  }, [activeTab, workspaceToken]);

  // Load User Directory for Developer User Management Panel
  const fetchUsersDirectory = async () => {
    setLoadingUsersDirectory(true);
    try {
      const users = await getAllUsersFromDirectory();
      setDirectoryUsers(users);
      setDevLogs((prev) => [
        { time: new Date().toLocaleTimeString(), type: "success", msg: `Fetched ${users.length} registered user records from users_directory.` },
        ...prev
      ]);
    } catch (err: any) {
      setDevLogs((prev) => [
        { time: new Date().toLocaleTimeString(), type: "error", msg: `Failed to fetch users directory: ${err.message}` },
        ...prev
      ]);
    } finally {
      setLoadingUsersDirectory(false);
    }
  };

  useEffect(() => {
    if (activeTab === "developer" && isDeveloper) {
      fetchUsersDirectory();
    }
  }, [activeTab, isDeveloper]);

  const fetchWhatsappStatus = async () => {
    setLoadingWhatsappStatus(true);
    try {
      const response = await fetch("/api/developer/whatsapp/status", {
        headers: {
          "x-user-email": "prathamjangra37@gmail.com"
        }
      });
      if (response.ok) {
        const data = await response.json();
        setWhatsappStatus(data);
      } else {
        console.error("Failed to load WhatsApp status");
      }
    } catch (err) {
      console.error("Error fetching WhatsApp status:", err);
    } finally {
      setLoadingWhatsappStatus(false);
    }
  };

  useEffect(() => {
    if (activeTab === "developer" && isDeveloper && devSubTab === "whatsapp") {
      fetchWhatsappStatus();
    }
  }, [activeTab, isDeveloper, devSubTab]);

  const handleSendTestMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testRecipientPhone) {
      setTestMessageResult({ success: false, msg: "Recipient phone number is required!" });
      return;
    }
    setSendingTestMessage(true);
    setTestMessageResult(null);

    try {
      const response = await fetch("/api/developer/whatsapp/test-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-email": "prathamjangra37@gmail.com"
        },
        body: JSON.stringify({
          toPhone: testRecipientPhone,
          message: testMessageContent
        })
      });

      const data = await response.json();
      if (response.ok && data.success) {
        setTestMessageResult({ success: true, msg: "Test message sent successfully!" });
        handleShowNotification("WhatsApp test message sent successfully!");
        setTestMessageContent("");
      } else {
        setTestMessageResult({ success: false, msg: data.error || "Failed to deliver message." });
      }
    } catch (err: any) {
      setTestMessageResult({ success: false, msg: err.message || "Network error occurred." });
    } finally {
      setSendingTestMessage(false);
    }
  };

  const fetchUpcomingEvents = async () => {
    if (!workspaceToken) return;
    setCalendarLoading(true);
    setCalendarError(null);
    try {
      const events = await listCalendarEvents(workspaceToken);
      setCalendarEvents(events);
    } catch (err: any) {
      console.error("Fetch calendar events failed:", err);
      setCalendarError(err.message || "Failed to load calendar events.");
    } finally {
      setCalendarLoading(false);
    }
  };

  const fetchRecentEmails = async (searchQ = gmailQuery) => {
    if (!workspaceToken) return;
    setGmailLoading(true);
    setGmailError(null);
    try {
      const messages = await listGmailMessages(workspaceToken, 15, searchQ);
      setGmailEmails(messages);
    } catch (err: any) {
      console.error("Fetch Gmail messages failed:", err);
      setGmailError(err.message || "Failed to load emails.");
    } finally {
      setGmailLoading(false);
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceToken) return;
    if (!newEventTitle || !newEventDate || !newEventStartTime || !newEventEndTime) {
      handleShowNotification("Kripya saare required fields bharein (Please fill all fields).");
      return;
    }

    const confirmed = window.confirm(`Are you sure you want to schedule "${newEventTitle}" in your Google Calendar?`);
    if (!confirmed) return;

    try {
      const startIso = `${newEventDate}T${newEventStartTime}:00`;
      const endIso = `${newEventDate}T${newEventEndTime}:00`;

      await createCalendarEvent(workspaceToken, {
        summary: newEventTitle,
        description: newEventDesc,
        location: newEventLocation,
        start: { dateTime: new Date(startIso).toISOString() },
        end: { dateTime: new Date(endIso).toISOString() },
      });

      handleShowNotification("Event scheduled in Google Calendar successfully!");
      setNewEventTitle("");
      setNewEventDate("");
      setNewEventStartTime("");
      setNewEventEndTime("");
      setNewEventDesc("");
      setNewEventLocation("");
      setIsSchedulingEvent(false);
      fetchUpcomingEvents();
    } catch (err: any) {
      console.error("Create event failed:", err);
      handleShowNotification(`Failed to create event: ${err.message}`);
    }
  };

  const handleDeleteEvent = async (eventId: string, summary: string) => {
    if (!workspaceToken) return;
    const confirmed = window.confirm(`Are you sure you want to delete "${summary}" from your Google Calendar?`);
    if (!confirmed) return;

    try {
      await deleteCalendarEvent(workspaceToken, eventId);
      handleShowNotification("Event deleted successfully.");
      fetchUpcomingEvents();
    } catch (err: any) {
      console.error("Delete event failed:", err);
      handleShowNotification(`Failed to delete event: ${err.message}`);
    }
  };

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceToken) return;
    if (!composeTo || !composeSubject || !composeBody) {
      handleShowNotification("Kripya saare fields bharein (Please fill all fields).");
      return;
    }

    const confirmed = window.confirm(`Are you sure you want to send this email to ${composeTo}?`);
    if (!confirmed) return;

    try {
      await sendGmailEmail(workspaceToken, composeTo, composeSubject, composeBody);
      handleShowNotification("Email sent successfully!");
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
      setIsComposingEmail(false);
      fetchRecentEmails();
    } catch (err: any) {
      console.error("Send email failed:", err);
      handleShowNotification(`Failed to send email: ${err.message}`);
    }
  };

  const handleDeleteEmail = async (messageId: string, subject: string) => {
    if (!workspaceToken) return;
    const confirmed = window.confirm(`Are you sure you want to move "${subject}" to Trash?`);
    if (!confirmed) return;

    try {
      await deleteGmailMessage(workspaceToken, messageId);
      handleShowNotification("Email moved to Trash.");
      if (selectedEmail?.id === messageId) {
        setSelectedEmail(null);
      }
      fetchRecentEmails();
    } catch (err: any) {
      console.error("Trash email failed:", err);
      handleShowNotification(`Failed to move email: ${err.message}`);
    }
  };

  const handleWorkspaceLogin = async () => {
    if (workspaceAuthLoading) return;
    setWorkspaceAuthLoading(true);
    setWorkspaceAuthError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setWorkspaceToken(result.accessToken);
        setWorkspaceUser(result.user);
        setWorkspaceAuthNeedsClick(false);
        if (result.user.displayName) setUserName(result.user.displayName);
        if (result.user.email) setUserEmail(result.user.email);
        handleShowNotification("Google Workspace connected successfully!");
        if (activeTab === "calendar") {
          fetchUpcomingEvents();
        } else if (activeTab === "gmail") {
          fetchRecentEmails();
        }
      }
    } catch (err: any) {
      console.error("Google login failed:", err);
      if (
        err.code === "auth/popup-closed-by-user" || 
        err.code === "auth/cancelled-popup-request" || 
        err.message?.includes("popup-closed-by-user") || 
        err.message?.includes("closed-by-user") || 
        err.message?.includes("popup")
      ) {
        setWorkspaceAuthError("IFRAME_POPUP_CLOSED");
      } else {
        setWorkspaceAuthError(err.message || String(err));
      }
      handleShowNotification(`Connection failed: ${err.message || err}`);
    } finally {
      setWorkspaceAuthLoading(false);
    }
  };

  const handleWorkspaceLogout = async () => {
    try {
      await logout();
      setWorkspaceToken(null);
      setWorkspaceUser(null);
      setCurrentUser(null);
      setWorkspaceAuthNeedsClick(true);
      setUserName("");
      setUserEmail("");
      localStorage.removeItem("jx_ai_profile_name");
      localStorage.removeItem("jx_ai_profile_email");
      localStorage.removeItem("workspace_access_token");
      handleShowNotification("Workspace disconnected successfully.");
    } catch (err: any) {
      console.error("Google logout failed:", err);
    }
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail || !authPassword) {
      setAppAuthError("Please fill in all fields.");
      return;
    }
    setAppAuthLoading(true);
    setAppAuthError(null);
    try {
      const user = await emailSignIn(authEmail, authPassword);
      setCurrentUser(user);
      if (user.displayName) setUserName(user.displayName);
      if (user.email) setUserEmail(user.email);
      handleShowNotification("Logged in successfully!");
    } catch (err: any) {
      console.error("Email sign-in failed:", err);
      // Simplify Firebase error messages
      let msg = err.message || String(err);
      if (err.code === "auth/invalid-credential") {
        msg = "Invalid email or password. Please try again.";
      } else if (err.code === "auth/invalid-email") {
        msg = "The email address is not valid.";
      } else if (err.code === "auth/user-not-found") {
        msg = "No account found with this email. Please sign up.";
      } else if (err.code === "auth/wrong-password") {
        msg = "Incorrect password.";
      }
      setAppAuthError(msg);
    } finally {
      setAppAuthLoading(false);
    }
  };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail || !authPassword || !authDisplayName) {
      setAppAuthError("Please fill in all fields.");
      return;
    }
    if (authPassword !== authConfirmPassword) {
      setAppAuthError("Passwords do not match.");
      return;
    }
    if (authPassword.length < 6) {
      setAppAuthError("Password must be at least 6 characters.");
      return;
    }
    setAppAuthLoading(true);
    setAppAuthError(null);
    try {
      const user = await emailSignUp(authEmail, authPassword, authDisplayName);
      setCurrentUser(user);
      setUserName(authDisplayName);
      setUserEmail(authEmail);
      handleShowNotification("Account created and logged in successfully!");
    } catch (err: any) {
      console.error("Email sign-up failed:", err);
      let msg = err.message || String(err);
      if (err.code === "auth/email-already-in-use") {
        msg = "An account with this email already exists.";
      } else if (err.code === "auth/invalid-email") {
        msg = "The email address is not valid.";
      } else if (err.code === "auth/weak-password") {
        msg = "Password is too weak. Must be at least 6 characters.";
      }
      setAppAuthError(msg);
    } finally {
      setAppAuthLoading(false);
    }
  };

  const handleAppLogout = async () => {
    try {
      await logout();
      setCurrentUser(null);
      setWorkspaceToken(null);
      setWorkspaceUser(null);
      setWorkspaceAuthNeedsClick(true);
      setUserName("");
      setUserEmail("");
      localStorage.removeItem("jx_ai_profile_name");
      localStorage.removeItem("jx_ai_profile_email");
      localStorage.removeItem("workspace_access_token");
      handleShowNotification("Logged out successfully.");
    } catch (err: any) {
      console.error("Logout failed:", err);
    }
  };

  const handleGuestSignIn = async () => {
    setAppAuthLoading(true);
    setAppAuthError(null);
    try {
      const user = await guestSignIn();
      setCurrentUser(user);
      setUserName("Guest User");
      setUserEmail("guest@jxai.local");
      handleShowNotification("Signed in successfully as Guest!");
    } catch (err: any) {
      console.error("Guest login failed:", err);
      let msg = err.message || String(err);
      if (err.code === "auth/unauthorized-domain" || err.message?.includes("unauthorized-domain")) {
        msg = "Unauthorized Domain: This URL is not added to Firebase Authorized Domains. Please add this host (or localhost) in Firebase Auth Settings -> Authorized Domains.";
      }
      setAppAuthError(msg);
    } finally {
      setAppAuthLoading(false);
    }
  };

  const [isLinkingLoading, setIsLinkingLoading] = useState(false);
  const [linkingError, setLinkingError] = useState<string | null>(null);

  const handleLinkToGoogle = async () => {
    if (isLinkingLoading) return;
    setIsLinkingLoading(true);
    setLinkingError(null);
    try {
      const result = await linkGuestToGoogle();
      if (result) {
        setWorkspaceToken(result.accessToken);
        setWorkspaceUser(result.user);
        setCurrentUser(result.user);
        if (result.user.displayName) setUserName(result.user.displayName);
        if (result.user.email) setUserEmail(result.user.email);
        handleShowNotification("Guest account successfully upgraded and linked with Google!");
      }
    } catch (err: any) {
      console.error("Failed to link guest to Google:", err);
      if (err.code === "auth/credential-already-in-use") {
        const confirmMerge = window.confirm(
          "This Google account is already registered as a JX AI user. Would you like to sign in to that Google account and merge your guest chat history into it?"
        );
        if (confirmMerge) {
          try {
            const guestUid = currentUser?.uid;
            const loginResult = await googleSignIn();
            if (loginResult) {
              const googleUid = loginResult.user.uid;
              if (guestUid && googleUid && guestUid !== googleUid) {
                handleShowNotification("Merging guest conversations to your Google account...");
                await transferUserConversations(guestUid, googleUid);
              }
              setWorkspaceToken(loginResult.accessToken);
              setWorkspaceUser(loginResult.user);
              setCurrentUser(loginResult.user);
              if (loginResult.user.displayName) setUserName(loginResult.user.displayName);
              if (loginResult.user.email) setUserEmail(loginResult.user.email);
              handleShowNotification("Successfully logged in and merged guest history!");
            }
          } catch (mergeErr: any) {
            console.error("Merge error:", mergeErr);
            if (
              mergeErr.code === "auth/cancelled-popup-request" || 
              mergeErr.code === "auth/popup-closed-by-user" || 
              mergeErr.message?.includes("popup")
            ) {
              setLinkingError("IFRAME_POPUP_CLOSED");
              handleShowNotification("Iframe restrictions blocked the login. Click 'Open in new tab' to sign in successfully.");
            } else {
              handleShowNotification(`Merge failed: ${mergeErr.message || mergeErr}`);
            }
          }
        }
      } else if (err.code === "auth/unauthorized-domain" || err.message?.includes("unauthorized-domain")) {
        handleShowNotification("Domain not authorized in Firebase Console -> Auth -> Settings -> Authorized Domains.");
      } else if (
        err.code === "auth/cancelled-popup-request" || 
        err.code === "auth/popup-closed-by-user" || 
        err.message?.includes("popup")
      ) {
        setLinkingError("IFRAME_POPUP_CLOSED");
        handleShowNotification("Iframe restrictions blocked the popup. Click 'Open in new tab' to link successfully.");
      } else {
        handleShowNotification(`Failed to link account: ${err.message || err}`);
      }
    } finally {
      setIsLinkingLoading(false);
    }
  };

  const handleSendPhoneOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber) {
      setAppAuthError("Please enter a valid phone number.");
      return;
    }
    setAppAuthLoading(true);
    setAppAuthError(null);
    try {
      const { RecaptchaVerifier: RecaptchaVerifierClass } = await import("firebase/auth");
      if (!recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current = new RecaptchaVerifierClass(auth, "recaptcha-container", {
          size: "invisible",
          callback: (response: any) => {
            console.log("Invisible Recaptcha solved");
          },
          "expired-callback": () => {
            setAppAuthError("reCAPTCHA expired. Please request the code again.");
          }
        });
      }

      const result = await sendPhoneOTP(phoneNumber, recaptchaVerifierRef.current);
      setConfirmationResult(result);
      setPhoneStep("enter-otp");
      handleShowNotification("Verification code sent to your phone!");
    } catch (err: any) {
      console.error("Failed to send OTP:", err);
      let msg = err.message || String(err);
      if (err.code === "auth/invalid-phone-number" || err.message?.includes("invalid-phone-number")) {
        msg = "Invalid phone number format. Please use E.164 format (e.g., +1234567890).";
      } else if (err.code === "auth/unauthorized-domain" || err.message?.includes("unauthorized-domain")) {
        msg = "Unauthorized Domain: This URL is not authorized in Firebase. Please add this domain to Firebase Console -> Auth -> Settings -> Authorized Domains.";
      } else if (err.code === "auth/too-many-requests" || err.message?.includes("too-many-requests")) {
        msg = "Too many OTP requests. Please try again later.";
      }
      setAppAuthError(msg);
    } finally {
      setAppAuthLoading(false);
    }
  };

  const handleVerifyPhoneOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode) {
      setAppAuthError("Please enter the 6-digit verification code.");
      return;
    }
    setAppAuthLoading(true);
    setAppAuthError(null);
    try {
      if (!confirmationResult) {
        throw new Error("No confirmation session found. Please re-enter your phone number and request a code.");
      }
      const result = await confirmationResult.confirm(otpCode);
      const user = result.user;
      setCurrentUser(user);
      if (user.phoneNumber) {
        setUserName(`Phone User (${user.phoneNumber})`);
        setUserEmail(`${user.uid.slice(0, 8)}@phone.jxai`);
      }
      handleShowNotification("Signed in successfully via Phone!");
    } catch (err: any) {
      console.error("Failed to verify OTP:", err);
      let msg = err.message || String(err);
      if (err.code === "auth/invalid-verification-code" || err.message?.includes("invalid-verification-code")) {
        msg = "Incorrect verification code. Please check and try again.";
      } else if (err.code === "auth/code-expired" || err.message?.includes("code-expired")) {
        msg = "The verification code has expired. Please request a new one.";
      }
      setAppAuthError(msg);
    } finally {
      setAppAuthLoading(false);
    }
  };

  // Load state from LocalStorage on mount
  useEffect(() => {
    // 1. Theme loading
    const savedTheme = localStorage.getItem("jx_ai_theme") as "dark" | "light";
    if (savedTheme) {
      setTheme(savedTheme);
    }

    // 2. Language loading
    const savedLang = localStorage.getItem("jx_ai_lang") as "English" | "Hinglish" | "Hindi";
    if (savedLang) {
      setLanguage(savedLang);
    }

    // 3. Profile loading
    const savedProfileName = localStorage.getItem("jx_ai_profile_name");
    if (savedProfileName) {
      setUserName(savedProfileName);
    }

    // Conversations loading is now handled dynamically from Firestore by the currentUser effect below.

    // Live clock update
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }));
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // PWA Install Event Listeners
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      console.log("JX AI can now be installed on this device!");
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsInstalled(true);
      handleShowNotification("JX AI has been successfully installed on your device!");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    // Initial display mode check
    if (window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone) {
      setIsInstalled(true);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  // Sync online / offline events
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      handleShowNotification("You are back online. Chatting resumed!");
    };
    const handleOffline = () => {
      setIsOnline(false);
      handleShowNotification("You are offline. Connect to the internet to continue chatting.");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Sync on mount
    setIsOnline(navigator.onLine);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Switch to or retrieve current conversation messages
  const activeConversation = conversations.find((c) => c.id === activeId);
  const messages = activeConversation ? activeConversation.messages : [];

  // Load user's conversations from Firestore when currentUser changes
  const [isConversationsLoading, setIsConversationsLoading] = useState(false);

  useEffect(() => {
    if (!currentUser) return;

    const fetchUserChatHistory = async () => {
      setIsConversationsLoading(true);
      try {
        const firestoreConvs = await getUserConversations(currentUser.uid);
        if (firestoreConvs && firestoreConvs.length > 0) {
          setConversations(firestoreConvs);
          setActiveId(firestoreConvs[0].id);
        } else {
          // If no conversations exist in Firestore, check if there are local conversations
          const savedConversations = localStorage.getItem("jx_ai_conversations_v3");
          if (savedConversations) {
            try {
              const parsed = JSON.parse(savedConversations);
              if (Array.isArray(parsed) && parsed.length > 0) {
                const migrated = parsed.map((c: any) => ({
                  id: c.id || Math.random().toString(36).substring(7),
                  title: c.title || "Welcome Session",
                  createdAt: c.createdAt ? new Date(c.createdAt) : new Date(),
                  messages: (c.messages || []).map((m: any) => ({
                    id: m.id || Math.random().toString(36).substring(7),
                    role: m.role || "user",
                    content: m.content || "",
                    timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
                    attachments: m.attachments || []
                  }))
                })) as Conversation[];

                for (const conv of migrated) {
                  await saveUserConversation(currentUser.uid, conv);
                }

                setConversations(migrated);
                setActiveId(migrated[0].id);
                return;
              }
            } catch (err) {
              console.error("Failed to parse local conversations for migration:", err);
            }
          }

          // Otherwise, create a default welcome session
          const defaultId = Math.random().toString(36).substring(7);
          const defaultConv: Conversation = {
            id: defaultId,
            title: "Welcome Session",
            messages: [],
            createdAt: new Date()
          };
          await saveUserConversation(currentUser.uid, defaultConv);
          setConversations([defaultConv]);
          setActiveId(defaultId);
        }
      } catch (err) {
        console.error("Failed to load user conversations from Firestore:", err);
      } finally {
        setIsConversationsLoading(false);
      }
    };

    fetchUserChatHistory();
  }, [currentUser]);

  // Save active conversation to Firestore whenever it changes
  useEffect(() => {
    if (!currentUser || isConversationsLoading) return;
    if (!activeConversation) return;

    saveUserConversation(currentUser.uid, activeConversation).catch((err) => {
      console.error("Error auto-saving active conversation to Firestore:", err);
    });
  }, [conversations, activeId, currentUser, isConversationsLoading, activeConversation]);

  // Sync conversations to LocalStorage when changed (as backup)
  useEffect(() => {
    if (conversations.length > 0) {
      localStorage.setItem("jx_ai_conversations_v3", JSON.stringify(conversations));
    } else {
      localStorage.removeItem("jx_ai_conversations_v3");
    }
    scrollToBottom();
  }, [conversations]);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  // Filter conversations based on search query (searches title or individual message content)
  const filteredConversations = conversations.filter((conv) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const titleMatch = (conv.title || "").toLowerCase().includes(q);
    const messagesMatch = conv.messages.some((m) => (m.content || "").toLowerCase().includes(q));
    return titleMatch || messagesMatch;
  });

  const handleShowNotification = (text: string) => {
    setNotification(text);
    setTimeout(() => {
      setNotification((curr) => (curr === text ? null : curr));
    }, 3500);
  };

  const handleInstallApp = async () => {
    if (!deferredPrompt) {
      handleShowNotification("To install: use your browser's share or menu options and select 'Add to Home Screen' / 'Install'.");
      return;
    }
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`JX AI Install prompt outcome: ${outcome}`);
      setDeferredPrompt(null);
    } catch (err) {
      console.error("JX AI Install prompt error:", err);
    }
  };

  const handleDevPing = async () => {
    setDevLatencyTesting(true);
    const startTime = performance.now();
    try {
      const res = await fetch("/api/developer/ping");
      const duration = Math.round(performance.now() - startTime);
      if (res.ok) {
        setDevLatency(duration);
        setDevLogs((prev) => [
          { time: new Date().toLocaleTimeString(), type: "success", msg: `Latency test completed: ${duration}ms response time.` },
          ...prev
        ]);
      } else {
        throw new Error("HTTP connection check failed");
      }
    } catch (err: any) {
      setDevLogs((prev) => [
        { time: new Date().toLocaleTimeString(), type: "error", msg: `Latency test failed: ${err.message}` },
        ...prev
      ]);
    } finally {
      setDevLatencyTesting(false);
    }
  };

  const handleDevPlaygroundRun = async () => {
    if (devPlaygroundLoading) return;
    setDevPlaygroundLoading(true);
    setDevResult("");
    setDevLogs((prev) => [
      { time: new Date().toLocaleTimeString(), type: "info", msg: `Launching prompt evaluation with model ${devModel}...` },
      ...prev
    ]);
    try {
      const res = await fetch("/api/developer/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-email": currentUser?.email || ""
        },
        body: JSON.stringify({
          prompt: devPrompt,
          systemInstruction: devSystemInstruction,
          model: devModel,
          temperature: devTemp,
          email: currentUser?.email || ""
        })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Generation error");
      }
      const data = await res.json();
      setDevResult(data.text);
      setDevLogs((prev) => [
        { time: new Date().toLocaleTimeString(), type: "success", msg: `Prompt evaluated successfully with model ${data.modelUsed}.` },
        ...prev
      ]);
    } catch (err: any) {
      setDevResult(`Error: ${err.message}`);
      setDevLogs((prev) => [
        { time: new Date().toLocaleTimeString(), type: "error", msg: `Prompt evaluation failed: ${err.message}` },
        ...prev
      ]);
    } finally {
      setDevPlaygroundLoading(false);
    }
  };

  // Create a brand new empty chat session
  const handleNewChat = () => {
    if (conversations.length >= 3 && !isDeveloper) {
      setShowImagePremiumModal(true);
      handleShowNotification("Conversation Limit: Free Members are limited to 3 active sessions. Upgrade to Developer to unlock Unlimited Chats.");
      return;
    }
    const newId = Math.random().toString(36).substring(7);
    const newConv: Conversation = {
      id: newId,
      title: `Session #${conversations.length + 1}`,
      messages: [],
      createdAt: new Date()
    };
    setConversations((prev) => [newConv, ...prev]);
    setActiveId(newId);
    setActiveTab("chat");
    setError(null);
    setIsSidebarOpen(false);
    handleShowNotification("Started a new chat session.");
  };

  // Delete a specific conversation session
  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (conversations.length <= 1) {
      // Just clear current messages instead of deleting the last session
      const clearedSession = {
        id: activeId,
        title: "New Session",
        messages: [],
        createdAt: new Date()
      };
      setConversations([clearedSession]);
      setError(null);
      handleShowNotification("Cleared conversation messages.");
      if (currentUser) {
        await saveUserConversation(currentUser.uid, clearedSession);
      }
      return;
    }

    const filtered = conversations.filter((c) => c.id !== id);
    setConversations(filtered);
    if (activeId === id) {
      setActiveId(filtered[0].id);
    }
    handleShowNotification("Deleted conversation session.");
    if (currentUser) {
      try {
        await deleteUserConversation(currentUser.uid, id);
      } catch (err) {
        console.error("Failed to delete session from Firestore:", err);
      }
    }
  };

  // Stop current AI Response Generation
  const handleStopGenerating = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setLoading(false);
      handleShowNotification("Stopped response generation.");
    }
  };

  // --- VOICE SPEECH TO TEXT & TEXT TO SPEECH ---
  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      handleShowNotification("Speech recognition is not supported in this browser.");
      return;
    }
    
    // Stop speaking if active
    if (speakingMessageId) {
      window.speechSynthesis.cancel();
      setSpeakingMessageId(null);
    }

    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = language === "Hindi" ? "hi-IN" : "en-US";
    
    rec.onstart = () => {
      setIsListening(true);
      handleShowNotification("Listening... Speak now.");
    };
    
    rec.onerror = (e: any) => {
      console.error(e);
      setIsListening(false);
      handleShowNotification("Voice input error. Try again.");
    };
    
    rec.onend = () => {
      setIsListening(false);
    };
    
    rec.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      if (transcript) {
        setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
      }
    };
    
    recognitionRef.current = rec;
    rec.start();
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  };

  const handleSpeak = (messageId: string, text: string) => {
    if (speakingMessageId === messageId) {
      window.speechSynthesis.cancel();
      setSpeakingMessageId(null);
      return;
    }
    
    window.speechSynthesis.cancel(); // Stop any ongoing speech
    
    // Clean text from markdown patterns (e.g. asterisks, code blocks, hashes)
    const cleanText = text
      .replace(/\*\*?/g, "") // bold/italic
      .replace(/#+\s/g, "") // headers
      .replace(/```[\s\S]*?```/g, "[code block omitted]") // skip code blocks
      .replace(/`([^`]+)`/g, "$1") // inline code
      .trim();
      
    const utterance = new SpeechSynthesisUtterance(cleanText);
    
    const hasHindiChars = /[\u0900-\u097F]/.test(cleanText);
    utterance.lang = hasHindiChars ? "hi-IN" : "en-US";
    
    utterance.onend = () => {
      setSpeakingMessageId(null);
    };
    utterance.onerror = () => {
      setSpeakingMessageId(null);
    };
    
    setSpeakingMessageId(messageId);
    window.speechSynthesis.speak(utterance);
  };

  // --- DRAG AND DROP & FILE UPLOADS ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, forceType?: "image" | "file") => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      handleShowNotification("File size is too large. Please select a file smaller than 10MB.");
      return;
    }

    const isImage = file.type.startsWith("image/");
    const type = forceType || (isImage ? "image" : "file");

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const newAttachment: Attachment = {
        name: file.name,
        type: type,
        data: result,
        mimeType: file.type,
        size: file.size
      };
      setStagedAttachments((prev) => [...prev, newAttachment]);
      handleShowNotification(`Attached ${file.name}`);
    };

    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      const isImage = file.type.startsWith("image/");
      const type = isImage ? "image" : "file";
      
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const newAttachment: Attachment = {
          name: file.name,
          type: type,
          data: result,
          mimeType: file.type,
          size: file.size
        };
        setStagedAttachments((prev) => [...prev, newAttachment]);
        handleShowNotification(`Attached ${file.name}`);
      };
      reader.readAsDataURL(file);
    }
  };

  // --- INLINE CONVERSATION RENAMING ---
  const handleStartRename = (id: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingConvId(id);
    setEditingTitle(currentTitle);
  };

  const handleSaveRename = (id: string) => {
    if (!editingTitle.trim()) {
      setEditingConvId(null);
      return;
    }
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: editingTitle.trim() } : c))
    );
    setEditingConvId(null);
    handleShowNotification("Conversation renamed.");
  };

  const handleCancelRename = () => {
    setEditingConvId(null);
  };

  // Clear current active chat messages only
  const handleClearChat = () => {
    if (window.confirm("Are you sure you want to clear this chat history?")) {
      setConversations((prev) =>
        prev.map((c) => (c.id === activeId ? { ...c, messages: [] } : c))
      );
      setError(null);
      handleShowNotification("Chat cleared successfully.");
    }
  };

  // Share conversation details
  const handleShareChat = () => {
    if (messages.length === 0) {
      handleShowNotification("No messages to share.");
      return;
    }
    const chatTitle = activeConversation?.title || "JX AI Session";
    const shareText = `Check out my JX AI chat session: "${chatTitle}"\n\n` + 
      messages.map(m => `[${m.role === 'user' ? 'You' : 'JX AI'}]: ${m.content}`).join('\n\n') +
      `\n\n---\nCreated with JX AI - Developed by Pratham Jangra.`;
    
    navigator.clipboard.writeText(shareText);
    handleShowNotification("Chat history copied to clipboard for sharing! 🚀");
  };

  // Export conversation as TXT document
  const handleExportTXT = () => {
    if (messages.length === 0) {
      handleShowNotification("No messages to export.");
      return;
    }
    const chatTitle = activeConversation?.title || "JX AI Session";
    const fileContent = `=========================================\nJX AI WORKSPACE - CHAT EXPORT\nSession: ${chatTitle}\nDate: ${new Date().toLocaleString()}\n=========================================\n\n` + 
      messages.map(m => `[${m.role === 'user' ? 'YOU' : 'JX AI'} - ${m.timestamp.toLocaleTimeString()}]\n${m.content}\n-----------------------------------------`).join('\n\n') +
      `\n\nGenerated by JX AI — Your Premium Intelligent AI Assistant. Developed by Pratham Jangra.`;
    
    const blob = new Blob([fileContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${chatTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_export.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    handleShowNotification("Chat successfully exported as TXT file! 📝");
  };

  // Export conversation as PDF print layout
  const handleExportPDF = () => {
    if (messages.length === 0) {
      handleShowNotification("No messages to export.");
      return;
    }
    const chatTitle = activeConversation?.title || "JX AI Session";
    
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      handleShowNotification("Popup blocked! Please allow popups to export as PDF.");
      return;
    }

    const messagesHTML = messages.map(m => `
      <div class="msg-container ${m.role}">
        <div class="msg-header">${m.role === 'user' ? 'You' : 'JX AI'}</div>
        <div class="msg-time">${m.timestamp.toLocaleString()}</div>
        <div class="msg-body">${m.content.replace(/\n/g, '<br/>')}</div>
      </div>
    `).join("");

    printWindow.document.write(`
      <html>
        <head>
          <title>${chatTitle} - JX AI Export</title>
          <style>
            body {
              font-family: 'Inter', system-ui, -apple-system, sans-serif;
              color: #1f2937;
              background-color: #ffffff;
              padding: 40px;
              max-width: 800px;
              margin: 0 auto;
            }
            h1 {
              font-size: 24px;
              font-weight: 800;
              margin-bottom: 5px;
              color: #111827;
              border-bottom: 2px solid #f3f4f6;
              padding-bottom: 15px;
            }
            .meta {
              font-size: 11px;
              color: #6b7280;
              margin-bottom: 30px;
              font-family: monospace;
            }
            .msg-container {
              margin-bottom: 20px;
              padding: 15px 20px;
              border-radius: 12px;
              border: 1px solid #e5e7eb;
            }
            .msg-container.user {
              background-color: #f9fafb;
              border-left: 4px solid #3b82f6;
            }
            .msg-container.model {
              background-color: #f3f4f6;
              border-left: 4px solid #10b981;
            }
            .msg-header {
              font-weight: 700;
              font-size: 13px;
              color: #111827;
              display: inline-block;
            }
            .msg-time {
              font-size: 10px;
              color: #9ca3af;
              float: right;
              font-family: monospace;
            }
            .msg-body {
              font-size: 13.5px;
              line-height: 1.6;
              color: #374151;
              margin-top: 8px;
              white-space: pre-wrap;
            }
            .footer {
              margin-top: 50px;
              text-align: center;
              font-size: 10px;
              color: #9ca3af;
              border-top: 1px solid #f3f4f6;
              padding-top: 15px;
            }
          </style>
        </head>
        <body>
          <h1>${chatTitle}</h1>
          <div class="meta">Exported from JX AI Workspace on ${new Date().toLocaleString()}</div>
          <div class="messages">
            ${messagesHTML}
          </div>
          <div class="footer">
            Generated by JX AI — Your Premium Intelligent AI Assistant. Developed by Pratham Jangra.
          </div>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
    handleShowNotification("Initiated high-quality PDF print stream... 🖨️");
  };

  // Send message
  const handleSendMessage = async (textToSend?: string) => {
    const rawMessageText = textToSend || input;
    const trimmed = rawMessageText.trim();
    if (!trimmed && stagedAttachments.length === 0) return;

    if (!textToSend) {
      setInput("");
    }
    setError(null);
    setLoading(true);

    // Ensure we have an active conversation
    let currentId = activeId;
    let currentConversations = [...conversations];

    if (!currentId) {
      currentId = Math.random().toString(36).substring(7);
      const newConv: Conversation = {
        id: currentId,
        title: "Auto Session",
        messages: [],
        createdAt: new Date()
      };
      currentConversations = [newConv, ...currentConversations];
      setConversations(currentConversations);
      setActiveId(currentId);
    }

    const userMsg: Message = {
      id: Math.random().toString(36).substring(7),
      role: "user",
      content: isGenerateImageMode 
        ? `Generate image prompt: "${trimmed}" (Aspect Ratio: ${imageAspectRatio})` 
        : (trimmed || (stagedAttachments.length > 0 ? `Attached ${stagedAttachments.length} media file(s)` : "")),
      timestamp: new Date(),
      attachments: stagedAttachments.length > 0 ? stagedAttachments : undefined
    };
    const wasGenerateImageMode = isGenerateImageMode;
    // Turn off image mode after submitting
    setIsGenerateImageMode(false);
    setStagedAttachments([]);

    // Update messages in local state
    let targetConv = currentConversations.find((c) => c.id === currentId);
    if (!targetConv) return;

    const newMessagesList = [...targetConv.messages, userMsg];

    // If it is the first message, auto-title the session based on the text
    const shouldUpdateTitle = targetConv.messages.length === 0;
    const autoTitle = shouldUpdateTitle
      ? (trimmed ? trimmed.split(" ").slice(0, 4).join(" ") + (trimmed.split(" ").length > 4 ? "..." : "") : "New Session with Media")
      : targetConv.title;

    setConversations((prev) =>
      prev.map((c) =>
        c.id === currentId
          ? { ...c, title: autoTitle, messages: newMessagesList }
          : c
      )
    );

    try {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      if (wasGenerateImageMode) {
        // Trigger Image Generation API
        const res = await fetch("/api/generate-image", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "x-user-email": currentUser?.email || ""
          },
          body: JSON.stringify({ 
            prompt: trimmed, 
            aspectRatio: imageAspectRatio,
            email: currentUser?.email || ""
          }),
          signal: controller.signal
        });

        const contentType = res.headers.get("content-type") || "";
        let data: any = {};

        if (!res.ok) {
          let errorMessage = "Image generation failed. Please check your model support or parameters.";
          if (contentType.includes("application/json")) {
            try {
              const errData = await res.json();
              errorMessage = errData.error || errorMessage;
            } catch (jsonErr) {
              console.error("Failed to parse JSON error:", jsonErr);
            }
          } else {
            try {
              const rawText = await res.text();
              console.error("Non-JSON Server Error:", rawText);
              if (rawText && rawText.length < 200) {
                errorMessage = rawText;
              }
            } catch (textErr) {
              console.error("Failed to read raw error text:", textErr);
            }
          }
          throw new Error(errorMessage);
        }

        if (contentType.includes("application/json")) {
          try {
            data = await res.json();
          } catch (jsonErr) {
            console.error("Error parsing JSON response:", jsonErr);
            throw new Error("Received an invalid response format from the server. Expected JSON but failed to parse.");
          }
        } else {
          try {
            const rawText = await res.text();
            console.error("Non-JSON Success Response received:", rawText);
            throw new Error("Received a non-JSON response from the server. Please verify your connection.");
          } catch (textErr) {
            throw new Error("Received an empty or malformed non-JSON response from the server.");
          }
        }

        // Add model message containing the generated image as an attachment
        const modelMsg: Message = {
          id: Math.random().toString(36).substring(7),
          role: "model",
          content: `मैंने आपके लिए प्रॉम्ट **"${trimmed}"** पर एक सुंदर एआई इमेज बनाई है! (Here is the generated image for your prompt!)`,
          timestamp: new Date(),
          attachments: [
            {
              name: `ai-generated-${Date.now()}.png`,
              type: "image",
              data: data.imageUrl,
              mimeType: "image/png"
            }
          ]
        };

        setConversations((prev) =>
          prev.map((c) =>
            c.id === currentId
              ? { ...c, messages: [...newMessagesList, modelMsg] }
              : c
          )
        );
      } else {
        // Filter payload structure
        const payload = newMessagesList.map((m) => ({
          role: m.role,
          content: m.content,
          attachments: m.attachments
        }));

        // Inject active language settings into prompt dynamically
        if (payload.length > 0) {
          const lastIndex = payload.length - 1;
          payload[lastIndex].content += ` [User Preference: Respond nicely keeping settings language in mind: ${language}]`;
        }

        // Dynamically inject real-time Google Workspace data if user asks about Gmail/Calendar
        if (workspaceToken && payload.length > 0) {
          const lastIndex = payload.length - 1;
          const userQueryText = payload[lastIndex].content.toLowerCase();
          let workspaceContext = "";

          if (userQueryText.includes("email") || userQueryText.includes("gmail") || userQueryText.includes("mail") || userQueryText.includes("inbox") || userQueryText.includes("ख़त") || userQueryText.includes("मेल")) {
            try {
              const emails = await listGmailMessages(workspaceToken, 5);
              if (emails && emails.length > 0) {
                workspaceContext += `\n\n[Google Workspace Context - Recent Emails]:\n` + 
                  emails.map((e, idx) => `${idx + 1}. From: ${e.from}\n   Subject: ${e.subject}\n   Date: ${e.date}\n   Snippet: ${e.snippet}`).join("\n---\n");
              } else {
                workspaceContext += `\n\n[Google Workspace Context]: No recent emails found.`;
              }
            } catch (err) {
              console.warn("Failed to inject email context in chat:", err);
            }
          }

          if (userQueryText.includes("calendar") || userQueryText.includes("meeting") || userQueryText.includes("event") || userQueryText.includes("schedule") || userQueryText.includes("appoint") || userQueryText.includes("कैलेण्डर") || userQueryText.includes("मीटिंग")) {
            try {
              const events = await listCalendarEvents(workspaceToken, 5);
              if (events && events.length > 0) {
                workspaceContext += `\n\n[Google Workspace Context - Upcoming Calendar Events]:\n` + 
                  events.map((ev, idx) => `${idx + 1}. Event: ${ev.summary}\n   Start: ${ev.start.dateTime || ev.start.date}\n   End: ${ev.end.dateTime || ev.end.date}\n   Description: ${ev.description || "N/A"}\n   Location: ${ev.location || "N/A"}`).join("\n---\n");
              } else {
                workspaceContext += `\n\n[Google Workspace Context]: No upcoming calendar events found.`;
              }
            } catch (err) {
              console.warn("Failed to inject calendar context in chat:", err);
            }
          }

          if (workspaceContext) {
            payload[lastIndex].content += `\n\nSystem Notice: The user has authorized Google Workspace integration in JX AI. Here is their real-time live Google Workspace data related to their query. Use this data directly to respond to the user's questions accurately, professionally, and helpful, while keeping JX AI's custom persona, language guidelines, and Haryanvi-flavored or professional friendly tone intact:\n${workspaceContext}`;
          }
        }

        // Pre-insert an empty model message so typewriter can display loader & stream instantly
        const modelMsgId = Math.random().toString(36).substring(7);
        const initialModelMsg: Message = {
          id: modelMsgId,
          role: "model",
          content: "",
          timestamp: new Date()
        };

        setConversations((prev) =>
          prev.map((c) =>
            c.id === currentId
              ? { ...c, messages: [...newMessagesList, initialModelMsg] }
              : c
          )
        );

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: payload }),
          signal: controller.signal
        });

        const contentType = res.headers.get("content-type") || "";
        let replyContent = "";

        if (!res.ok) {
          let errorMessage = "The server failed to respond. Please try again.";
          if (contentType.includes("application/json")) {
            try {
              const errData = await res.json();
              errorMessage = errData.error || errorMessage;
            } catch (jsonErr) {
              console.error("Failed to parse JSON error:", jsonErr);
            }
          } else {
            try {
              const rawText = await res.text();
              console.error("Non-JSON Server Error:", rawText);
              if (rawText && rawText.length < 200) {
                errorMessage = rawText;
              }
            } catch (textErr) {
              console.error("Failed to read raw error text:", textErr);
            }
          }
          throw new Error(errorMessage);
        }

        let data: any = {};
        if (contentType.includes("application/json")) {
          try {
            data = await res.json();
          } catch (jsonErr) {
            console.error("Error parsing JSON response:", jsonErr);
            throw new Error("Received an invalid response format from the server. Expected JSON but failed to parse.");
          }
        } else {
          try {
            const rawText = await res.text();
            console.error("Non-JSON Success Response received:", rawText);
            throw new Error("Received a non-JSON response from the server. Please verify your connection.");
          } catch (textErr) {
            throw new Error("Received an empty or malformed non-JSON response from the server.");
          }
        }

        if (data.error) {
          throw new Error(data.error);
        }

        const fullReply = data.text || "";
        const chunkSize = 4;
        const delay = 8;

        for (let i = 0; i < fullReply.length; i += chunkSize) {
          if (controller.signal.aborted) {
            break;
          }
          replyContent += fullReply.substring(i, i + chunkSize);
          setConversations((prev) =>
            prev.map((c) =>
              c.id === currentId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === modelMsgId
                        ? { ...m, content: replyContent }
                        : m
                    )
                  }
                : c
            )
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        if (!controller.signal.aborted) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === currentId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === modelMsgId
                        ? { ...m, content: fullReply }
                        : m
                    )
                  }
                : c
            )
          );
          if (isVoiceOn) {
            handleSpeak(modelMsgId, fullReply);
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        console.log("Fetch aborted");
        return;
      }
      console.error(err);
      setError(err.message || "An unexpected error occurred. Please check your internet connection.");
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  // Regenerate Response
  const handleRegenerateResponse = async () => {
    if (messages.length === 0 || loading) return;

    // Check if the last message is model, if so remove it
    let workingMessages = [...messages];
    const lastMsg = workingMessages[workingMessages.length - 1];

    if (lastMsg.role === "model") {
      workingMessages.pop(); // Remove latest assistant reply
    }

    // Also verify if there is a remaining user message to request on
    if (workingMessages.length === 0) return;

    setConversations((prev) =>
      prev.map((c) => (c.id === activeId ? { ...c, messages: workingMessages } : c))
    );

    setError(null);
    setLoading(true);

    const lastUserMsg = workingMessages[workingMessages.length - 1];
    const isRegenImage = lastUserMsg && lastUserMsg.content.startsWith("Generate image prompt: ");

    try {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      if (isRegenImage) {
        // Extract the original prompt and aspect ratio
        const match = lastUserMsg.content.match(/Generate image prompt: "([\s\S]*?)" \(Aspect Ratio: (.*?)\)/);
        const originalPrompt = match ? match[1] : lastUserMsg.content;
        const ratio = match ? match[2] : "1:1";

        const res = await fetch("/api/generate-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: originalPrompt, aspectRatio: ratio }),
          signal: controller.signal
        });

        const contentType = res.headers.get("content-type") || "";
        let data: any = {};

        if (!res.ok) {
          let errorMessage = "Image generation failed.";
          if (contentType.includes("application/json")) {
            try {
              const errData = await res.json();
              errorMessage = errData.error || errorMessage;
            } catch (jsonErr) {
              console.error("Failed to parse JSON error:", jsonErr);
            }
          } else {
            try {
              const rawText = await res.text();
              console.error("Non-JSON Server Error:", rawText);
              if (rawText && rawText.length < 200) {
                errorMessage = rawText;
              }
            } catch (textErr) {
              console.error("Failed to read raw error text:", textErr);
            }
          }
          throw new Error(errorMessage);
        }

        if (contentType.includes("application/json")) {
          try {
            data = await res.json();
          } catch (jsonErr) {
            console.error("Error parsing JSON response:", jsonErr);
            throw new Error("Received an invalid response format from the server. Expected JSON but failed to parse.");
          }
        } else {
          try {
            const rawText = await res.text();
            console.error("Non-JSON Success Response received:", rawText);
            throw new Error("Received a non-JSON response from the server. Please verify your connection.");
          } catch (textErr) {
            throw new Error("Received an empty or malformed non-JSON response from the server.");
          }
        }

        const modelMsg: Message = {
          id: Math.random().toString(36).substring(7),
          role: "model",
          content: `मैंने आपके लिए प्रॉम्ट **"${originalPrompt}"** पर फिर से एक नई इमेज बनाई है! (Here is the newly generated image for your prompt!)`,
          timestamp: new Date(),
          attachments: [
            {
              name: `ai-generated-${Date.now()}.png`,
              type: "image",
              data: data.imageUrl,
              mimeType: "image/png"
            }
          ]
        };

        setConversations((prev) =>
          prev.map((c) =>
            c.id === activeId ? { ...c, messages: [...workingMessages, modelMsg] } : c
          )
        );
      } else {
        const payload = workingMessages.map((m) => ({
          role: m.role,
          content: m.content
        }));

        // Inject language instructions
        if (payload.length > 0) {
          const lastIndex = payload.length - 1;
          payload[lastIndex].content += ` [User Preference: Respond nicely in ${language}]`;
        }

        // Pre-insert empty model message
        const modelMsgId = Math.random().toString(36).substring(7);
        const initialModelMsg: Message = {
          id: modelMsgId,
          role: "model",
          content: "",
          timestamp: new Date()
        };

        setConversations((prev) =>
          prev.map((c) =>
            c.id === activeId ? { ...c, messages: [...workingMessages, initialModelMsg] } : c
          )
        );

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: payload }),
          signal: controller.signal
        });

        const contentType = res.headers.get("content-type") || "";
        let replyContent = "";

        if (!res.ok) {
          let errorMessage = "The server failed to respond.";
          if (contentType.includes("application/json")) {
            try {
              const errData = await res.json();
              errorMessage = errData.error || errorMessage;
            } catch (jsonErr) {
              console.error("Failed to parse JSON error:", jsonErr);
            }
          } else {
            try {
              const rawText = await res.text();
              console.error("Non-JSON Server Error:", rawText);
              if (rawText && rawText.length < 200) {
                errorMessage = rawText;
              }
            } catch (textErr) {
              console.error("Failed to read raw error text:", textErr);
            }
          }
          throw new Error(errorMessage);
        }

        let data: any = {};
        if (contentType.includes("application/json")) {
          try {
            data = await res.json();
          } catch (jsonErr) {
            console.error("Error parsing JSON response:", jsonErr);
            throw new Error("Received an invalid response format from the server. Expected JSON but failed to parse.");
          }
        } else {
          try {
            const rawText = await res.text();
            console.error("Non-JSON Success Response received:", rawText);
            throw new Error("Received a non-JSON response from the server. Please verify your connection.");
          } catch (textErr) {
            throw new Error("Received an empty or malformed non-JSON response from the server.");
          }
        }

        if (data.error) {
          throw new Error(data.error);
        }

        const fullReply = data.text || "";
        const chunkSize = 4;
        const delay = 8;

        for (let i = 0; i < fullReply.length; i += chunkSize) {
          if (controller.signal.aborted) {
            break;
          }
          replyContent += fullReply.substring(i, i + chunkSize);
          setConversations((prev) =>
            prev.map((c) =>
              c.id === activeId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === modelMsgId
                        ? { ...m, content: replyContent }
                        : m
                    )
                  }
                : c
            )
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        if (!controller.signal.aborted) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === activeId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === modelMsgId
                        ? { ...m, content: fullReply }
                        : m
                    )
                  }
                : c
            )
          );
        }
      }
      handleShowNotification("Response regenerated successfully.");
    } catch (err: any) {
      if (err.name === "AbortError") return;
      console.error(err);
      setError(err.message || "Failed to regenerate response.");
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  // Copy AI response to clipboard
  const handleCopyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    handleShowNotification("Copied response to clipboard!");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDownloadAttachment = (data: string, name: string) => {
    try {
      if (data.startsWith("data:")) {
        const parts = data.split(",");
        const mime = parts[0].match(/:(.*?);/)?.[1] || "image/png";
        const bstr = atob(parts[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }
        const blob = new Blob([u8arr], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        handleShowNotification("Image download started!");
      } else {
        const a = document.createElement("a");
        a.href = data;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        handleShowNotification("File download started!");
      }
    } catch (error) {
      console.error("Download failed:", error);
      handleShowNotification("Download failed, opening image in new tab instead.");
      const win = window.open();
      if (win) {
        win.document.write(`<iframe src="${data}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`);
      }
    }
  };

  const handleOpenAttachmentProperly = async (att: Attachment, index: number, msgId: string) => {
    if (att.url) {
      window.open(att.url, "_blank");
      return;
    }

    handleShowNotification("Generating proper direct link...");
    try {
      const res = await fetch("/api/register-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: att.data,
          name: att.name,
          mimeType: att.mimeType || "image/png"
        })
      });

      if (!res.ok) throw new Error("Failed to register with server");
      const data = await res.json();
      const httpUrl = data.url;

      // Update the attachment's url in local state active conversation so we don't have to re-register
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== activeId) return c;
          return {
            ...c,
            messages: c.messages.map((m) => {
              if (m.id !== msgId) return m;
              if (!m.attachments) return m;
              return {
                ...m,
                attachments: m.attachments.map((a, i) =>
                  i === index ? { ...a, url: httpUrl } : a
                )
              };
            })
          };
        })
      );

      // Open the clean, proper new link!
      window.open(httpUrl, "_blank");
      handleShowNotification("Opened proper link successfully!");
    } catch (err) {
      console.error("Failed to generate direct link dynamically:", err);
      handleShowNotification("Link generation failed. Opening fallback in new window...");
      const win = window.open();
      if (win) {
        win.document.write(`<iframe src="${att.data}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`);
      }
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem("jx_ai_profile_name", userName);
    
    if (currentUser) {
      try {
        await saveUserProfile(currentUser.uid, {
          displayName: userName,
          bio: userBio,
          photoURL: userPhotoURL
        });
        handleShowNotification("Profile successfully updated in Firestore!");
      } catch (err: any) {
        console.error("Error saving profile to Firestore:", err);
        handleShowNotification(`Offline update saved locally. Firestore error: ${err.message}`);
      }
    } else {
      handleShowNotification("Profile updated successfully (stored locally on guest account)!");
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!currentUser) {
      handleShowNotification("Please sign in or register to upload a custom profile photo.");
      return;
    }

    setUploadingPhoto(true);
    setPhotoUploadProgress(0);
    try {
      // 1. Compress the selected photo on the client side
      handleShowNotification("Compressing image for lightning-fast upload...");
      const compressedBlob = await compressImage(file, 350, 350, 0.85);
      
      // 2. Create unique reference path
      const storageRef = ref(storage, `users/${currentUser.uid}/profile_photo_${Date.now()}.jpg`);
      
      // 3. Upload with real-time progress & up to 3 automatic retries
      handleShowNotification("Uploading photo securely to Firebase Cloud...");
      const downloadURL = await retryUpload(
        () => uploadToStorageWithProgress(storageRef, compressedBlob, (p) => setPhotoUploadProgress(p)),
        3,
        1000
      );
      
      // 4. Set state, cache locally, and persist in Firestore profile
      setUserPhotoURL(downloadURL);
      localStorage.setItem("jx_ai_profile_photo", downloadURL);
      
      await saveUserProfile(currentUser.uid, {
        photoURL: downloadURL
      });

      handleShowNotification("Profile photo successfully uploaded and synchronized!");
    } catch (err: any) {
      console.warn("Firebase Storage failed (retries exhausted). Using high-res compressed local fallback:", err);
      // Fallback: Convert the already-compressed, small Blob to base64 and save to Firestore
      try {
        const compressedBlob = await compressImage(file, 350, 350, 0.85);
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64data = reader.result as string;
          setUserPhotoURL(base64data);
          localStorage.setItem("jx_ai_profile_photo", base64data);
          
          await saveUserProfile(currentUser.uid, {
            photoURL: base64data
          });
          handleShowNotification("Photo uploaded successfully using secure database fallback!");
        };
        reader.readAsDataURL(compressedBlob);
      } catch (fallbackErr: any) {
        console.error("Critical fallback upload failure:", fallbackErr);
        handleShowNotification(`Upload failed: ${fallbackErr.message || fallbackErr}`);
      }
    } finally {
      setUploadingPhoto(false);
      setPhotoUploadProgress(null);
    }
  };

  const handlePhotoDelete = async () => {
    if (!currentUser) {
      handleShowNotification("Please sign in to modify your profile photo.");
      return;
    }
    try {
      setUserPhotoURL("");
      localStorage.removeItem("jx_ai_profile_photo");
      await saveUserProfile(currentUser.uid, {
        photoURL: ""
      });
      handleShowNotification("Profile photo deleted successfully.");
    } catch (err: any) {
      console.error("Error deleting profile photo:", err);
      handleShowNotification(`Failed to delete photo: ${err.message || err}`);
    }
  };

  const handleSaveSettings = (newTheme: "dark" | "light", newLang: "English" | "Hinglish" | "Hindi") => {
    setTheme(newTheme);
    setLanguage(newLang);
    localStorage.setItem("jx_ai_theme", newTheme);
    localStorage.setItem("jx_ai_lang", newLang);
    handleShowNotification("Settings updated successfully!");
  };

  const getSuggestionIcon = (iconName: string) => {
    switch (iconName) {
      case "Laugh":
        return <Laugh className="w-4 h-4 text-zinc-400 group-hover:text-zinc-200 transition-colors shrink-0" />;
      case "Briefcase":
        return <Briefcase className="w-4 h-4 text-zinc-400 group-hover:text-zinc-200 transition-colors shrink-0" />;
      case "Sprout":
        return <Sprout className="w-4 h-4 text-zinc-400 group-hover:text-zinc-200 transition-colors shrink-0" />;
      case "Utensils":
        return <Utensils className="w-4 h-4 text-zinc-400 group-hover:text-zinc-200 transition-colors shrink-0" />;
      default:
        return <Sparkles className="w-4 h-4 text-zinc-400 group-hover:text-zinc-200 transition-colors shrink-0" />;
    }
  };

  // Determine styles dynamically based on light/dark mode
  const isDark = theme === "dark";
  const bgClass = isDark ? "bg-[#050508] text-zinc-100" : "bg-[#f4f4f5] text-zinc-900";
  const sidebarClass = isDark ? "bg-[#0a0a0d]/75 backdrop-blur-xl border-zinc-800/40" : "bg-white/85 backdrop-blur-xl border-zinc-200/80 shadow-lg";
  const cardClass = isDark ? "bg-[#0e0e12]/60 backdrop-blur-md border-zinc-800/60 shadow-[0_4px_30px_rgba(0,0,0,0.4)]" : "bg-white/90 backdrop-blur-md border-zinc-200 shadow-sm";
  const hoverCardClass = isDark ? "hover:border-zinc-700/60 hover:bg-[#121217]/70" : "hover:border-zinc-300 hover:bg-zinc-50/80";
  const headerClass = isDark ? "bg-[#07070a]/75 backdrop-blur-xl border-zinc-800/50" : "bg-white/85 backdrop-blur-xl border-zinc-200/80 shadow-sm";
  const bubbleUserClass = isDark ? "bg-blue-600/10 text-white border-blue-500/20 shadow-sm" : "bg-zinc-900 text-white border-zinc-850 shadow-sm";
  const bubbleModelClass = isDark ? "bg-[#0e0e12]/80 backdrop-blur-md text-zinc-100 border-zinc-800/60 shadow-sm" : "bg-white backdrop-blur-md text-zinc-900 border-zinc-200 shadow-sm";
  const inputBgClass = isDark ? "bg-zinc-950/50 backdrop-blur-md hover:bg-zinc-900/60 text-zinc-100 placeholder:text-zinc-500 border-zinc-800/80 focus:border-zinc-700 focus:ring-1 focus:ring-blue-500/30" : "bg-white text-zinc-900 placeholder:text-zinc-400 border-zinc-200 focus:border-zinc-400";
  const textMutedClass = isDark ? "text-zinc-400" : "text-zinc-500";
  const subBorderClass = isDark ? "border-zinc-800/40" : "border-zinc-200";

  if (isInitializingAuth) {
    return (
      <div className={`flex flex-col items-center justify-center h-screen w-full font-sans ${bgClass}`}>
        <div className="space-y-4 text-center">
          <div className="flex items-center justify-center">
            <JXLogo className="w-16 h-16" roundedClass="rounded-3xl" glowClass="shadow-[0_0_30px_rgba(59,130,246,0.35)]" />
          </div>
          <div className="space-y-1 animate-pulse">
            <h1 className="text-sm font-bold tracking-tight text-zinc-300">Loading JX AI Workspace...</h1>
            <p className="text-[10px] text-zinc-500 font-mono">Initializing secure connection</p>
          </div>
          <div className="w-24 h-1 bg-zinc-800/80 mx-auto rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{ width: '60%' }} />
          </div>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    const isDomainError = appAuthError?.toLowerCase().includes("unauthorized-domain") || appAuthError?.toLowerCase().includes("unauthorized domain");

    return (
      <div className={`flex min-h-screen w-full items-center justify-center font-sans ${bgClass} p-4 md:p-8 overflow-y-auto`}>
        {/* reCAPTCHA Invisible Element required for Phone Auth */}
        <div id="recaptcha-container" className="hidden"></div>

        <div className={`w-full max-w-md p-6 md:p-8 rounded-3xl border ${cardClass} shadow-2xl space-y-6 my-6 transition-all duration-300`}>
          
          <div className="flex flex-col items-center text-center space-y-2">
            <div className="flex items-center justify-center">
              <JXLogo className="w-16 h-16 animate-pulse" roundedClass="rounded-2xl" glowClass="shadow-[0_0_30px_rgba(59,130,246,0.35)]" />
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl font-extrabold tracking-tight text-white bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
                JX AI Workspace
              </h1>
              <p className="text-xs text-zinc-400 leading-relaxed font-sans max-w-[300px] mx-auto">
                Secure multi-session assistant with advanced cloud memory, voice commands, and Google Workspace.
              </p>
            </div>
          </div>

          {/* Mode Tabs */}
          <div className="grid grid-cols-3 p-1 rounded-xl bg-zinc-950/70 border border-zinc-800/80">
            <button
              type="button"
              onClick={() => {
                setAuthMode("signin");
                setAppAuthError(null);
              }}
              className={`py-2 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                authMode === "signin"
                  ? "bg-zinc-800 text-white shadow-md border border-zinc-700/55"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode("signup");
                setAppAuthError(null);
              }}
              className={`py-2 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                authMode === "signup"
                  ? "bg-zinc-800 text-white shadow-md border border-zinc-700/55"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Sign Up
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode("phone");
                setAppAuthError(null);
                setPhoneStep("enter-phone");
              }}
              className={`py-2 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                authMode === "phone"
                  ? "bg-zinc-800 text-white shadow-md border border-zinc-700/55"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Phone OTP
            </button>
          </div>

          {/* Form Pathways */}
          {authMode === "signin" && (
            <form onSubmit={handleEmailSignIn} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Email Address</label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className={`w-full px-4 py-3 rounded-xl border text-xs font-sans transition-all outline-none focus:ring-2 focus:ring-blue-500/20 ${inputBgClass}`}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className={`w-full px-4 py-3 rounded-xl border text-xs font-sans transition-all outline-none focus:ring-2 focus:ring-blue-500/20 ${inputBgClass}`}
                  required
                />
              </div>

              {appAuthError && (
                <div className="p-3.5 rounded-xl border border-red-500/20 bg-red-500/5 text-xs text-red-400 text-left">
                  {appAuthError}
                </div>
              )}

              <button
                type="submit"
                disabled={appAuthLoading}
                className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold font-sans transition-all duration-150 cursor-pointer shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {appAuthLoading ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-t-white border-zinc-600 animate-spin" />
                    <span>Signing In...</span>
                  </>
                ) : (
                  <span>Sign In</span>
                )}
              </button>
            </form>
          )}

          {authMode === "signup" && (
            <form onSubmit={handleEmailSignUp} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Full Name</label>
                <input
                  type="text"
                  placeholder="Your Name"
                  value={authDisplayName}
                  onChange={(e) => setAuthDisplayName(e.target.value)}
                  className={`w-full px-4 py-3 rounded-xl border text-xs font-sans transition-all outline-none focus:ring-2 focus:ring-blue-500/20 ${inputBgClass}`}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Email Address</label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className={`w-full px-4 py-3 rounded-xl border text-xs font-sans transition-all outline-none focus:ring-2 focus:ring-blue-500/20 ${inputBgClass}`}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Password</label>
                <input
                  type="password"
                  placeholder="•••••••• (Min 6 characters)"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className={`w-full px-4 py-3 rounded-xl border text-xs font-sans transition-all outline-none focus:ring-2 focus:ring-blue-500/20 ${inputBgClass}`}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Confirm Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={authConfirmPassword}
                  onChange={(e) => setAuthConfirmPassword(e.target.value)}
                  className={`w-full px-4 py-3 rounded-xl border text-xs font-sans transition-all outline-none focus:ring-2 focus:ring-blue-500/20 ${inputBgClass}`}
                  required
                />
              </div>

              {appAuthError && (
                <div className="p-3.5 rounded-xl border border-red-500/20 bg-red-500/5 text-xs text-red-400 text-left">
                  {appAuthError}
                </div>
              )}

              <button
                type="submit"
                disabled={appAuthLoading}
                className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold font-sans transition-all duration-150 cursor-pointer shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {appAuthLoading ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-t-white border-zinc-600 animate-spin" />
                    <span>Creating Account...</span>
                  </>
                ) : (
                  <span>Create Account</span>
                )}
              </button>
            </form>
          )}

          {authMode === "phone" && (
            <div className="space-y-4">
              {phoneStep === "enter-phone" ? (
                <form onSubmit={handleSendPhoneOTP} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Phone Number (E.164 Format)</label>
                    <input
                      type="tel"
                      placeholder="+1 555-019-2834"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      className={`w-full px-4 py-3 rounded-xl border text-xs font-sans transition-all outline-none focus:ring-2 focus:ring-blue-500/20 ${inputBgClass}`}
                      required
                    />
                    <p className="text-[10px] text-zinc-500">Include country code prefix (e.g. +91 for India, +1 for US).</p>
                  </div>

                  {appAuthError && (
                    <div className="p-3.5 rounded-xl border border-red-500/20 bg-red-500/5 text-xs text-red-400 text-left leading-relaxed">
                      {isDomainError ? (
                        <div className="space-y-2">
                          <p className="font-bold">🌐 Domain Not Authorized</p>
                          <p className="text-[11px] text-zinc-300">
                            Firebase Authentication has blocked this sign-in attempt because this development URL is not yet listed in your Firebase authorized domains.
                          </p>
                          <div className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-[10px] font-mono text-zinc-400 space-y-1">
                            <p className="text-zinc-200">🛠️ Quick Fix:</p>
                            <p>1. Open Firebase Console</p>
                            <p>2. Go to Auth &rarr; Settings &rarr; Authorized Domains</p>
                            <p>3. Add: <span className="text-blue-400 select-all">{window.location.hostname}</span></p>
                          </div>
                        </div>
                      ) : (
                        appAuthError
                      )}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={appAuthLoading}
                    className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold font-sans transition-all duration-150 cursor-pointer shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {appAuthLoading ? (
                      <>
                        <span className="w-4 h-4 rounded-full border-2 border-t-white border-zinc-600 animate-spin" />
                        <span>Sending SMS Code...</span>
                      </>
                    ) : (
                      <span>Send SMS Verification Code</span>
                    )}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyPhoneOTP} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">6-Digit SMS Verification Code</label>
                    <input
                      type="text"
                      maxLength={6}
                      placeholder="123456"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      className={`w-full px-4 py-3 rounded-xl border text-center text-lg font-mono tracking-[0.5em] transition-all outline-none focus:ring-2 focus:ring-blue-500/20 ${inputBgClass}`}
                      required
                    />
                    <p className="text-[10px] text-center text-zinc-500">Enter the OTP sent to your mobile device.</p>
                  </div>

                  {appAuthError && (
                    <div className="p-3.5 rounded-xl border border-red-500/20 bg-red-500/5 text-xs text-red-400 text-left">
                      {appAuthError}
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setPhoneStep("enter-phone");
                        setAppAuthError(null);
                      }}
                      className="flex-1 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold font-sans transition-all duration-150 cursor-pointer"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={appAuthLoading}
                      className="flex-[2] py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold font-sans transition-all duration-150 cursor-pointer shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {appAuthLoading ? (
                        <>
                          <span className="w-4 h-4 rounded-full border-2 border-t-white border-zinc-600 animate-spin" />
                          <span>Verifying...</span>
                        </>
                      ) : (
                        <span>Verify & Sign In</span>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Social Divider */}
          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-zinc-800/80"></div>
            </div>
            <div className="relative flex justify-center text-[10px] uppercase">
              <span className="bg-[#09090b] px-3 font-bold tracking-wider text-zinc-500">
                or continue with
              </span>
            </div>
          </div>

          {/* Google Workspace & Guest Auth blocks */}
          <div className="space-y-3">
            {workspaceAuthError && (
              <div className="p-4 rounded-2xl border border-red-500/20 bg-red-500/5 text-left space-y-3 text-xs leading-relaxed">
                {workspaceAuthError === "IFRAME_POPUP_CLOSED" ? (
                  <>
                    <p className="font-bold text-red-400 flex items-center gap-1.5">
                      <span className="text-sm">⚠️</span> Iframe Popup Blocked
                    </p>
                    <p className="text-zinc-300 text-[11px] leading-relaxed">
                      Due to browser sandbox security policies inside the AI Studio preview iframe, popup dialogs are restricted.
                    </p>
                    <div className="p-3 bg-zinc-950/50 rounded-xl border border-zinc-800/70 text-[11px] space-y-1.5 text-zinc-300">
                      <p className="font-bold text-zinc-200">🛠️ Solution:</p>
                      <ol className="list-decimal pl-4 space-y-1">
                        <li>Look at the top-right of your AI Studio environment.</li>
                        <li>Click the <strong>'Open in new tab'</strong> (pop-out ↗️) icon.</li>
                        <li>Once the app runs in its standalone tab, click <strong>'Sign In with Google'</strong> again. It will work flawlessly!</li>
                      </ol>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="font-bold text-red-400">Connection Failed</p>
                    <p className="text-zinc-300 text-[11px] font-mono">
                      {workspaceAuthError}
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Social Authentication Row */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleWorkspaceLogin}
                disabled={workspaceAuthLoading}
                className="w-full py-3.5 px-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-xs font-bold font-sans transition-all duration-150 cursor-pointer shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {workspaceAuthLoading ? (
                  <span className="w-4 h-4 rounded-full border-2 border-t-zinc-950 border-zinc-300 animate-spin" />
                ) : (
                  <>
                    <Globe className="w-4 h-4 text-zinc-950" />
                    <span className="truncate">Google</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleGuestSignIn}
                disabled={appAuthLoading}
                className="w-full py-3.5 px-2 rounded-xl bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-100 text-xs font-bold font-sans transition-all duration-150 cursor-pointer shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {appAuthLoading ? (
                  <span className="w-4 h-4 rounded-full border-2 border-t-white border-zinc-700 animate-spin" />
                ) : (
                  <>
                    <UserIcon className="w-4 h-4 text-zinc-300" />
                    <span className="truncate">Guest (Anon)</span>
                  </>
                )}
              </button>
            </div>
          </div>
          
          <p className="text-[10px] text-zinc-500 font-mono text-center">
            Fully resilient multi-channel memory. Securely powered by Firebase.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-screen w-full overflow-hidden font-sans transition-colors duration-200 ${bgClass}`}>
      
      {/* LEFT SIDEBAR - Desktop & Always Present */}
      <aside className={`hidden lg:flex w-72 shrink-0 flex-col h-full border-r transition-all duration-200 ${sidebarClass}`}>
        
        {/* Brand Header */}
        <div className={`p-5 flex items-center justify-between border-b ${subBorderClass}`}>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center">
              <JXLogo className="w-9 h-9" roundedClass="rounded-full" glowClass="shadow-[0_0_12px_rgba(59,130,246,0.3)]" bgClass="bg-black" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight text-white">JX AI</h2>
              <span className="text-[10px] text-zinc-400 font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                Active v3.5
              </span>
            </div>
          </div>
        </div>

        {/* Action: New Chat Button */}
        <div className="p-4 shrink-0 pb-2">
          <button
            onClick={handleNewChat}
            className="w-full py-3 px-4 rounded-xl border border-dashed text-sm font-semibold transition-all duration-150 active:scale-95 flex items-center justify-center gap-2 cursor-pointer bg-zinc-850/40 hover:bg-zinc-850/80 text-zinc-200 border-zinc-800 hover:border-zinc-700"
          >
            <Plus className="w-4 h-4 text-blue-400" />
            <span>New Chat Session</span>
          </button>
        </div>

        {/* PWA Install Banner in Sidebar */}
        {deferredPrompt && (
          <div className="px-4 pb-3 shrink-0">
            <button
              onClick={handleInstallApp}
              className="w-full py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center justify-between gap-2 transition-all shadow-[0_0_8px_rgba(59,130,246,0.25)] border border-blue-500 active:scale-95 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Download className="w-3.5 h-3.5 animate-bounce" />
                <span>Install JX AI App</span>
              </div>
              <span className="text-[9px] bg-blue-800 px-1.5 py-0.5 rounded text-blue-100 uppercase font-bold tracking-wider animate-pulse">Get</span>
            </button>
          </div>
        )}

        {/* Search Previous Chats */}
        <div className="px-4 pb-2 pt-1 shrink-0">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 absolute left-3 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search previous chats..."
              className={`w-full pl-8 pr-7 py-2 rounded-xl text-xs border focus:outline-none transition-all ${
                isDark 
                  ? "bg-zinc-900/50 border-zinc-800/80 text-zinc-200 focus:border-zinc-700 placeholder:text-zinc-500" 
                  : "bg-zinc-100 border-zinc-200 text-zinc-850 focus:border-zinc-350 placeholder:text-zinc-400"
              }`}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 p-0.5 rounded-full hover:bg-zinc-800 hover:text-white text-zinc-400 transition-colors"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Chat History Sessions */}
        <div className="flex-1 overflow-y-auto px-3 space-y-1 py-1">
          <div className="px-3 py-1.5 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
            Conversations History
          </div>
          {filteredConversations.length === 0 ? (
            <p className="text-xs text-zinc-500 italic px-3 py-2">
              {searchQuery ? "No matches found" : "No history yet"}
            </p>
          ) : (
            filteredConversations.map((conv) => {
              const isActive = conv.id === activeId;
              const isEditing = editingConvId === conv.id;

              if (isEditing) {
                return (
                  <div
                    key={conv.id}
                    onClick={(e) => e.stopPropagation()}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs border ${
                      isDark ? "bg-zinc-900 border-zinc-800" : "bg-white border-zinc-300"
                    }`}
                  >
                    <input
                      type="text"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveRename(conv.id);
                        if (e.key === "Escape") handleCancelRename();
                      }}
                      className="flex-1 bg-transparent border-none focus:outline-none text-xs font-semibold text-zinc-200"
                      autoFocus
                    />
                    <button
                      onClick={() => handleSaveRename(conv.id)}
                      className="p-1 rounded hover:bg-zinc-800 hover:text-blue-400 text-zinc-400 transition-all"
                      title="Save Title"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleCancelRename}
                      className="p-1 rounded hover:bg-zinc-800 hover:text-red-400 text-zinc-400 transition-all"
                      title="Cancel"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              }

              return (
                <div
                  key={conv.id}
                  onClick={() => {
                    setActiveId(conv.id);
                    setActiveTab("chat");
                  }}
                  className={`group relative w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                    isActive
                      ? isDark
                        ? "bg-zinc-900/90 text-white border border-zinc-800"
                        : "bg-zinc-900 text-white border border-zinc-800"
                      : isDark
                        ? "hover:bg-[#121215] text-zinc-400 hover:text-zinc-200 border border-transparent"
                        : "hover:bg-zinc-100 text-zinc-600 hover:text-zinc-900 border border-transparent"
                  }`}
                >
                  <MessageSquare className={`w-4 h-4 shrink-0 ${isActive ? "text-blue-400" : "text-zinc-500 group-hover:text-zinc-400"}`} />
                  <span className="flex-1 truncate pr-12 text-left">{conv.title || "Untitled Session"}</span>
                  
                  <div className="absolute right-2 opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
                    {/* Rename button */}
                    <button
                      onClick={(e) => handleStartRename(conv.id, conv.title, e)}
                      className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
                      title="Rename Chat"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>

                    {/* Delete session button */}
                    <button
                      onClick={(e) => handleDeleteSession(conv.id, e)}
                      className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-red-400 transition-colors"
                      title="Delete Conversation"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Navigation Sidebar Footer Tabs */}
        <div className={`p-3 shrink-0 border-t space-y-1.5 ${subBorderClass}`}>
          <button
            onClick={() => {
              setActiveTab("chat");
              setIsSidebarOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
              activeTab === "chat"
                ? "bg-zinc-800/80 text-white"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>AI Assistant Workspace</span>
          </button>

          <button
            onClick={() => {
              setActiveTab("calendar");
              setIsSidebarOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
              activeTab === "calendar"
                ? "bg-zinc-800/80 text-white"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Google Calendar</span>
          </button>

          <button
            onClick={() => {
              setActiveTab("gmail");
              setIsSidebarOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
              activeTab === "gmail"
                ? "bg-zinc-800/80 text-white"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
            }`}
          >
            <Mail className="w-4 h-4" />
            <span>Gmail Inbox</span>
          </button>

          <button
            onClick={() => {
              setActiveTab("profile");
              setIsSidebarOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
              activeTab === "profile"
                ? "bg-zinc-800/80 text-white"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
            }`}
          >
            <UserIcon className="w-4 h-4" />
            <span>Your Profile</span>
          </button>

          <button
            onClick={() => {
              setActiveTab("settings");
              setIsSidebarOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
              activeTab === "settings"
                ? "bg-zinc-800/80 text-white"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
            }`}
          >
            <SettingsIcon className="w-4 h-4" />
            <span>Settings Panel</span>
          </button>

          <button
            onClick={() => {
              setActiveTab("help");
              setIsSidebarOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
              activeTab === "help"
                ? "bg-zinc-800/80 text-white"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
            }`}
          >
            <HelpCircle className="w-4 h-4" />
            <span>Help &amp; Guide</span>
          </button>

          {isDeveloper && (
            <button
              onClick={() => {
                setActiveTab("developer");
                setIsSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all border ${
                activeTab === "developer"
                  ? "bg-emerald-600/15 border-emerald-500/25 text-emerald-400"
                  : "text-zinc-400 hover:text-emerald-300 hover:bg-emerald-950/25 border-transparent"
              }`}
            >
              <Terminal className="w-4 h-4" />
              <span>Developer Console</span>
            </button>
          )}

          <div className="border-t border-zinc-800/40 my-3 pt-3 space-y-2">
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-zinc-950/45 border border-zinc-900">
              <UserAvatar photoUrl={userPhotoURL} name={userName} className="w-8 h-8" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-zinc-300 truncate leading-none">{userName || "JX User"}</p>
                <p className="text-[10px] text-zinc-500 font-mono truncate mt-1">{userEmail}</p>
              </div>
            </div>
            {currentUser?.isAnonymous && (
              <div className="space-y-2">
                <button
                  onClick={handleLinkToGoogle}
                  disabled={isLinkingLoading}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold cursor-pointer transition-all bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 border border-blue-500/15"
                >
                  {isLinkingLoading ? (
                    <span className="w-4 h-4 rounded-full border-2 border-t-blue-400 border-zinc-800 animate-spin" />
                  ) : (
                    <Globe className="w-4 h-4 text-blue-400 animate-pulse" />
                  )}
                  <span>Upgrade / Link Google</span>
                </button>
                
                {linkingError && (
                  <div className="p-3.5 rounded-xl border border-red-500/20 bg-red-500/5 text-left text-red-400 space-y-2">
                    {linkingError === "IFRAME_POPUP_CLOSED" ? (
                      <>
                        <p className="font-bold text-[11px] flex items-center gap-1.5">
                          <span>⚠️</span> Popup Blocked / Cancelled
                        </p>
                        <p className="text-zinc-300 text-[10px] leading-normal">
                          Sandbox security policies inside the AI Studio iframe restrict popup linking dialogs.
                        </p>
                        <div className="p-2.5 bg-zinc-950/60 rounded-lg border border-zinc-800/80 text-[10px] space-y-1.5 text-zinc-300 font-sans leading-relaxed">
                          <p className="font-bold text-zinc-200">🛠️ Simple Fix:</p>
                          <ol className="list-decimal pl-3.5 space-y-1">
                            <li>Click the <strong>'Open in new tab'</strong> (↗️) icon at the top-right of AI Studio.</li>
                            <li>Run in standalone tab, then click <strong>'Upgrade / Link Google'</strong> again!</li>
                          </ol>
                        </div>
                      </>
                    ) : (
                      <p className="font-mono text-[10px]">{linkingError}</p>
                    )}
                  </div>
                )}
              </div>
            )}
            <button
              onClick={handleAppLogout}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all text-red-400 hover:text-red-300 hover:bg-red-500/10"
            >
              <LogOut className="w-4 h-4 text-red-400" />
              <span>Log Out / Exit</span>
            </button>
          </div>
        </div>
      </aside>

      {/* MOBILE DRAWER SIDEBAR */}
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-black/85 z-40 lg:hidden"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className={`fixed inset-y-0 left-0 w-72 z-50 flex flex-col h-full border-r ${sidebarClass}`}
            >
              {/* Mobile Sidebar Header */}
              <div className={`p-4 flex justify-between items-center border-b ${subBorderClass}`}>
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center">
                    <JXLogo className="w-8 h-8" roundedClass="rounded-full" glowClass="shadow-[0_0_12px_rgba(59,130,246,0.3)]" bgClass="bg-black" />
                  </div>
                  <span className="font-bold text-sm text-white">JX AI v3.5</span>
                </div>
                <button
                  onClick={() => setIsSidebarOpen(false)}
                  className="p-2 rounded-lg bg-zinc-900 text-zinc-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Action: New Chat */}
              <div className="p-3 shrink-0 pb-1">
                <button
                  onClick={handleNewChat}
                  className="w-full py-2.5 px-4 rounded-xl bg-zinc-850/40 hover:bg-zinc-850/80 text-zinc-200 border border-zinc-800 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-blue-400" />
                  <span>New Chat Session</span>
                </button>
              </div>

              {/* PWA Install Banner on Mobile */}
              {deferredPrompt && (
                <div className="px-3 pb-2 shrink-0">
                  <button
                    onClick={handleInstallApp}
                    className="w-full py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center justify-between gap-2 transition-all shadow-[0_0_8px_rgba(59,130,246,0.25)] border border-blue-500 active:scale-95 cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Download className="w-3.5 h-3.5 animate-bounce" />
                      <span>Install JX AI App</span>
                    </div>
                    <span className="text-[9px] bg-blue-800 px-1.5 py-0.5 rounded text-blue-100 uppercase font-bold tracking-wider animate-pulse">Get</span>
                  </button>
                </div>
              )}

              {/* Mobile Search Previous Chats */}
              <div className="px-3 pb-2 pt-1 shrink-0">
                <div className="relative flex items-center">
                  <Search className="w-3.5 h-3.5 absolute left-3 text-zinc-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search previous chats..."
                    className={`w-full pl-8 pr-7 py-2 rounded-xl text-xs border focus:outline-none transition-all ${
                      isDark 
                        ? "bg-zinc-900/50 border-zinc-800/80 text-zinc-200 focus:border-zinc-700 placeholder:text-zinc-500" 
                        : "bg-zinc-100 border-zinc-200 text-zinc-850 focus:border-zinc-350 placeholder:text-zinc-400"
                    }`}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2.5 p-0.5 rounded-full hover:bg-zinc-800 hover:text-white text-zinc-400 transition-colors"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Scrollable Chat History Sessions */}
              <div className="flex-1 overflow-y-auto px-3 space-y-1">
                <div className="px-3 py-1.5 text-[9px] font-bold text-zinc-500 uppercase tracking-wider">
                  Conversations History
                </div>
                {filteredConversations.length === 0 ? (
                  <p className="text-xs text-zinc-500 italic px-3 py-2">
                    {searchQuery ? "No matches found" : "No history yet"}
                  </p>
                ) : (
                  filteredConversations.map((conv) => {
                    const isActive = conv.id === activeId;
                    const isEditing = editingConvId === conv.id;

                    if (isEditing) {
                      return (
                        <div
                          key={conv.id}
                          onClick={(e) => e.stopPropagation()}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border ${
                            isDark ? "bg-zinc-900 border-zinc-800" : "bg-white border-zinc-300"
                          }`}
                        >
                          <input
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveRename(conv.id);
                              if (e.key === "Escape") handleCancelRename();
                            }}
                            className="flex-1 bg-transparent border-none focus:outline-none text-xs font-semibold text-zinc-200"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveRename(conv.id)}
                            className="p-0.5 rounded hover:bg-zinc-800 text-blue-400"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={handleCancelRename}
                            className="p-0.5 rounded hover:bg-zinc-800 text-zinc-400"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={conv.id}
                        onClick={() => {
                          setActiveId(conv.id);
                          setActiveTab("chat");
                          setIsSidebarOpen(false);
                        }}
                        className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                          conv.id === activeId
                            ? isDark
                              ? "bg-zinc-800/70 text-white border border-zinc-700/80"
                              : "bg-zinc-900 text-white border border-zinc-800"
                            : isDark
                              ? "hover:bg-[#121215] text-zinc-400 hover:text-zinc-200"
                              : "hover:bg-zinc-100 text-zinc-600 hover:text-zinc-900"
                        }`}
                      >
                        <MessageSquare className={`w-3.5 h-3.5 ${conv.id === activeId ? "text-blue-400" : "text-zinc-500"}`} />
                        <span className="truncate flex-1 text-left pr-10">{conv.title}</span>
                        
                        <div className="absolute right-2 flex items-center gap-1">
                          <button
                            onClick={(e) => handleStartRename(conv.id, conv.title, e)}
                            className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => handleDeleteSession(conv.id, e)}
                            className="p-1 text-zinc-500 hover:text-red-400 cursor-pointer transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Mobile Sidebar Footer */}
              <div className={`p-3 shrink-0 border-t space-y-1 ${subBorderClass}`}>
                <button
                  onClick={() => {
                    setActiveTab("chat");
                    setIsSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer ${
                    activeTab === "chat" ? "bg-zinc-800 text-white" : "text-zinc-400"
                  }`}
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>AI Assistant Workspace</span>
                </button>
                <button
                  onClick={() => {
                    setActiveTab("calendar");
                    setIsSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer ${
                    activeTab === "calendar" ? "bg-zinc-800 text-white" : "text-zinc-400"
                  }`}
                >
                  <Calendar className="w-4 h-4" />
                  <span>Google Calendar</span>
                </button>
                <button
                  onClick={() => {
                    setActiveTab("gmail");
                    setIsSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer ${
                    activeTab === "gmail" ? "bg-zinc-800 text-white" : "text-zinc-400"
                  }`}
                >
                  <Mail className="w-4 h-4" />
                  <span>Gmail Inbox</span>
                </button>
                <button
                  onClick={() => {
                    setActiveTab("profile");
                    setIsSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer ${
                    activeTab === "profile" ? "bg-zinc-800 text-white" : "text-zinc-400"
                  }`}
                >
                  <UserIcon className="w-4 h-4" />
                  <span>Your Profile</span>
                </button>
                <button
                  onClick={() => {
                    setActiveTab("settings");
                    setIsSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer ${
                    activeTab === "settings" ? "bg-zinc-800 text-white" : "text-zinc-400"
                  }`}
                >
                  <SettingsIcon className="w-4 h-4" />
                  <span>Settings Panel</span>
                </button>
                <button
                  onClick={() => {
                    setActiveTab("help");
                    setIsSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer ${
                    activeTab === "help" ? "bg-zinc-800 text-white" : "text-zinc-400"
                  }`}
                >
                  <HelpCircle className="w-4 h-4" />
                  <span>Help &amp; Guide</span>
                </button>

                {isDeveloper && (
                  <button
                    onClick={() => {
                      setActiveTab("developer");
                      setIsSidebarOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer border ${
                      activeTab === "developer"
                        ? "bg-emerald-600/15 border-emerald-500/25 text-emerald-400"
                        : "text-zinc-400 hover:text-emerald-300 border-transparent"
                    }`}
                  >
                    <Terminal className="w-4 h-4 text-emerald-400" />
                    <span>Developer Console</span>
                  </button>
                )}

                <div className="border-t border-zinc-800/40 my-3 pt-3 space-y-2">
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-zinc-950/45 border border-zinc-900">
                    <UserAvatar photoUrl={userPhotoURL} name={userName} className="w-7 h-7" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-zinc-300 truncate leading-none">{userName || "JX User"}</p>
                      <p className="text-[9px] text-zinc-500 font-mono truncate mt-0.5">{userEmail}</p>
                    </div>
                  </div>
                  {currentUser?.isAnonymous && (
                    <div className="space-y-2">
                      <button
                        onClick={handleLinkToGoogle}
                        disabled={isLinkingLoading}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-bold cursor-pointer transition-all bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 border border-blue-500/15"
                      >
                        {isLinkingLoading ? (
                          <span className="w-3 h-3 rounded-full border-2 border-t-blue-400 border-zinc-800 animate-spin" />
                        ) : (
                          <Globe className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                        )}
                        <span>Upgrade / Link Google</span>
                      </button>

                      {linkingError && (
                        <div className="p-3.5 rounded-xl border border-red-500/20 bg-red-500/5 text-left text-red-400 space-y-2">
                          {linkingError === "IFRAME_POPUP_CLOSED" ? (
                            <>
                              <p className="font-bold text-[11px] flex items-center gap-1.5">
                                <span>⚠️</span> Popup Blocked / Cancelled
                              </p>
                              <p className="text-zinc-300 text-[10px] leading-normal">
                                Sandbox security policies inside the AI Studio iframe restrict popup linking dialogs.
                              </p>
                              <div className="p-2.5 bg-zinc-950/60 rounded-lg border border-zinc-800/80 text-[10px] space-y-1.5 text-zinc-300 font-sans leading-relaxed">
                                <p className="font-bold text-zinc-200">🛠️ Simple Fix:</p>
                                <ol className="list-decimal pl-3.5 space-y-1">
                                  <li>Click the <strong>'Open in new tab'</strong> (↗️) icon at the top-right of AI Studio.</li>
                                  <li>Run in standalone tab, then click <strong>'Upgrade / Link Google'</strong> again!</li>
                                </ol>
                              </div>
                            </>
                          ) : (
                            <p className="font-mono text-[10px]">{linkingError}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      handleAppLogout();
                      setIsSidebarOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  >
                    <LogOut className="w-4 h-4 text-red-400" />
                    <span>Log Out / Exit</span>
                  </button>
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* MAIN WORKSPACE AREA */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        
        {/* TOP HEADER */}
        <header className={`flex items-center justify-between px-4 md:px-6 py-4 border-b shrink-0 z-30 transition-colors ${headerClass}`}>
          <div className="flex items-center gap-3">
            {/* Sidebar Toggle (Mobile) */}
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 -ml-1 rounded-xl bg-zinc-900/40 border border-zinc-800/40 text-zinc-400 hover:text-white lg:hidden cursor-pointer transition-all"
            >
              <Menu className="w-4 h-4" />
            </button>
            
            {/* Tab Title Indicator */}
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full animate-pulse ${isOnline ? "bg-blue-500" : "bg-red-500"}`} />
              <h1 className="text-sm md:text-base font-bold tracking-tight">
                {activeTab === "chat" && (activeConversation?.title || "AI Workspace")}
                {activeTab === "calendar" && "Google Calendar Integration"}
                {activeTab === "gmail" && "Gmail Inbox Workspace"}
                {activeTab === "profile" && "Your Profile"}
                {activeTab === "settings" && "General Settings"}
                {activeTab === "help" && "Help & Documentation"}
                {activeTab === "developer" && "Developer Console & Admin Panel"}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Hidden Developer Menu Shortcut */}
            {isDeveloper && activeTab !== "developer" && (
              <button
                onClick={() => setActiveTab("developer")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-black uppercase tracking-wider cursor-pointer hover:bg-emerald-500/20 transition-all shadow-[0_0_15px_rgba(16,185,129,0.1)] hover:scale-102"
                title="Enter Hidden Developer Control Room"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>🛡️ Dev Room</span>
              </button>
            )}

            {/* Network Badge Status */}
            {isOnline ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px] font-bold uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                <span>Online</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 text-[10px] font-bold uppercase tracking-wider animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                <span>Offline</span>
              </div>
            )}

            {/* Live Clock HUD */}
            <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900/60 text-zinc-400 border border-zinc-800/60 text-xs font-mono">
              <Clock className="w-3.5 h-3.5 text-zinc-500" />
              <span>{currentTime || "12:00 PM"}</span>
            </div>

            {/* Clear Chat Button (only visible in active chat view with content) */}
            {activeTab === "chat" && messages.length > 0 && (
              <button
                onClick={handleClearChat}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/15 border border-red-500/15 cursor-pointer transition-all"
                title="Clear current log"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Clear Log</span>
              </button>
            )}

            {/* Return To Chat Quick Button */}
            {activeTab !== "chat" && (
              <button
                onClick={() => setActiveTab("chat")}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-zinc-900 border border-zinc-800 text-zinc-100 hover:bg-zinc-800 hover:text-white transition-all cursor-pointer shadow-md"
              >
                Return to Chat
              </button>
            )}

            {/* Header User Profile Avatar Shortcut */}
            <button 
              onClick={() => setActiveTab("profile")}
              className="relative cursor-pointer group flex items-center justify-center shrink-0 ml-1 rounded-full focus:outline-none focus:ring-1 focus:ring-zinc-700 hover:scale-105 transition-all"
              title="View Profile"
            >
              <UserAvatar photoUrl={userPhotoURL} name={userName} className="w-7 h-7 hover:border-zinc-500 transition-all shadow-md" />
            </button>
          </div>
        </header>

        {/* GLOBAL TEMPORARY FLOATING NOTIFICATIONS */}
        <AnimatePresence>
          {notification && (
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              className="absolute top-18 left-1/2 -translate-x-1/2 bg-zinc-900 text-zinc-100 px-5 py-3 rounded-2xl shadow-2xl border border-zinc-800 z-50 text-xs md:text-sm font-semibold max-w-sm text-center flex items-center justify-center gap-2.5"
            >
              <Sparkles className="w-4 h-4 text-zinc-400 shrink-0" />
              <span>{notification}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* VIEW 1: CHAT WORKSPACE CONTAINER */}
        {activeTab === "chat" && (
          <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6 md:py-8 space-y-6">
            
            {/* ZERO-STATE: Dynamic Welcome & Sugesstion Pills */}
            {messages.length === 0 ? (
              !isOnline ? (
                <div className="max-w-md mx-auto py-16 md:py-24 text-center space-y-6">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-red-500/10 border border-red-500/20 text-red-400 shadow-[0_0_20px_rgba(239,68,68,0.15)]">
                    <WifiOff className="h-8 w-8 animate-pulse" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-xl md:text-2xl font-black text-zinc-100 tracking-tight">
                      You're offline
                    </h2>
                    <p className="text-xs md:text-sm text-zinc-400 leading-relaxed max-w-sm mx-auto">
                      Connect to the internet to continue chatting with JX AI.
                    </p>
                  </div>
                  <div className="p-4 rounded-2xl bg-[#070708] border border-zinc-850 space-y-3 text-left">
                    <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest block">
                      Local Workspace Status
                    </span>
                    <p className="text-xs text-zinc-400">
                      You can still read previous conversations from the sidebar panel while offline.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="max-w-2xl mx-auto space-y-8 py-6 md:py-12">
                  
                  {/* Brand Visual Intro */}
                  <div className="text-center space-y-3.5">
                    <div className="flex items-center justify-center mb-1">
                      <JXLogo className="w-14 h-14" roundedClass="rounded-2xl" glowClass="shadow-[0_0_25px_rgba(59,130,246,0.25)]" bgClass="bg-zinc-950" />
                    </div>
                    <h2 className="text-2xl md:text-3xl font-black text-white tracking-tight animate-fade-in">
                      Hello! I'm JX AI. How can I help you today?
                    </h2>
                    <p className="text-xs md:text-sm text-zinc-400 max-w-md mx-auto leading-relaxed">
                      I am highly optimized to support coding roadmaps, technical guidance, organic agriculture steps, and traditional Indian advice. Let's begin!
                    </p>
                  </div>

                  {/* Suggestions Pills Grid */}
                  <div className="space-y-4">
                    <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-center">
                      Choose a suggested prompt to start
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {SUGGESTIONS.map((sug) => (
                        <button
                          key={sug.id}
                          onClick={() => handleSendMessage(sug.text)}
                          className={`group flex items-start gap-3.5 p-4 rounded-2xl border text-left cursor-pointer transition-all duration-150 ${cardClass} ${hoverCardClass}`}
                        >
                          <div className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 shrink-0">
                            {getSuggestionIcon(sug.icon)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="block text-xs md:text-sm font-semibold text-zinc-200 group-hover:text-white truncate">
                              {sug.title}
                            </span>
                            <span className="block text-[11px] text-zinc-400 font-normal line-clamp-1 mt-0.5">
                              {sug.text}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Micro Help Footer Info */}
                  <div className="flex items-center justify-center gap-1.5 text-[10px] text-zinc-500 italic">
                    <Compass className="w-3.5 h-3.5 text-zinc-600" />
                    <span>Preferences set to {language} dialect mode</span>
                  </div>

                </div>
              )
            ) : (
              
              /* CHAT MESSAGES LOG */
              <div className="max-w-3xl mx-auto space-y-6 pb-24">
                {messages.map((msg, idx) => {
                  const isUser = msg.role === "user";
                  return (
                    <div
                      key={msg.id}
                      className={`flex gap-3 md:gap-4 ${isUser ? "justify-end" : "justify-start"}`}
                    >
                      {/* Avatar Indicator - Left */}
                      {!isUser && (
                        <JXLogo className="w-8 h-8 md:w-9 md:h-9" roundedClass="rounded-full" glowClass="shadow-[0_0_8px_rgba(255,255,255,0.15)]" bgClass="bg-black" />
                      )}

                      {/* Chat Bubble Body */}
                      <div className={`max-w-[85%] rounded-2xl px-4 py-3.5 md:px-5 md:py-4 border transition-all ${
                        isUser ? bubbleUserClass : bubbleModelClass
                      }`}>
                        
                        {/* Text Content */}
                        {isUser ? (
                          <div className="space-y-3">
                            <p className="text-sm md:text-[15px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                            
                            {/* Render User Attached Media/Files */}
                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="flex flex-wrap gap-2.5 pt-1">
                                {msg.attachments.map((att, attIdx) => {
                                  if (att.type === "image") {
                                    return (
                                      <div key={attIdx} className="relative group max-w-sm">
                                        <img
                                          src={att.data}
                                          alt={att.name}
                                          referrerPolicy="no-referrer"
                                          className="max-h-48 md:max-h-64 rounded-xl border border-zinc-700/80 object-contain bg-zinc-950 shadow-md"
                                        />
                                      </div>
                                    );
                                  } else {
                                    return (
                                      <div
                                        key={attIdx}
                                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-100 text-xs shadow-md"
                                      >
                                        <FileText className="w-4 h-4 text-zinc-400 shrink-0" />
                                        <div className="text-left min-w-0">
                                          <p className="font-semibold truncate max-w-[140px] text-zinc-200">{att.name}</p>
                                          <p className="text-[10px] text-zinc-500 font-mono">
                                            {att.size ? (att.size / 1024).toFixed(1) : "0"} KB
                                          </p>
                                        </div>
                                      </div>
                                    );
                                  }
                                })}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <TypewriterView 
                              text={msg.content} 
                              isStreaming={loading && idx === messages.length - 1 && msg.role === "model"}
                              onTyped={() => scrollToBottom("auto")}
                            />
                            
                            {/* Render Model Attached/Generated Images with Download Option */}
                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="flex flex-wrap gap-3 pt-1">
                                {msg.attachments.map((att, attIdx) => {
                                  if (att.type === "image") {
                                    return (
                                      <div key={attIdx} className="relative group max-w-lg mt-2">
                                        <img
                                          src={att.data}
                                          alt={att.name}
                                          referrerPolicy="no-referrer"
                                          className="max-h-96 w-full rounded-xl border border-zinc-700/85 object-contain bg-zinc-950 shadow-lg"
                                        />
                                        {/* Hover download button overlay */}
                                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5">
                                          <button
                                            onClick={() => handleOpenAttachmentProperly(att, attIdx, msg.id)}
                                            className="bg-zinc-950/90 hover:bg-zinc-950 border border-zinc-800 p-2 rounded-xl text-white cursor-pointer shadow-md flex items-center gap-1.5 text-xs font-semibold transition-colors hover:text-blue-400"
                                            title="Open link properly without redirect warnings"
                                          >
                                            <Globe className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                                            <span>Open proper link</span>
                                          </button>
                                          <button
                                            onClick={() => handleDownloadAttachment(att.data, att.name)}
                                            className="bg-zinc-950/90 hover:bg-zinc-950 border border-zinc-800 p-2 rounded-xl text-white cursor-pointer shadow-md flex items-center gap-1.5 text-xs font-semibold transition-colors hover:text-blue-400"
                                          >
                                            <Download className="w-3.5 h-3.5 text-blue-400" />
                                            <span>Download</span>
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  } else {
                                    return (
                                      <div
                                        key={attIdx}
                                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-100 text-xs shadow-md mt-2"
                                      >
                                        <FileText className="w-4 h-4 text-zinc-400 shrink-0" />
                                        <div className="text-left min-w-0">
                                          <p className="font-semibold truncate max-w-[140px] text-zinc-200">{att.name}</p>
                                        </div>
                                      </div>
                                    );
                                  }
                                })}
                              </div>
                            )}
                            
                            {/* Action Bar inside AI Response */}
                            <div className="flex items-center gap-2 pt-2 border-t border-zinc-800/40 text-xs text-zinc-500">
                              {/* Copy response */}
                              <button
                                onClick={() => handleCopyText(msg.id, msg.content)}
                                className="flex items-center gap-1 hover:text-white transition-colors cursor-pointer bg-zinc-900 hover:bg-zinc-850 px-2.5 py-1.5 rounded-lg border border-zinc-800"
                                title="Copy response text"
                              >
                                {copiedId === msg.id ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-zinc-300" />
                                    <span className="text-zinc-300 font-medium">Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>

                              {/* Voice Output Player (Read Aloud) */}
                              <button
                                onClick={() => handleSpeak(msg.id, msg.content)}
                                className={`flex items-center gap-1 hover:text-white transition-colors cursor-pointer bg-zinc-900 hover:bg-zinc-850 px-2.5 py-1.5 rounded-lg border border-zinc-800 ${
                                  speakingMessageId === msg.id ? "text-blue-400 border-blue-500/35 font-semibold bg-zinc-850" : ""
                                }`}
                                title={speakingMessageId === msg.id ? "Stop voice player" : "Listen to answer"}
                              >
                                {speakingMessageId === msg.id ? (
                                  <>
                                    <VolumeX className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                                    <span>Stop listening</span>
                                  </>
                                ) : (
                                  <>
                                    <Volume2 className="w-3.5 h-3.5" />
                                    <span>Listen</span>
                                  </>
                                )}
                              </button>

                              {/* Regenerate Response (available on latest message) */}
                              {idx === messages.length - 1 && (
                                <button
                                  onClick={handleRegenerateResponse}
                                  className="flex items-center gap-1 hover:text-white transition-colors cursor-pointer bg-zinc-900 hover:bg-zinc-850 px-2.5 py-1.5 rounded-lg border border-zinc-800"
                                  title="Regenerate this response"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                  <span>Regenerate</span>
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Timestamp indicator */}
                        <div className="flex justify-between items-center text-[9px] text-zinc-500 mt-2">
                          <span className="font-mono">
                            {msg.timestamp.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>

                      </div>

                      {/* Avatar Indicator - Right */}
                      {isUser && (
                        <UserAvatar photoUrl={userPhotoURL} name={userName} className="w-8 h-8 md:w-9 md:h-9" />
                      )}

                    </div>
                  );
                })}

                {/* Generating Loading States */}
                {loading && (messages.length === 0 || messages[messages.length - 1].role !== "model") && (
                  <div className="flex gap-3 md:gap-4 justify-start">
                    <JXLogo className="w-8 h-8 md:w-9 md:h-9" roundedClass="rounded-full" glowClass="shadow-[0_0_8px_rgba(255,255,255,0.15)]" bgClass="bg-black" />
                    <div className={`rounded-2xl rounded-tl-none border px-5 py-4 shadow-sm space-y-2.5 ${bubbleModelClass}`}>
                      <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-semibold italic">
                        <Sparkles className="w-3.5 h-3.5 text-zinc-400 animate-spin" />
                        <span>JX AI is looking up info...</span>
                      </div>
                      <div className="flex gap-1.5 py-1">
                        <span className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-2 h-2 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-2 h-2 rounded-full bg-zinc-600 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                )}

                {/* Error Box */}
                {error && (
                  <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3 max-w-xl mx-auto">
                    <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-red-300 space-y-1">
                      <p className="font-bold">An error occurred:</p>
                      <p>{error}</p>
                      <button 
                        onClick={() => handleSendMessage()} 
                        className="mt-2 text-[11px] font-semibold text-red-400 underline flex items-center gap-1 cursor-pointer hover:text-red-300"
                      >
                        <RotateCcw className="w-3 h-3" /> Retry sending last prompt
                      </button>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}

          </div>
        )}

        {/* GOOGLE WORKSPACE CONNECTION PENDING SCREEN */}
        {(!workspaceToken) && (activeTab === "calendar" || activeTab === "gmail") && (
          <div className="flex-1 overflow-y-auto px-4 py-8 md:px-8 max-w-3xl mx-auto w-full flex flex-col justify-center items-center">
            <div className={`p-8 md:p-10 rounded-3xl border text-center space-y-6 max-w-md ${cardClass}`}>
              <div className="w-16 h-16 mx-auto rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-100 shadow-[0_0_15px_rgba(255,255,255,0.05)]">
                {activeTab === "calendar" ? <Calendar className="w-8 h-8 text-blue-400" /> : <Mail className="w-8 h-8 text-indigo-400" />}
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-bold tracking-tight">Connect your Google Account</h2>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  To view and manage your Google Workspace (Gmail or Calendar) directly inside JX AI, please authorize access to your Google account.
                </p>
              </div>

              {workspaceAuthError && (
                <div className="p-4 rounded-2xl border border-red-500/20 bg-red-500/5 text-left space-y-3 text-xs">
                  {workspaceAuthError === "IFRAME_POPUP_CLOSED" ? (
                    <>
                      <p className="font-bold text-red-400 flex items-center gap-1.5">
                        <span className="text-sm">⚠️</span> Iframe Popup Blocked / Closed
                      </p>
                      <p className="text-zinc-300 leading-relaxed text-[11px]">
                        Google Sign-In requires a separate popup. Since the JX AI app is currently running inside the AI Studio preview iframe, browser policies blocked or closed the login popup automatically.
                      </p>
                      <div className="p-3 bg-zinc-950/40 rounded-xl border border-zinc-800/60 text-[11px] space-y-1.5 text-zinc-300 leading-relaxed font-sans">
                        <p className="font-bold text-zinc-200">🛠️ समाधान (Solution):</p>
                        <ol className="list-decimal pl-4 space-y-1">
                          <li>Look at the top-right corner of your AI Studio screen.</li>
                          <li>Click the <strong>'Open in new tab'</strong> (pop-out ↗️) icon next to the preview frame.</li>
                          <li>Once the app is open in its own separate tab, click <strong>'Connect with Google'</strong> again. It will work flawlessly!</li>
                        </ol>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="font-bold text-red-400">Connection Failed</p>
                      <p className="text-zinc-300 leading-relaxed text-[11px] font-mono">
                        {workspaceAuthError}
                      </p>
                    </>
                  )}
                </div>
              )}

              <button
                onClick={handleWorkspaceLogin}
                disabled={workspaceAuthLoading}
                className="w-full py-3 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-900 text-xs font-bold font-sans transition-all duration-150 cursor-pointer shadow-md disabled:opacity-50"
              >
                {workspaceAuthLoading ? "Connecting..." : "Connect with Google"}
              </button>
            </div>
          </div>
        )}

        {/* VIEW: GOOGLE CALENDAR INTEGRATION */}
        {activeTab === "calendar" && workspaceToken && (
          <div className="flex-1 overflow-y-auto px-4 py-8 md:px-8 max-w-4xl mx-auto w-full space-y-6">
            
            {/* Calendar Header Card */}
            <div className={`p-6 rounded-2xl border ${cardClass} flex flex-col md:flex-row justify-between items-start md:items-center gap-4`}>
              <div className="space-y-1">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-blue-400" />
                  Your Google Calendar
                </h2>
                <p className="text-xs text-zinc-500">
                  Logged in as <span className="font-mono text-zinc-400">{userEmail}</span>. Manage your appointments and events.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setIsSchedulingEvent(true)}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all cursor-pointer shadow-md active:scale-95"
                >
                  Schedule Event
                </button>
                <button
                  onClick={handleWorkspaceLogout}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold transition-all cursor-pointer border border-zinc-700"
                >
                  Disconnect
                </button>
              </div>
            </div>

            {/* Scheduling Form Block */}
            {isSchedulingEvent && (
              <form onSubmit={handleCreateEvent} className={`p-6 rounded-2xl border ${cardClass} space-y-4 animate-fadeIn`}>
                <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-widest">
                  Schedule New Event
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-zinc-400">Event Title*</label>
                    <input
                      type="text"
                      placeholder="e.g. Project Sync meeting"
                      value={newEventTitle}
                      onChange={(e) => setNewEventTitle(e.target.value)}
                      className={`w-full p-2.5 rounded-xl border text-xs ${inputBgClass}`}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-zinc-400">Date*</label>
                    <input
                      type="date"
                      value={newEventDate}
                      onChange={(e) => setNewEventDate(e.target.value)}
                      className={`w-full p-2.5 rounded-xl border text-xs ${inputBgClass}`}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-zinc-400">Start Time*</label>
                    <input
                      type="time"
                      value={newEventStartTime}
                      onChange={(e) => setNewEventStartTime(e.target.value)}
                      className={`w-full p-2.5 rounded-xl border text-xs ${inputBgClass}`}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-zinc-400">End Time*</label>
                    <input
                      type="time"
                      value={newEventEndTime}
                      onChange={(e) => setNewEventEndTime(e.target.value)}
                      className={`w-full p-2.5 rounded-xl border text-xs ${inputBgClass}`}
                      required
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-semibold text-zinc-400">Location</label>
                    <input
                      type="text"
                      placeholder="e.g. Google Meet / Room 402"
                      value={newEventLocation}
                      onChange={(e) => setNewEventLocation(e.target.value)}
                      className={`w-full p-2.5 rounded-xl border text-xs ${inputBgClass}`}
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-semibold text-zinc-400">Description</label>
                    <textarea
                      placeholder="Enter event details here..."
                      value={newEventDesc}
                      onChange={(e) => setNewEventDesc(e.target.value)}
                      rows={3}
                      className={`w-full p-2.5 rounded-xl border text-xs ${inputBgClass}`}
                    />
                  </div>
                </div>

                <div className="flex gap-2 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setIsSchedulingEvent(false)}
                    className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-xs font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md"
                  >
                    Confirm Schedule
                  </button>
                </div>
              </form>
            )}

            {/* Events List */}
            <div className="space-y-3">
              <div className="flex justify-between items-center px-1">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  Upcoming Calendar Events
                </h3>
                <button
                  onClick={fetchUpcomingEvents}
                  className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors font-semibold"
                >
                  Refresh Events
                </button>
              </div>

              {calendarLoading ? (
                <div className="py-12 text-center text-zinc-500 text-xs flex flex-col items-center gap-2">
                  <span className="w-5 h-5 rounded-full border-2 border-t-blue-500 animate-spin" />
                  Fetching events from Google Calendar...
                </div>
              ) : calendarError ? (
                <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 text-xs">
                  {calendarError}
                </div>
              ) : calendarEvents.length === 0 ? (
                <div className={`p-8 rounded-2xl border text-center text-zinc-500 text-xs ${cardClass}`}>
                  No upcoming events found in your Google Calendar.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {calendarEvents.map((ev) => {
                    const startStr = ev.start.dateTime || ev.start.date;
                    const endStr = ev.end.dateTime || ev.end.date;
                    const startDateObj = new Date(startStr);
                    const formattedDate = startDateObj.toLocaleDateString("en-US", {
                      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
                    });
                    const formattedTime = ev.start.dateTime 
                      ? `${startDateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - ${new Date(endStr).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`
                      : "All Day";

                    return (
                      <div key={ev.id} className={`p-4 rounded-2xl border ${cardClass} flex flex-col justify-between space-y-3 hover:border-zinc-700 transition-all`}>
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-start gap-2">
                            <h4 className="text-sm font-bold text-zinc-200">{ev.summary}</h4>
                            <button
                              onClick={() => handleDeleteEvent(ev.id, ev.summary)}
                              className="p-1 rounded-lg hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-colors cursor-pointer"
                              title="Delete Event"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <p className="text-[11px] text-zinc-400 font-semibold flex items-center gap-1.5">
                            <Clock className="w-3 h-3 text-blue-400" />
                            {formattedDate} ({formattedTime})
                          </p>
                          {ev.location && (
                            <p className="text-[11px] text-zinc-500 font-mono">
                              📍 {ev.location}
                            </p>
                          )}
                          {ev.description && (
                            <p className="text-xs text-zinc-500 mt-1 line-clamp-3 bg-zinc-950/20 p-2 rounded-lg font-mono">
                              {ev.description}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW: GMAIL INBOX WORKSPACE */}
        {activeTab === "gmail" && workspaceToken && (
          <div className="flex-1 overflow-y-auto px-4 py-8 md:px-8 max-w-5xl mx-auto w-full space-y-6">
            
            {/* Gmail Header Card */}
            <div className={`p-6 rounded-2xl border ${cardClass} flex flex-col md:flex-row justify-between items-start md:items-center gap-4`}>
              <div className="space-y-1">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Mail className="w-5 h-5 text-indigo-400" />
                  Your Gmail Inbox Workspace
                </h2>
                <p className="text-xs text-zinc-500">
                  Logged in as <span className="font-mono text-zinc-400">{userEmail}</span>. Search, read, compose, and trash emails.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setIsComposingEmail(true)}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all cursor-pointer shadow-md active:scale-95"
                >
                  Compose Email
                </button>
                <button
                  onClick={handleWorkspaceLogout}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold transition-all cursor-pointer border border-zinc-700"
                >
                  Disconnect
                </button>
              </div>
            </div>

            {/* Compose Modal Form */}
            {isComposingEmail && (
              <form onSubmit={handleSendEmail} className={`p-6 rounded-2xl border ${cardClass} space-y-4 animate-fadeIn`}>
                <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-widest">
                  Compose New Email
                </h3>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-zinc-400">To (Recipient Email)*</label>
                    <input
                      type="email"
                      placeholder="recipient@example.com"
                      value={composeTo}
                      onChange={(e) => setComposeTo(e.target.value)}
                      className={`w-full p-2.5 rounded-xl border text-xs ${inputBgClass}`}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-zinc-400">Subject*</label>
                    <input
                      type="text"
                      placeholder="e.g. JX AI Workspace Report"
                      value={composeSubject}
                      onChange={(e) => setComposeSubject(e.target.value)}
                      className={`w-full p-2.5 rounded-xl border text-xs ${inputBgClass}`}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-zinc-400">Message Body*</label>
                    <textarea
                      placeholder="Type your email body here..."
                      value={composeBody}
                      onChange={(e) => setComposeBody(e.target.value)}
                      rows={6}
                      className={`w-full p-2.5 rounded-xl border text-xs ${inputBgClass}`}
                      required
                    />
                  </div>
                </div>

                <div className="flex gap-2 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setIsComposingEmail(false)}
                    className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-xs font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md"
                  >
                    Send Email
                  </button>
                </div>
              </form>
            )}

            {/* Search Bar Row */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Search emails in Gmail (e.g. from:me, subject:reports)..."
                value={gmailQuery}
                onChange={(e) => setGmailQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") fetchRecentEmails();
                }}
                className={`flex-1 p-2.5 rounded-xl border text-xs ${inputBgClass}`}
              />
              <button
                onClick={() => fetchRecentEmails()}
                className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-200 text-xs font-semibold border border-zinc-700 hover:bg-zinc-750"
              >
                Search
              </button>
            </div>

            {/* Dual Pane Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              
              {/* Emails List Column */}
              <div className="lg:col-span-5 space-y-3">
                <div className="flex justify-between items-center px-1">
                  <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                    Recent Messages
                  </h3>
                  <button
                    onClick={() => fetchRecentEmails()}
                    className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors font-semibold"
                  >
                    Refresh List
                  </button>
                </div>

                {gmailLoading ? (
                  <div className="py-12 text-center text-zinc-500 text-xs flex flex-col items-center gap-2">
                    <span className="w-5 h-5 rounded-full border-2 border-t-indigo-500 animate-spin" />
                    Fetching Gmail inbox messages...
                  </div>
                ) : gmailError ? (
                  <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 text-xs">
                    {gmailError}
                  </div>
                ) : gmailEmails.length === 0 ? (
                  <div className={`p-8 rounded-2xl border text-center text-zinc-500 text-xs ${cardClass}`}>
                    No messages found matching your search.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                    {gmailEmails.map((e) => {
                      const isSelected = selectedEmail?.id === e.id;
                      return (
                        <div
                          key={e.id}
                          onClick={() => setSelectedEmail(e)}
                          className={`p-3.5 rounded-xl border cursor-pointer text-left transition-all space-y-1 ${cardClass} ${
                            isSelected 
                              ? "border-indigo-500/80 bg-indigo-500/5" 
                              : "hover:border-zinc-700"
                          }`}
                        >
                          <div className="flex justify-between items-start gap-1">
                            <span className="text-xs font-bold text-zinc-300 truncate max-w-[120px]">
                              {e.from.split("<")[0].trim() || e.from}
                            </span>
                            <span className="text-[10px] text-zinc-500 font-mono shrink-0">
                              {e.date}
                            </span>
                          </div>
                          <h4 className="text-xs font-bold text-zinc-200 line-clamp-1">{e.subject || "(No Subject)"}</h4>
                          <p className="text-[11px] text-zinc-500 line-clamp-2 leading-relaxed">{e.snippet}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Email Detail Column */}
              <div className="lg:col-span-7">
                {selectedEmail ? (
                  <div className={`p-6 rounded-2xl border ${cardClass} space-y-4`}>
                    <div className="flex justify-between items-start gap-4 border-b pb-4 border-zinc-800/50">
                      <div className="space-y-1">
                        <h3 className="text-sm font-extrabold text-zinc-200">{selectedEmail.subject || "(No Subject)"}</h3>
                        <p className="text-xs text-zinc-400">
                          From: <span className="font-mono">{selectedEmail.from}</span>
                        </p>
                        <p className="text-[10px] text-zinc-500 font-mono">
                          Date: {selectedEmail.date}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleDeleteEmail(selectedEmail.id, selectedEmail.subject)}
                          className="p-2 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all cursor-pointer"
                          title="Move to Trash"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setSelectedEmail(null)}
                          className="p-2 rounded-xl bg-zinc-800 text-zinc-300 hover:bg-zinc-750 text-xs font-bold"
                        >
                          Close
                        </button>
                      </div>
                    </div>

                    <div className="bg-zinc-950/40 p-4 rounded-xl max-h-[350px] overflow-y-auto whitespace-pre-wrap font-sans text-xs text-zinc-300 leading-relaxed border border-zinc-900">
                      {selectedEmail.snippet}
                      <p className="mt-4 text-[10px] text-zinc-500 border-t pt-3 border-zinc-800/40 font-mono">
                        Note: Full email HTML parser and rendering is protected by secure sandbox environment. Use Gmail client for rich media.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className={`p-12 rounded-2xl border border-dashed border-zinc-800 text-center text-zinc-500 text-xs flex flex-col justify-center items-center h-[350px] ${cardClass}`}>
                    <Mail className="w-8 h-8 text-zinc-600 mb-2" />
                    Select an email from the left list to view full content details, snippet, and manage.
                  </div>
                )}
              </div>

            </div>
          </div>
        )}

        {/* VIEW 2: PROFILE PAGE */}
        {activeTab === "profile" && (
          <div className="flex-1 overflow-y-auto px-4 py-8 md:px-8 max-w-3xl mx-auto w-full space-y-6">
            <div className={`p-6 md:p-8 rounded-2xl border ${cardClass}`}>
              
              <div className="flex flex-col md:flex-row items-center gap-6 border-b pb-6 mb-6 border-zinc-800/40">
                <div className="relative group">
                  <UserAvatar photoUrl={userPhotoURL} name={userName} className="w-20 h-20 shadow-[0_0_15px_rgba(59,130,246,0.25)]" />
                  <label className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-all cursor-pointer">
                    <span className="text-[10px] text-white font-bold uppercase tracking-wider">Change</span>
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={handlePhotoUpload} 
                      className="hidden" 
                    />
                  </label>
                  {uploadingPhoto && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/75 rounded-full flex-col">
                      <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-1" />
                      {photoUploadProgress !== null && (
                        <span className="text-[9px] text-emerald-400 font-mono font-bold">{Math.round(photoUploadProgress)}%</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="text-center md:text-left space-y-1">
                  <h2 className="text-xl font-bold flex items-center gap-2 justify-center md:justify-start">
                    {userName}
                  </h2>
                  <p className="text-xs text-zinc-500 font-mono">{userEmail}</p>
                  {userBio && (
                    <p className="text-xs text-zinc-400 italic font-sans max-w-md line-clamp-2">"{userBio}"</p>
                  )}
                  {isDeveloper ? (
                    <p className="text-[11px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 px-2.5 py-0.5 rounded-full inline-block mt-1 font-bold tracking-wide uppercase">
                      🛡️ Role: Developer (Secure System Access)
                    </p>
                  ) : (
                    <p className="text-[11px] bg-zinc-800/40 text-zinc-300 border border-zinc-700/50 px-2.5 py-0.5 rounded-full inline-block mt-1 font-semibold">
                      Tier: Standard / Free User
                    </p>
                  )}
                </div>
              </div>

              {/* Form editing profile details */}
              <form onSubmit={handleSaveProfile} className="space-y-4">
                <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                  Edit Personal Info
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-zinc-400">Display Name</label>
                    <input
                      type="text"
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                      className={`w-full p-3 rounded-xl border text-sm ${inputBgClass}`}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-zinc-400 flex justify-between items-center">
                      <span>Primary Email Address</span>
                      <span className="text-[10px] text-zinc-500 font-normal font-mono">(Managed by Auth)</span>
                    </label>
                    <input
                      type="email"
                      value={userEmail}
                      disabled={!!currentUser}
                      onChange={(e) => setUserEmail(e.target.value)}
                      className={`w-full p-3 rounded-xl border text-sm opacity-70 cursor-not-allowed ${inputBgClass}`}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-400">Biography / Status Bio</label>
                  <textarea
                    value={userBio}
                    onChange={(e) => setUserBio(e.target.value)}
                    placeholder="Tell us about yourself or enter your professional status bio..."
                    rows={3}
                    className={`w-full p-3 rounded-xl border text-sm resize-none ${inputBgClass}`}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-bold transition-all cursor-pointer active:scale-95 shadow-md"
                  >
                    Save profile changes
                  </button>
                  
                  <div className="flex items-center gap-2">
                    {userPhotoURL && (
                      <button
                        type="button"
                        onClick={handlePhotoDelete}
                        className="px-4 py-2.5 rounded-xl bg-red-950/40 border border-red-900/30 text-red-400 hover:text-red-300 hover:bg-red-900/20 text-xs font-bold transition-all cursor-pointer active:scale-95 flex items-center gap-1.5 shadow-sm"
                      >
                        Delete Photo
                      </button>
                    )}
                    
                    <label className="px-4 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 text-xs font-bold transition-all cursor-pointer active:scale-95 flex items-center gap-1.5 shadow-sm">
                      {uploadingPhoto ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400 shrink-0" />
                          <span>Uploading ({photoUploadProgress !== null ? `${Math.round(photoUploadProgress)}%` : "..."})</span>
                        </>
                      ) : (
                        "Upload Photo"
                      )}
                      <input 
                        type="file" 
                        accept="image/*" 
                        onChange={handlePhotoUpload} 
                        className="hidden" 
                        disabled={uploadingPhoto}
                      />
                    </label>
                  </div>
                </div>
              </form>

            </div>

            {/* AI stats metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className={`p-4 rounded-xl border ${cardClass} text-center space-y-1`}>
                <span className="text-xs text-zinc-500">Conversations</span>
                <p className="text-2xl font-black text-white">{conversations.length}</p>
              </div>
              <div className={`p-4 rounded-xl border ${cardClass} text-center space-y-1`}>
                <span className="text-xs text-zinc-500">API Calls Speed</span>
                <p className="text-2xl font-black text-zinc-300">~0.7s (Fast)</p>
              </div>
              <div className={`p-4 rounded-xl border ${cardClass} text-center space-y-1`}>
                <span className="text-xs text-zinc-500">Billing Usage</span>
                <p className="text-2xl font-black text-white">$0.00 (Free Trial)</p>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: SETTINGS PAGE */}
        {activeTab === "settings" && (
          <div className="flex-1 overflow-y-auto px-4 py-8 md:px-8 max-w-3xl mx-auto w-full space-y-6">
            
            <div className={`p-6 md:p-8 rounded-2xl border ${cardClass} space-y-6`}>
              
              <h2 className="text-lg font-bold border-b pb-4 border-zinc-800/40 flex items-center gap-2">
                <SettingsIcon className="w-5 h-5 text-zinc-400" />
                Customize Workspace Settings
              </h2>

              {/* Theme Settings */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                  <Moon className="w-4 h-4 text-zinc-500" />
                  Visual Workspace Theme
                </h3>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  Toggle between eye-safe Dark Theme and High-Contrast Light Theme.
                </p>
                <div className="flex items-center gap-2.5 pt-1.5">
                  <button
                    type="button"
                    onClick={() => handleSaveSettings("dark", language)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                      theme === "dark"
                        ? "bg-zinc-800 text-zinc-100 border-zinc-700"
                        : "bg-zinc-900 border-zinc-800 text-zinc-400"
                    }`}
                  >
                    <Moon className="w-4 h-4" />
                    <span>Eye-safe Dark Mode</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSaveSettings("light", language)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                      theme === "light"
                        ? "bg-zinc-100 text-zinc-900 border-zinc-300"
                        : "bg-zinc-900 border-zinc-800 text-zinc-400"
                    }`}
                  >
                    <Sun className="w-4 h-4" />
                    <span>High-Contrast Light Mode</span>
                  </button>
                </div>
              </div>

              {/* Language Preference Settings */}
              <div className="space-y-2 pt-3">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                  <Globe className="w-4 h-4 text-zinc-500" />
                  AI Companion Language
                </h3>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  Adjust default conversation system prompts response style.
                </p>
                <div className="flex flex-wrap items-center gap-2.5 pt-1.5">
                  {(["English", "Hinglish", "Hindi"] as const).map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => handleSaveSettings(theme, lang)}
                      className={`px-4 py-2 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                        language === lang
                          ? isDark
                            ? "bg-zinc-800 text-zinc-100 border-zinc-700"
                            : "bg-zinc-150 text-zinc-900 border-zinc-300"
                          : "bg-zinc-900 border-zinc-800 text-zinc-400"
                      }`}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              </div>

              {/* Progressive Web App (PWA) Installation Options */}
              <div className="space-y-3 pt-4 border-t border-zinc-800/40">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                  <Download className="w-4 h-4 text-zinc-500" />
                  Offline & Device Installation
                </h3>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  JX AI can be installed locally on Android, Windows, macOS, and iOS devices. Running as an app provides standalone fullscreen operation, offline startup, and native-feeling responses.
                </p>
                
                {isInstalled ? (
                  <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/20 text-zinc-300 text-xs flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    <span>JX AI is successfully installed and running on this device!</span>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border border-zinc-850 bg-zinc-950/40 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <span className="text-xs font-bold text-zinc-200 block">✦ Install JX AI App</span>
                        <span className="text-[11px] text-zinc-500 leading-relaxed block mt-0.5">
                          {deferredPrompt 
                            ? "Installation is supported natively on this browser!" 
                            : "Click the button or add to home screen manually via your browser's options."}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleInstallApp}
                        className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                          deferredPrompt 
                            ? "bg-blue-600 hover:bg-blue-500 text-white border-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.3)]"
                            : "bg-zinc-850 hover:bg-zinc-800 text-zinc-300 border-zinc-800"
                        }`}
                      >
                        <Download className="w-4 h-4" />
                        <span>{deferredPrompt ? "Install Now" : "Install Options"}</span>
                      </button>
                    </div>

                    {!deferredPrompt && (
                      <div className="border-t border-zinc-800/60 pt-2.5 text-[10px] text-zinc-500 space-y-1">
                        <span className="font-bold text-zinc-400 block">Device Installation Instructions:</span>
                        <p>• <strong className="text-zinc-400">Android / Chrome:</strong> Click the 3-dots menu button at top-right and select <strong className="text-zinc-400">Install app</strong>.</p>
                        <p>• <strong className="text-zinc-400">iOS / Safari:</strong> Tap the <strong className="text-zinc-400">Share</strong> icon at the bottom center and select <strong className="text-zinc-400">Add to Home Screen</strong>.</p>
                        <p>• <strong className="text-zinc-400">Windows & macOS (Chrome/Edge):</strong> Click the install icon <strong className="text-zinc-400">⊕</strong> in the browser's address bar.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* About Section */}
              <div className="space-y-3 pt-4 border-t border-zinc-800/40">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                  <Info className="w-4 h-4 text-zinc-500" />
                  About JX AI Platform
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed font-sans">
                  JX AI is built on the Google Gemini server-side engine APIs. It serves fully persistent chat sessions, supports rich nested rendering with custom copy controllers, and obeys localized cultural instructions.
                </p>
                
                {/* Core Principles */}
                <div className="space-y-2.5 pt-2">
                  {PRINCIPLES.map((principle, index) => (
                    <div key={index} className="p-3 rounded-xl bg-zinc-900/40 border border-zinc-800/40">
                      <span className="text-xs font-bold text-zinc-200 block">✦ {principle.title}</span>
                      <span className="text-[11px] text-zinc-500 leading-relaxed block mt-0.5">{principle.description}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>

          </div>
        )}

        {/* VIEW 4: HELP PAGE */}
        {activeTab === "help" && (
          <div className="flex-1 overflow-y-auto px-4 py-8 md:px-8 max-w-3xl mx-auto w-full space-y-6">
            <div className={`p-6 md:p-8 rounded-2xl border ${cardClass} space-y-6`}>
              
              <h2 className="text-lg font-bold border-b pb-4 border-zinc-800/40 flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-blue-400" />
                Help &amp; Documentation
              </h2>

              {/* Chat & Prompting Tips */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-blue-400" />
                  How to chat with JX AI
                </h3>
                <p className="text-xs text-zinc-500 leading-relaxed font-sans">
                  JX AI is highly adaptive. When starting a conversation, JX AI will greet you in English. From there, you can continue talking in English, Hindi (हिंदी), or Hinglish!
                </p>
                <div className="p-4 rounded-xl bg-zinc-950/40 border border-zinc-850/60 space-y-2.5 text-xs text-zinc-300">
                  <p>• <strong className="text-white">Hindi/Hinglish:</strong> If you speak in Hindi or Hinglish, JX AI will adopt a warm, respectful and friendly conversational tone (e.g. "राम राम लाडले, के ज्ञान हैं!").</p>
                  <p>• <strong className="text-white">Clarification:</strong> If your request or task is unclear, JX AI will politely ask for clarification instead of guessing.</p>
                  <p>• <strong className="text-white">Honesty:</strong> If JX AI doesn't know an answer, it will clearly state so instead of making up facts.</p>
                </div>
              </div>

              {/* Multimedia & Voice Capabilities */}
              <div className="space-y-3 pt-3">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-400" />
                  Multimodal &amp; Speech Support
                </h3>
                <p className="text-xs text-zinc-500 leading-relaxed font-sans">
                  Enjoy seamless interaction using your camera, microphone, or image files.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/40 space-y-1.5">
                    <span className="text-xs font-bold text-zinc-200 block flex items-center gap-1.5">
                      <ImageIcon className="w-4 h-4 text-blue-400" />
                      Visual Uploads
                    </span>
                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                      Upload images or drag-and-drop directly into the workspace. JX AI can read text, analyze photos, and explain diagram code.
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/40 space-y-1.5">
                    <span className="text-xs font-bold text-zinc-200 block flex items-center gap-1.5">
                      <Mic className="w-4 h-4 text-blue-400" />
                      Voice Input/Output
                    </span>
                    <p className="text-[11px] text-zinc-500 leading-relaxed font-sans">
                      Click the microphone icon to speak. Click the sound speaker icon to listen to JX AI's replies with high-quality text-to-speech.
                    </p>
                  </div>
                </div>
              </div>

              {/* Document Support */}
              <div className="space-y-2 pt-3">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-400" />
                  Document Analysis
                </h3>
                <p className="text-xs text-zinc-500 leading-relaxed font-sans">
                  Analyze PDF, TXT, or DOCX documents easily by uploading them.
                </p>
                <p className="text-xs text-zinc-400 font-sans">
                  Simply drag-and-drop your documents or click the paperclip attachment button. Text files will be parsed and injected into the chat context automatically!
                </p>
              </div>

              {/* Installable PWA Banner inside Help */}
              <div className="space-y-3 pt-3 border-t border-zinc-800/40">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                  <Download className="w-4 h-4 text-blue-400" />
                  Install App &amp; Offline Mode
                </h3>
                <p className="text-xs text-zinc-500 leading-relaxed font-sans">
                  Install JX AI as a Progressive Web App (PWA) to enjoy standalone fullscreen experience, offline startups, and optimized loading speeds.
                </p>
                
                {isInstalled ? (
                  <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/20 text-zinc-300 text-xs flex items-center gap-2 font-sans">
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    <span>JX AI App is fully installed and operating locally!</span>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-zinc-950/40 border border-zinc-850/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4 font-sans">
                    <div>
                      <span className="text-xs font-bold text-zinc-200 block">✦ Install App Shell</span>
                      <span className="text-[11px] text-zinc-500 block mt-0.5">
                        {deferredPrompt ? "Installation is supported on this device!" : "Add to home screen via your browser's options."}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleInstallApp}
                      className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                        deferredPrompt 
                          ? "bg-blue-600 hover:bg-blue-500 text-white border-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.3)]"
                          : "bg-zinc-850 hover:bg-zinc-800 text-zinc-300 border-zinc-800"
                      }`}
                    >
                      <Download className="w-4 h-4" />
                      <span>{deferredPrompt ? "Install Now" : "Install Options"}</span>
                    </button>
                  </div>
                )}
              </div>

            </div>
          </div>
        )}

        {/* VIEW 5: DEVELOPER CONSOLE & ADMIN PANEL */}
        {activeTab === "developer" && isDeveloper && (
          <div className="flex-1 overflow-y-auto px-4 py-8 md:px-8 max-w-6xl mx-auto w-full space-y-6">
            {/* Header Badge */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 shadow-lg">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-emerald-400" />
                  <span className="text-[10px] bg-emerald-500/15 text-emerald-300 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider">
                    System Level Secure
                  </span>
                </div>
                <h2 className="text-xl font-bold text-white font-sans">JX AI Developer Control Room</h2>
                <p className="text-xs text-zinc-400">
                  Authorized Admin account: <span className="font-mono text-emerald-400 font-bold">prathamjangra37@gmail.com</span>
                </p>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-950/60 border border-zinc-800/60 text-xs text-zinc-300 font-semibold font-mono">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Status: Fully Authenticated &amp; Unlocked</span>
              </div>
            </div>

            {/* Developer Sub-Tabs Selector */}
            <div className="flex border-b border-zinc-800/60 pb-1 gap-2 overflow-x-auto scrollbar-none">
              {(["admin", "users", "playground", "settings", "whatsapp"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDevSubTab(tab)}
                  className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                    devSubTab === tab
                      ? "border-emerald-500 text-emerald-400 font-extrabold"
                      : "border-transparent text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {tab === "admin" && "🛡️ Admin Console"}
                  {tab === "users" && "👥 User Management"}
                  {tab === "playground" && "🧪 LLM Playground"}
                  {tab === "settings" && "⚙️ System Configuration"}
                  {tab === "whatsapp" && "💬 WhatsApp Chatbot"}
                </button>
              ))}
            </div>

            {/* Sub-Tab: Admin Console */}
            {devSubTab === "admin" && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
                {/* Left diagnostics column */}
                <div className="lg:col-span-1 space-y-6">
                  {/* System Diagnostics */}
                  <div className={`p-5 rounded-2xl border ${cardClass} space-y-4`}>
                    <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2 border-b pb-2.5 border-zinc-800/40">
                      <Activity className="w-4 h-4 text-emerald-400" />
                      Diagnostics &amp; Latency
                    </h3>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-zinc-500 font-semibold">Server Gateway</span>
                        <span className="text-emerald-400 font-bold font-mono">ONLINE (Port 3000)</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-zinc-500 font-semibold">Environment</span>
                        <span className="text-zinc-300 font-bold font-mono uppercase">Production container</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-zinc-500 font-semibold">Premium Bypassing</span>
                        <span className="text-emerald-400 font-bold font-mono">ACTIVE (100% Free)</span>
                      </div>
                      
                      {/* Connection speed tester */}
                      <div className="pt-2">
                        <button
                          onClick={handleDevPing}
                          disabled={devLatencyTesting}
                          className="w-full py-2 px-3 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs font-bold hover:bg-zinc-800 hover:text-white transition-all flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <Activity className={`w-3.5 h-3.5 text-emerald-400 ${devLatencyTesting ? "animate-spin" : ""}`} />
                          <span>{devLatencyTesting ? "Pinging Server..." : "Run Connection Speed Test"}</span>
                        </button>
                        
                        {devLatency !== null && (
                          <div className="mt-2.5 p-3 rounded-xl bg-zinc-950/60 border border-zinc-900 text-center">
                            <span className="text-[10px] text-zinc-500 font-mono block">RESPONSE LATENCY</span>
                            <span className="text-2xl font-black text-emerald-400 font-mono">{devLatency} ms</span>
                            <span className="text-[10px] text-zinc-500 font-mono block mt-1">
                              {devLatency < 150 ? "⚡ Extremely Fast Connection" : devLatency < 400 ? "🟢 Standard Server Speed" : "🟡 Minor Latency Detected"}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Quota analytics box */}
                  <div className={`p-5 rounded-2xl border ${cardClass} space-y-4`}>
                    <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2 border-b pb-2.5 border-zinc-800/40">
                      <Database className="w-4 h-4 text-emerald-400" />
                      Storage &amp; Quota Analytics
                    </h3>
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-zinc-400 font-semibold">Local Sessions Cache</span>
                          <span className="text-zinc-300 font-bold font-mono">{conversations.length} / Unlimited</span>
                        </div>
                        <div className="h-1.5 w-full bg-zinc-950 rounded-full overflow-hidden border border-zinc-900">
                          <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, (conversations.length / 20) * 100)}%` }} />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-zinc-400 font-semibold">Weekly API Requests limit</span>
                          <span className="text-zinc-300 font-bold font-mono">Bypassed</span>
                        </div>
                        <div className="h-1.5 w-full bg-zinc-950 rounded-full overflow-hidden border border-zinc-900">
                          <div className="h-full bg-emerald-500 rounded-full" style={{ width: "100%" }} />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-zinc-400 font-semibold">Image Generation Quota</span>
                          <span className="text-emerald-400 font-bold font-mono">UNLIMITED (Developer)</span>
                        </div>
                        <div className="h-1.5 w-full bg-zinc-950 rounded-full overflow-hidden border border-zinc-900">
                          <div className="h-full bg-emerald-500 rounded-full" style={{ width: "100%" }} />
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-zinc-950/45 border border-zinc-900 space-y-1">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase font-mono">Workspace Connection</span>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className={`w-1.5 h-1.5 rounded-full ${workspaceToken ? "bg-blue-400 animate-pulse" : "bg-zinc-600"}`} />
                          <span className="text-xs text-zinc-300 font-medium">
                            {workspaceToken ? "Workspace API Connected" : "Workspace Standby"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right console logs column */}
                <div className="lg:col-span-2 space-y-6">
                  <div className={`p-5 rounded-2xl border ${cardClass} flex flex-col h-full space-y-4 min-h-[350px]`}>
                    <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2 border-b pb-2.5 border-zinc-800/40">
                      <Layers className="w-4 h-4 text-emerald-400" />
                      Developer Terminal Logs
                    </h3>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Observe authorized database triggers, security checks, and backend communication logs below:
                    </p>
                    
                    <div className="flex-1 bg-black/90 rounded-xl border border-zinc-900 p-4 font-mono text-[10px] text-zinc-400 space-y-1.5 overflow-y-auto leading-relaxed max-h-[380px] scrollbar-thin scrollbar-thumb-zinc-900">
                      {devLogs.map((log, idx) => (
                        <div key={idx} className="flex gap-2.5">
                          <span className="text-zinc-600 shrink-0">[{log.time}]</span>
                          <span className={`shrink-0 uppercase font-bold text-[8px] px-1.5 py-0.5 rounded ${
                            log.type === "success" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                            log.type === "error" ? "bg-red-500/10 text-red-400 border border-red-500/20" :
                            log.type === "system" ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" : "bg-zinc-800 border border-zinc-700/50 text-zinc-400"
                          }`}>
                            {log.type}
                          </span>
                          <span className="flex-1 text-zinc-300 break-all">{log.msg}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Sub-Tab: User Management */}
            {devSubTab === "users" && (
              <div className="space-y-4 animate-fadeIn">
                <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
                  {/* Search and stats bar */}
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <input
                      type="text"
                      placeholder="Search registered users by name, email or uid..."
                      value={usersSearchQuery}
                      onChange={(e) => setUsersSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-4 py-2.5 rounded-xl border text-xs bg-zinc-950 border-zinc-800 text-zinc-300"
                    />
                  </div>
                  <button
                    onClick={fetchUsersDirectory}
                    disabled={loadingUsersDirectory}
                    className="px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-xs font-bold border border-zinc-800 transition-all flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 text-emerald-400 ${loadingUsersDirectory ? "animate-spin" : ""}`} />
                    <span>Refresh List</span>
                  </button>
                </div>

                {/* Users list box */}
                <div className={`rounded-2xl border ${cardClass} overflow-hidden`}>
                  <div className="p-4 bg-zinc-950/50 border-b border-zinc-800 flex justify-between items-center">
                    <div>
                      <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                        <Users className="w-4 h-4 text-emerald-400" />
                        Users Directory ({directoryUsers.length} total)
                      </h3>
                    </div>
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-mono font-bold uppercase">
                      Secure System Derived Roles
                    </span>
                  </div>

                  {loadingUsersDirectory ? (
                    <div className="py-16 text-center space-y-3">
                      <RotateCcw className="w-8 h-8 text-emerald-400 animate-spin mx-auto" />
                      <p className="text-xs text-zinc-500 font-mono">Loading registered user profiles from Firestore...</p>
                    </div>
                  ) : directoryUsers.length === 0 ? (
                    <div className="py-16 text-center space-y-2">
                      <Users className="w-10 h-10 text-zinc-700 mx-auto" />
                      <p className="text-sm font-semibold text-zinc-400">No users found</p>
                      <p className="text-xs text-zinc-600 font-mono">Run dynamic operations to register new users.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-zinc-800 bg-zinc-950/20 text-zinc-500 font-semibold">
                            <th className="p-4">User Details</th>
                            <th className="p-4">UID Reference</th>
                            <th className="p-4">Authentication Type</th>
                            <th className="p-4">Secure Derived Role</th>
                            <th className="p-4 text-right font-mono">Last Login</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-850/40">
                          {directoryUsers
                            .filter((u) => {
                              const q = usersSearchQuery.toLowerCase();
                              return (
                                (u.displayName || "").toLowerCase().includes(q) ||
                                (u.email || "").toLowerCase().includes(q) ||
                                (u.uid || "").toLowerCase().includes(q)
                              );
                            })
                            .map((u) => {
                              const isUserDev = u.email === "prathamjangra37@gmail.com";
                              return (
                                <tr key={u.uid} className="hover:bg-zinc-900/25 transition-colors">
                                  <td className="p-4 flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs uppercase text-zinc-200 border ${
                                      isUserDev 
                                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" 
                                        : u.isAnonymous 
                                          ? "bg-zinc-800/40 border-zinc-700/40 text-zinc-400"
                                          : "bg-blue-500/10 border-blue-500/30 text-blue-400"
                                    }`}>
                                      {(u.displayName || "U").charAt(0)}
                                    </div>
                                    <div>
                                      <p className="font-bold text-zinc-200">{u.displayName || "Guest User"}</p>
                                      <p className="text-[10px] text-zinc-500 font-mono leading-none mt-0.5">{u.email}</p>
                                    </div>
                                  </td>
                                  <td className="p-4 font-mono text-[10px] text-zinc-500 select-all max-w-[120px] truncate" title={u.uid}>
                                    {u.uid}
                                  </td>
                                  <td className="p-4">
                                    {u.isAnonymous ? (
                                      <span className="text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700/50 px-2 py-0.5 rounded font-semibold uppercase">
                                        Anonymous Guest
                                      </span>
                                    ) : u.email && u.email.endsWith("@gmail.com") ? (
                                      <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded font-semibold uppercase">
                                        Google OAuth
                                      </span>
                                    ) : (
                                      <span className="text-[10px] bg-purple-500/10 text-purple-400 border border-purple-500/20 px-2 py-0.5 rounded font-semibold uppercase">
                                        Email / Password
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-4">
                                    {isUserDev ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider shadow-[0_0_10px_rgba(16,185,129,0.1)]">
                                        <Unlock className="w-2.5 h-2.5" />
                                        Developer
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[10px] bg-zinc-800/60 text-zinc-400 border border-zinc-700 px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wider">
                                        <Lock className="w-2.5 h-2.5 text-zinc-500" />
                                        Member
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-4 text-right text-zinc-500 font-mono text-[11px]">
                                    {u.lastLogin && typeof u.lastLogin.toDate === "function" 
                                      ? u.lastLogin.toDate().toLocaleString() 
                                      : u.lastLogin && u.lastLogin.seconds 
                                        ? new Date(u.lastLogin.seconds * 1000).toLocaleString()
                                        : String(u.lastLogin || "N/A")}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Sub-Tab: LLM Playground */}
            {devSubTab === "playground" && (
              <div className="space-y-6 animate-fadeIn">
                <div className={`p-5 rounded-2xl border ${cardClass} space-y-4`}>
                  <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2 border-b pb-2.5 border-zinc-800/40">
                    <Cpu className="w-4 h-4 text-emerald-400" />
                    LLM Prompt Tester &amp; Debugger
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Directly interact with the underlying Gemini LLM API as Developer to test system prompts, temperatures, and custom directives.
                  </p>
                  
                  <div className="space-y-4">
                    {/* Settings row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Model Selector */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-zinc-400">Target Model</label>
                        <select
                          value={devModel}
                          onChange={(e) => setDevModel(e.target.value)}
                          className="w-full p-2.5 rounded-xl border text-xs bg-zinc-950 border-zinc-800 text-zinc-300 font-mono"
                        >
                          <option value="gemini-3.5-flash">gemini-3.5-flash (Standard Faster)</option>
                          <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview (Deeper Logic)</option>
                          <option value="gemini-3.1-flash-lite-image">gemini-3.1-flash-lite-image (Imagen 3)</option>
                        </select>
                      </div>

                      {/* Temperature Slider */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center text-xs">
                          <label className="font-semibold text-zinc-400">Temperature (Creativity)</label>
                          <span className="font-mono text-emerald-400 font-bold">{devTemp}</span>
                        </div>
                        <input
                          type="range"
                          min="0.0"
                          max="1.0"
                          step="0.1"
                          value={devTemp}
                          onChange={(e) => setDevTemp(parseFloat(e.target.value))}
                          className="w-full accent-emerald-500 h-1 bg-zinc-950 rounded-lg cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* System Instruction */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-zinc-400">System Instruction</label>
                      <input
                        type="text"
                        value={devSystemInstruction}
                        onChange={(e) => setDevSystemInstruction(e.target.value)}
                        className="w-full p-2.5 rounded-xl border text-xs font-sans bg-zinc-950 border-zinc-800 text-zinc-300"
                        placeholder="Define system guidelines for the agent..."
                      />
                    </div>

                    {/* User Prompt */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-zinc-400">User Prompt</label>
                      <textarea
                        value={devPrompt}
                        onChange={(e) => setDevPrompt(e.target.value)}
                        rows={3}
                        className="w-full p-3 rounded-xl border text-xs font-sans bg-zinc-950 border-zinc-800 text-zinc-300 leading-relaxed"
                        placeholder="Write prompt test payload..."
                      />
                    </div>

                    {/* Run evaluation Button */}
                    <div className="pt-1">
                      <button
                        onClick={handleDevPlaygroundRun}
                        disabled={devPlaygroundLoading || !devPrompt.trim()}
                        className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Terminal className={`w-4 h-4 ${devPlaygroundLoading ? "animate-pulse" : ""}`} />
                        <span>{devPlaygroundLoading ? "Evaluating Payload..." : "Execute LLM Test Call (100% Free)"}</span>
                      </button>
                    </div>

                    {/* Playground Output */}
                    {devResult && (
                      <div className="space-y-1.5 pt-2">
                        <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest font-mono block">
                          Response Raw Payload
                        </label>
                        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-900/80 max-h-[250px] overflow-y-auto text-xs text-zinc-300 font-mono leading-relaxed whitespace-pre-wrap select-all">
                          {devResult}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Sub-Tab: System Configuration */}
            {devSubTab === "settings" && (
              <div className="space-y-6 animate-fadeIn">
                <div className={`p-5 rounded-2xl border ${cardClass} space-y-4`}>
                  <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2 border-b pb-2.5 border-zinc-800/40">
                    <SettingsIcon className="w-4 h-4 text-emerald-400" />
                    Developer Bypass &amp; Simulator
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Simulate alternative environments and customize local storage cache for secure end-to-end integration testing.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    <div className="p-4 rounded-xl bg-zinc-950/40 border border-zinc-900 space-y-2">
                      <span className="text-xs font-bold text-zinc-200 block">✦ Free Tier Limit Simulation</span>
                      <p className="text-[11px] text-zinc-500 leading-relaxed">
                        Standard free accounts are limited to 3 active chats. Since you are Developer, this limit is automatically bypassed.
                      </p>
                      <div className="pt-2 flex items-center justify-between">
                        <span className="text-xs text-zinc-400 font-semibold font-mono">Bypass Status</span>
                        <span className="text-xs font-bold font-mono text-emerald-400 uppercase bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/25">
                          ENABLED (Bypassed)
                        </span>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-zinc-950/40 border border-zinc-900 space-y-2">
                      <span className="text-xs font-bold text-zinc-200 block">✦ Developer Mode Status</span>
                      <p className="text-[11px] text-zinc-500 leading-relaxed">
                        Any email exactly matching <strong className="text-zinc-400 font-mono">prathamjangra37@gmail.com</strong> is dynamically assigned the secure <strong className="text-emerald-400 font-mono">Developer</strong> role.
                      </p>
                      <div className="pt-2 flex items-center justify-between">
                        <span className="text-xs text-zinc-400 font-semibold font-mono">Active Role</span>
                        <span className="text-xs font-bold font-mono text-emerald-400 uppercase bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/25">
                          🛡️ Developer (Admin)
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-zinc-800 flex flex-wrap gap-3">
                    <button
                      onClick={() => {
                        if (window.confirm("Do you want to reset developer logs?")) {
                          setDevLogs([
                            { time: new Date().toLocaleTimeString(), type: "info", msg: "Developer match authorized securely: prathamjangra37@gmail.com" },
                            { time: new Date().toLocaleTimeString(), type: "success", msg: "Firebase Authentication context synced with developer role." }
                          ]);
                          handleShowNotification("Developer logs cleared.");
                        }
                      }}
                      className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold border border-zinc-800 cursor-pointer"
                    >
                      Clear Dev Logs
                    </button>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(JSON.stringify(currentUser, null, 2));
                        handleShowNotification("Copied raw Auth Context object.");
                      }}
                      className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold border border-zinc-800 cursor-pointer"
                    >
                      Copy Raw Auth Context
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Sub-Tab: WhatsApp Chatbot Setup */}
            {devSubTab === "whatsapp" && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fadeIn text-left">
                {/* Left Column (Status & Test Message) */}
                <div className="lg:col-span-5 space-y-6">
                  {/* WhatsApp connection status card */}
                  <div className={`p-5 rounded-2xl border ${cardClass} space-y-4`}>
                    <div className="flex items-center justify-between border-b pb-2.5 border-zinc-800/40">
                      <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                        <Activity className="w-4 h-4 text-emerald-400" />
                        Connection Status
                      </h3>
                      <button
                        onClick={fetchWhatsappStatus}
                        disabled={loadingWhatsappStatus}
                        className="p-1 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-all cursor-pointer"
                        title="Refresh connection status"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${loadingWhatsappStatus ? "animate-spin" : ""}`} />
                      </button>
                    </div>

                    {loadingWhatsappStatus ? (
                      <div className="py-8 flex flex-col items-center justify-center space-y-2">
                        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-[11px] text-zinc-500 font-medium">Checking connection...</span>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* Huge glowy status badge */}
                        <div className="flex items-center gap-3 p-3.5 rounded-xl bg-zinc-950/40 border border-zinc-900">
                          {whatsappStatus?.status === "connected" ? (
                            <>
                              <div className="relative flex h-3.5 w-3.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500"></span>
                              </div>
                              <div>
                                <span className="text-xs font-bold text-emerald-400 block font-mono uppercase tracking-wide">CONNECTED</span>
                                <span className="text-[10px] text-zinc-400">Meta Cloud API active</span>
                              </div>
                            </>
                          ) : whatsappStatus?.status === "partial" ? (
                            <>
                              <div className="relative flex h-3.5 w-3.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-amber-500"></span>
                              </div>
                              <div>
                                <span className="text-xs font-bold text-amber-400 block font-mono uppercase tracking-wide">PARTIALLY CONFIGURED</span>
                                <span className="text-[10px] text-zinc-400">Missing some secrets</span>
                              </div>
                            </>
                          ) : (
                            <>
                              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-zinc-600"></span>
                              <div>
                                <span className="text-xs font-bold text-zinc-400 block font-mono uppercase tracking-wide">DISCONNECTED</span>
                                <span className="text-[10px] text-zinc-500">No active secrets set</span>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Secret Checks */}
                        <div className="space-y-2 text-xs">
                          <div className="flex justify-between items-center bg-zinc-950/20 px-2.5 py-2 rounded-xl border border-zinc-900/60">
                            <span className="text-zinc-500 font-mono text-[10px]">WHATSAPP_ACCESS_TOKEN</span>
                            <span className={`text-[10px] font-bold font-mono px-2.5 py-0.5 rounded-full ${whatsappStatus?.config?.accessTokenSet ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20" : "text-zinc-600 bg-zinc-900 border border-zinc-800"}`}>
                              {whatsappStatus?.config?.accessTokenSet ? "SET" : "MISSING"}
                            </span>
                          </div>
                          <div className="flex justify-between items-center bg-zinc-950/20 px-2.5 py-2 rounded-xl border border-zinc-900/60">
                            <span className="text-zinc-500 font-mono text-[10px]">WHATSAPP_PHONE_NUMBER_ID</span>
                            <span className={`text-[10px] font-bold font-mono px-2.5 py-0.5 rounded-full ${whatsappStatus?.config?.phoneIdSet ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20" : "text-zinc-600 bg-zinc-900 border border-zinc-800"}`}>
                              {whatsappStatus?.config?.phoneIdSet ? "SET" : "MISSING"}
                            </span>
                          </div>
                          <div className="flex justify-between items-center bg-zinc-950/20 px-2.5 py-2 rounded-xl border border-zinc-900/60">
                            <span className="text-zinc-500 font-mono text-[10px]">WHATSAPP_VERIFY_TOKEN</span>
                            <span className={`text-[10px] font-bold font-mono px-2.5 py-0.5 rounded-full ${whatsappStatus?.config?.verifyTokenSet ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20" : "text-zinc-400 bg-zinc-900 border border-zinc-800"}`}>
                              {whatsappStatus?.config?.verifyTokenSet ? "CUSTOM" : "DEFAULT"}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Test message button & panel */}
                  <form onSubmit={handleSendTestMessage} className={`p-5 rounded-2xl border ${cardClass} space-y-4`}>
                    <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2 border-b pb-2.5 border-zinc-800/40">
                      <Send className="w-4 h-4 text-emerald-400" />
                      Test Message Delivery
                    </h3>
                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                      Send a dynamic live WhatsApp message to verify that your credentials, webhooks, and the official Meta API are properly configured and authorized.
                    </p>

                    <div className="space-y-3 pt-1">
                      <div>
                        <label className="text-[10px] font-bold text-zinc-500 block uppercase tracking-wider mb-1.5">RECIPIENT PHONE NUMBER</label>
                        <input
                          type="text"
                          required
                          value={testRecipientPhone}
                          onChange={(e) => setTestRecipientPhone(e.target.value)}
                          placeholder="e.g. 919876543210 (include country code)"
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-zinc-500 block uppercase tracking-wider mb-1.5">TEST MESSAGE BODY (OPTIONAL)</label>
                        <textarea
                          value={testMessageContent}
                          onChange={(e) => setTestMessageContent(e.target.value)}
                          placeholder="If left empty, JX AI sends a cool default welcoming system message."
                          rows={2}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500 resize-none"
                        />
                      </div>

                      {testMessageResult && (
                        <div className={`p-3 rounded-xl border text-[11px] leading-relaxed ${testMessageResult.success ? "bg-emerald-500/5 border-emerald-500/25 text-emerald-300" : "bg-red-500/5 border-red-500/25 text-red-300"}`}>
                          <strong>{testMessageResult.success ? "Success: " : "Error: "}</strong>
                          {testMessageResult.msg}
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={sendingTestMessage || loadingWhatsappStatus}
                        className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/35 text-zinc-950 font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-500/10"
                      >
                        {sendingTestMessage ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                            <span>Delivering Message...</span>
                          </>
                        ) : (
                          <>
                            <Send className="w-3.5 h-3.5" />
                            <span>Send Live Test Message</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>

                {/* Right Column (Webhook Details & Setup Guide) */}
                <div className="lg:col-span-7 space-y-6">
                  {/* Credentials block */}
                  <div className={`p-5 rounded-2xl border ${cardClass} space-y-4`}>
                    <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2 border-b pb-2.5 border-zinc-800/40">
                      <Terminal className="w-4 h-4 text-emerald-400" />
                      Webhook Configuration Credentials
                    </h3>
                    
                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Callback URL</span>
                          <span className="text-[9px] text-zinc-400 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded font-mono">POST</span>
                        </div>
                        <div className="flex gap-2 items-center">
                          <input
                            type="text"
                            readOnly
                            value={`${window.location.origin}/api/whatsapp/webhook`}
                            className="w-full bg-zinc-950 border border-zinc-800/80 rounded-xl px-3 py-2 font-mono text-[11px] text-emerald-400 select-all focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(`${window.location.origin}/api/whatsapp/webhook`);
                              handleShowNotification("Copied Webhook URL!");
                            }}
                            className="px-3.5 py-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 hover:text-white cursor-pointer font-bold text-[10px] whitespace-nowrap transition-all"
                          >
                            COPY
                          </button>
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Verify Token</span>
                          <span className="text-[9px] text-zinc-400 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded font-mono">string</span>
                        </div>
                        <div className="flex gap-2 items-center">
                          <input
                            type="text"
                            readOnly
                            value={whatsappStatus?.config?.verifyTokenValue || "jx_ai_whatsapp_token_2026"}
                            className="w-full bg-zinc-950 border border-zinc-800/80 rounded-xl px-3 py-2 font-mono text-[11px] text-zinc-300 select-all focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(whatsappStatus?.config?.verifyTokenValue || "jx_ai_whatsapp_token_2026");
                              handleShowNotification("Copied Verify Token!");
                            }}
                            className="px-3.5 py-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 hover:text-white cursor-pointer font-bold text-[10px] whitespace-nowrap transition-all"
                          >
                            COPY
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Step-by-Step Guide */}
                  <div className={`p-5 rounded-2xl border ${cardClass} space-y-4`}>
                    <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2 border-b pb-2.5 border-zinc-800/40">
                      <BookOpen className="w-4 h-4 text-emerald-400" />
                      Step-by-Step Setup Guide
                    </h3>

                    <div className="space-y-4 pt-1 text-zinc-300 text-xs leading-relaxed">
                      <div className="p-4 rounded-xl bg-zinc-950/40 border border-zinc-900/60 space-y-1.5">
                        <div className="flex items-center gap-2 text-emerald-400 font-bold">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px]">1</span>
                          <span>Create Meta Developer App</span>
                        </div>
                        <p className="text-zinc-400 text-[11px] leading-relaxed">
                          Visit the <a href="https://developers.facebook.com/" target="_blank" rel="noopener noreferrer" className="text-emerald-400 underline hover:text-emerald-300">Meta for Developers Portal</a>. Create a new "Other" or "Business" application and add the <strong className="text-white">WhatsApp Product</strong> to your app.
                        </p>
                      </div>

                      <div className="p-4 rounded-xl bg-zinc-950/40 border border-zinc-900/60 space-y-1.5">
                        <div className="flex items-center gap-2 text-emerald-400 font-bold">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px]">2</span>
                          <span>Set Up Webhooks</span>
                        </div>
                        <p className="text-zinc-400 text-[11px] leading-relaxed">
                          Navigate to the <strong className="text-white">WhatsApp &gt; Configuration</strong> page. Under Webhooks, click "Edit", paste the <strong className="text-emerald-400">Callback URL</strong> and <strong className="text-emerald-400">Verify Token</strong> shown above, then click "Verify and Save".
                        </p>
                      </div>

                      <div className="p-4 rounded-xl bg-zinc-950/40 border border-zinc-900/60 space-y-1.5">
                        <div className="flex items-center gap-2 text-emerald-400 font-bold">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px]">3</span>
                          <span>Subscribe to messages</span>
                        </div>
                        <p className="text-zinc-400 text-[11px] leading-relaxed">
                          In Webhooks fields section, click "Subscribe" for the <strong className="text-white">messages</strong> subscription field. This triggers Meta to send a POST payload whenever an end-user messages your phone.
                        </p>
                      </div>

                      <div className="p-4 rounded-xl bg-zinc-950/40 border border-zinc-900/60 space-y-1.5">
                        <div className="flex items-center gap-2 text-emerald-400 font-bold">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px]">4</span>
                          <span>Add Settings Secrets</span>
                        </div>
                        <p className="text-zinc-400 text-[11px] leading-relaxed">
                          Configure <strong className="text-zinc-300 font-mono">WHATSAPP_ACCESS_TOKEN</strong> and <strong className="text-zinc-300 font-mono">WHATSAPP_PHONE_NUMBER_ID</strong> inside the Secrets menu to authorize JX AI to respond.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* BOTTOM INPUT FOOTER BAR */}
        {activeTab === "chat" && (
          <div className={`p-4 border-t shrink-0 z-20 ${headerClass}`}>
            <div className="max-w-3xl mx-auto">
              
              {/* Staged Attachments Preview bar */}
              {stagedAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3 p-2.5 rounded-xl bg-zinc-950/40 border border-zinc-800/40 max-h-24 overflow-y-auto">
                  {stagedAttachments.map((att, idx) => (
                    <div
                      key={idx}
                      className="relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 shadow-sm"
                    >
                      {att.type === "image" ? (
                        <img
                          src={att.data}
                          alt={att.name}
                          className="w-5 h-5 rounded object-cover border border-zinc-700/50"
                        />
                      ) : (
                        <FileText className="w-4 h-4 text-zinc-400 shrink-0" />
                      )}
                      <span className="max-w-[120px] truncate text-[11px] font-medium">{att.name}</span>
                      <button
                        type="button"
                        onClick={() => setStagedAttachments((prev) => prev.filter((_, i) => i !== idx))}
                        className="p-0.5 rounded-full hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors cursor-pointer"
                        title="Remove file"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Dynamic Action Buttons above text-box */}
              <div className="flex justify-between items-center gap-2 mb-2">
                {/* Left side: Stop generating OR Generate image mode toggle */}
                {loading ? (
                  <button
                    type="button"
                    onClick={handleStopGenerating}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-red-400 bg-red-500/10 border border-red-500/20 cursor-pointer animate-pulse"
                  >
                    <StopCircle className="w-3.5 h-3.5" />
                    <span>Stop Generating</span>
                  </button>
                ) : (
                  isDeveloper && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsGenerateImageMode((prev) => !prev);
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                        isGenerateImageMode 
                          ? "border-blue-500/40 bg-blue-600/10 text-blue-400" 
                          : "border-zinc-800 bg-zinc-900/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                      }`}
                      title="Toggle AI Image Generation Mode"
                    >
                      <Sparkles className={`w-3.5 h-3.5 ${isGenerateImageMode ? "text-blue-400 animate-pulse" : "text-zinc-500"}`} />
                      <span>{isGenerateImageMode ? "Generate Image Active" : "Generate Image Mode"}</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        Dev Bypass
                      </span>
                    </button>
                  )
                )}

                {/* Regenerate Response button when model completed */}
                {!loading && messages.length > 0 && messages[messages.length - 1].role === "model" && (
                  <button
                    type="button"
                    onClick={handleRegenerateResponse}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Regenerate Response</span>
                  </button>
                )}
              </div>

              {/* Aspect Ratio Picker when in Generate Image mode */}
              {isGenerateImageMode && (
                <div className="flex items-center gap-2.5 mb-2.5 p-2 rounded-xl bg-blue-950/15 border border-blue-900/35 text-xs">
                  <span className="text-blue-400 font-medium ml-1">Aspect Ratio:</span>
                  {(["1:1", "16:9", "4:3", "9:16"] as const).map((ratio) => (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => setImageAspectRatio(ratio)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                        imageAspectRatio === ratio
                          ? "bg-blue-500 text-white shadow-sm"
                          : "bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800"
                      }`}
                    >
                      {ratio}
                    </button>
                  ))}
                  <span className="text-zinc-500 text-[10px] ml-auto font-mono">Powered by Google Imagen</span>
                </div>
              )}

              {/* Main Submit Form with integrated voice and attachment tools */}
              {!isOnline && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-red-950/15 border border-red-900/30 text-zinc-100 text-xs md:text-sm shadow-xl relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-[2px] bg-red-500 animate-pulse" />
                  <div className="flex items-center gap-3.5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10 border border-red-500/20 text-red-400">
                      <WifiOff className="h-5 w-5 animate-pulse" />
                    </div>
                    <div>
                      <p className="font-bold text-zinc-100 text-xs sm:text-sm">You're offline</p>
                      <p className="text-[11px] text-zinc-400 mt-0.5 leading-tight">Connect to the internet to continue chatting with JX AI.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-zinc-950 border border-zinc-900 text-zinc-500 text-xs font-bold cursor-not-allowed flex items-center justify-center gap-2 select-none"
                  >
                    <Send className="w-3.5 h-3.5 opacity-40" />
                    <span>Send Disabled</span>
                  </button>
                </div>
              )}

              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!isOnline) return;
                  handleSendMessage();
                }}
                className={!isOnline ? "hidden" : "relative flex items-center"}
              >
                {/* Hidden File Input */}
                <input
                  type="file"
                  id="chat-file-upload"
                  multiple
                  onChange={(e) => handleFileChange(e)}
                  className="hidden"
                  accept="image/*,text/*,.pdf,.doc,.docx,.json,.js,.ts"
                />

                {/* Hidden Image Input */}
                <input
                  type="file"
                  id="chat-image-upload"
                  onChange={(e) => handleFileChange(e, "image")}
                  className="hidden"
                  accept="image/*"
                />

                {/* Left Side 1: Attachment Paperclip Icon */}
                <button
                  type="button"
                  onClick={() => document.getElementById("chat-file-upload")?.click()}
                  disabled={loading}
                  className="absolute left-3 p-2 rounded-xl text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40 transition-all cursor-pointer disabled:opacity-40"
                  title="Attach any file"
                >
                  <Paperclip className="w-4 h-4" />
                </button>

                {/* Left Side 2: Dedicated Upload Image Button */}
                <button
                  type="button"
                  onClick={() => document.getElementById("chat-image-upload")?.click()}
                  disabled={loading}
                  className="absolute left-11 p-2 rounded-xl text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40 transition-all cursor-pointer disabled:opacity-40"
                  title="Upload Image"
                >
                  <ImageIcon className="w-4 h-4 text-blue-500" />
                </button>

                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    isGenerateImageMode 
                      ? "Describe the image you want JX AI to generate..." 
                      : "Message JX AI..."
                  }
                  disabled={loading}
                  className={`w-full pl-[76px] pr-24 py-3.5 rounded-2xl border focus:outline-none transition-all text-sm md:text-base disabled:opacity-50 ${
                    isGenerateImageMode 
                      ? "border-blue-500/50 bg-blue-950/5 shadow-[0_0_15px_rgba(59,130,246,0.15)] placeholder:text-blue-300/40" 
                      : inputBgClass
                  }`}
                />

                {/* Right Side Inner: Voice mic and Send trigger */}
                <div className="absolute right-2.5 flex items-center gap-1.5">
                  {/* Speech-to-text recording mic */}
                  <button
                    type="button"
                    onClick={isListening ? stopListening : startListening}
                    disabled={loading}
                    className={`p-2 rounded-xl transition-all cursor-pointer ${
                      isListening 
                        ? "bg-red-500/10 text-red-400 border border-red-500/30 animate-pulse" 
                        : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
                    }`}
                    title={isListening ? "Voice typing active... click to pause" : "Voice typing typing input"}
                  >
                    {isListening ? (
                      <MicOff className="w-4 h-4 text-red-400 animate-bounce" />
                    ) : (
                      <Mic className="w-4 h-4" />
                    )}
                  </button>

                  <button
                    type="submit"
                    disabled={loading || (!input.trim() && stagedAttachments.length === 0)}
                    className="p-2 rounded-xl bg-zinc-950 border border-zinc-800/80 hover:bg-[#121215] disabled:opacity-35 transition-all flex items-center justify-center cursor-pointer disabled:cursor-not-allowed active:scale-95 shadow-md"
                    title={isGenerateImageMode ? "Generate AI Image" : "Send Message"}
                  >
                    {isGenerateImageMode ? (
                      <Sparkles className="w-4 h-4 text-[#3b82f6]" />
                    ) : (
                      <Send className="w-4 h-4 text-[#3b82f6]" />
                    )}
                  </button>
                </div>
              </form>
              
              <p className="text-[10px] text-zinc-500 text-center mt-2.5 font-normal">
                JX AI may provide helpful summaries and step-by-step guidance. Confirm important facts.
              </p>
            </div>
          </div>
        )}

      </main>

      {/* PREMIUM MODAL OVERLAY */}
      <AnimatePresence>
        {showImagePremiumModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowImagePremiumModal(false)}
              className="absolute inset-0 bg-black"
            />
            
            {/* Modal Box */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-md overflow-hidden rounded-3xl border border-zinc-800 bg-[#0c0c0e] p-6 shadow-2xl text-center"
            >
              {/* Glowing Top Line Accent */}
              <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />
              
              {/* Visual Icon */}
              <div className="mx-auto my-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900 border border-zinc-800 text-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.15)]">
                <Sparkles className="h-6 w-6" />
              </div>
              
              {/* Title */}
              <h3 className="text-lg font-bold text-zinc-100 tracking-tight mt-4">
                Paid API Key Required
              </h3>
              <p className="text-[11px] text-zinc-500 font-bold uppercase tracking-widest mt-1">
                Premium AI Feature
              </p>
              
              {/* Explanation */}
              <div className="mt-4 text-left space-y-3.5 bg-zinc-950/50 p-4 rounded-2xl border border-zinc-900 text-zinc-300 text-xs leading-relaxed">
                <p>
                  Image generation models (like <code className="text-blue-400 font-mono bg-blue-950/20 px-1 rounded">gemini-3.1-flash-lite-image</code>) require a supported paid Gemini API key.
                </p>
                <p className="font-semibold text-zinc-400 border-t border-zinc-900 pt-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  Available Free Features:
                </p>
                <ul className="space-y-1.5 pl-3 list-disc text-zinc-400 text-[11px]">
                  <li>
                    <strong className="text-zinc-200">Text Chats & Guidance:</strong> 100% active and free without errors.
                  </li>
                  <li>
                    <strong className="text-zinc-200">Image Uploads & Visual analysis:</strong> Fully supported! Drag-and-drop or select images to do deep analysis/OCR.
                  </li>
                </ul>
              </div>
              
              {/* Action Buttons */}
              <div className="mt-6 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setShowImagePremiumModal(false)}
                  className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm cursor-pointer transition-all shadow-lg active:scale-98"
                >
                  Continue with Free Features
                </button>
                <p className="text-[10px] text-zinc-500 leading-relaxed mt-2">
                  Configure a supported paid Gemini API key in <strong className="text-zinc-400">Settings &gt; Secrets</strong> to unlock premium generation models.
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
