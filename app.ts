// Shared Express application configuration for JX AI
import express from "express";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { 
  getOrCreateFirebaseUserByPhone, 
  syncUserInDirectory, 
  loadWhatsAppConversation, 
  saveWhatsAppConversation, 
  sendWhatsAppTextMessage, 
  formatTextForWhatsApp 
} from "./src/lib/whatsappService.js";

dotenv.config();

const app = express();

// Set body parsers with limits for handling base64-encoded visual attachments
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Enable CORS support
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Lazy initialize the Gemini API client
let ai: GoogleGenAI | null = null;

function getGeminiClient() {
  if (!ai) {
    const apiKey = process.env.GEMINI_API_KEY;
    console.log(`[getGeminiClient] Checking GEMINI_API_KEY... Present: ${!!apiKey}`);
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is missing in the environment. Please configure it in your Settings > Secrets.");
    }
    ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return ai;
}

// API endpoint for Chat
async function callGeminiWithRetryAndFallback(
  client: GoogleGenAI,
  contents: any,
  systemInstruction: string
) {
  // Put gemini-3.1-flash-lite first to avoid free-tier quota limits (429) on gemini-3.5-flash, with others as robust fallbacks
  const models = ["gemini-3.1-flash-lite", "gemini-flash-latest", "gemini-3.5-flash"];
  let lastError: any = null;

  for (const modelName of models) {
    const maxRetries = 2;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Attempting Gemini generation using model: ${modelName} (Attempt ${attempt}/${maxRetries})`);
        const response = await client.models.generateContent({
          model: modelName,
          contents: contents,
          config: {
            systemInstruction,
            temperature: 0.85,
          },
        });
        
        return {
          response,
          modelUsed: modelName
        };
      } catch (err: any) {
        lastError = err;
        console.warn(`Error with model ${modelName} on attempt ${attempt}:`, err.message || err);
        
        const errMsg = (err.message || "").toLowerCase();
        const isTransient = errMsg.includes("503") || 
                            errMsg.includes("429") || 
                            errMsg.includes("unavailable") || 
                            errMsg.includes("demand") || 
                            errMsg.includes("limit") ||
                            errMsg.includes("temporary") ||
                            errMsg.includes("overloaded");

        if (!isTransient) {
          break;
        }

        if (attempt < maxRetries) {
          const delay = attempt * 1000;
          console.log(`Waiting ${delay}ms before retrying ${modelName}...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    console.warn(`Model ${modelName} failed. Falling back to next available model if any...`);
  }

  throw lastError || new Error("All attempts with Gemini models failed.");
}

app.post("/api/chat", async (req, res) => {
  try {
    const { messages, localTimeInfo } = req.body || {};
    if (!messages || !Array.isArray(messages)) {
      res.setHeader("Content-Type", "application/json");
      return res.status(400).json({ error: "Messages array is required." });
    }

    const client = getGeminiClient();

    // Map frontend messages into Gemini contents format supporting text & visual media
    const contents = messages.map((msg: any) => {
      const parts: any[] = [{ text: msg.content || "" }];
      
      if (msg.attachments && Array.isArray(msg.attachments)) {
        msg.attachments.forEach((att: any) => {
          if (att.type === "image" && att.data) {
            // Extract base64 format (e.g., "data:image/jpeg;base64,....")
            const matches = att.data.match(/^data:([^;]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
              const mimeType = matches[1];
              const base64Data = matches[2];
              parts.push({
                inlineData: {
                  mimeType,
                  data: base64Data
                }
              });
            } else if (!att.data.includes("base64,")) {
              // Fallback if raw base64 is passed
              parts.push({
                inlineData: {
                  mimeType: att.mimeType || "image/jpeg",
                  data: att.data
                }
              });
            }
          } else if (att.type === "file" && att.data) {
            // Read text-based attachments
            if (att.mimeType && (
              att.mimeType.startsWith("text/") || 
              att.mimeType === "application/json" || 
              att.mimeType === "application/javascript" || 
              att.mimeType === "application/typescript" ||
              att.name.endsWith(".txt") ||
              att.name.endsWith(".md") ||
              att.name.endsWith(".json") ||
              att.name.endsWith(".js") ||
              att.name.endsWith(".ts") ||
              att.name.endsWith(".csv")
            )) {
              let fileText = att.data;
              if (att.data.includes(";base64,")) {
                try {
                  const base64Part = att.data.split(";base64,")[1];
                  fileText = Buffer.from(base64Part, "base64").toString("utf-8");
                } catch (e) {
                  // Fallback
                }
              }
              parts.push({ text: `\n\n[Attached File: ${att.name}]\n\`\`\`\n${fileText}\n\`\`\`` });
            } else {
              parts.push({ text: `\n\n[Attached File placeholder: ${att.name} (type: ${att.mimeType || "unknown"})]` });
            }
          }
        });
      }
      
      return {
        role: msg.role === "user" ? "user" : "model",
        parts
      };
    });

    let systemInstruction = `Your name is JX AI. JX AI was developed by Pratham Jangra.
If anyone asks "Who created JX AI?" or "Who developed you?", always reply: "JX AI was developed by Pratham Jangra." (written in friendly Roman Hindi style: "Bhai, JX AI was developed by Pratham Jangra. 😎").
If anyone asks "What is your name?" or "Who are you?", always reply: "My name is JX AI." (written in friendly Roman Hindi style: "Mera naam JX AI h. 🤗").

CRITICAL PERSONALITY RULES (Highest Priority):
1. Never ever use Devanagari script (no Hindi letters/characters like 'क्या', 'नमस्ते').
2. Always reply in Roman Hindi (Hinglish).
3. Reply exactly like a real Indian WhatsApp chat. Keep replies short, natural, casual, and extremely friendly.
4. Examples of replies you should write:
   - "Kya haal h bhai?"
   - "Haan ho jayega."
   - "Nhi bhai, ye sahi tareeka h."
   - "Bata kya help chahiye."
   - "Aap kaise ho?"
   - "Bhai bata."
5. Examples of replies you must NEVER write (Avoid):
   - "क्या हाल है?" (Devanagari)
   - "आप कैसे हैं?" (Formal/Devanagari)
   - "Aap kaise hain?" (Too formal)
6. Always reply with emojis naturally, like "bhai kaise ho🤗", "Haan ho jayega 👍", "Nhi bhai, ye sahi tareeka h 💯", "Bata kya help chahiye 🤔".
7. Keep responses dynamic, natural, and friendly. Do not use robotic patterns, lists, or headers unless the user specifically asks for code, technical roadmap, or structured details. Even then, keep the conversational introduction and conclusion extremely short and natural like a WhatsApp text.
8. If asked to code or give technical help, provide clean code blocks but keep the surrounding text in short Hinglish WhatsApp style.
9. If you do not know something, be honest in Hinglish: "Mera dimaag nahi chal rha isme bhai, sach batau to pta nahi h 😅".`;

    if (localTimeInfo) {
      systemInstruction += `\n\nCURRENT TIME CONTEXT (LIVE FROM USER DEVICE):
- User's Current Local Time: ${localTimeInfo.time}
- User's Local Day: ${localTimeInfo.day}
- User's Local Date: ${localTimeInfo.date} ${localTimeInfo.month}, ${localTimeInfo.year}
- User's Local Timezone: ${localTimeInfo.timezone}
- User's Full Current Date: ${localTimeInfo.fullDate}

IMPORTANT DATE/TIME REPLY DIRECTIVES:
1. Greet the user naturally based on this current local time:
   - 5:00 AM to 11:59 AM: Good Morning (Hinglish: "Good Morning bhai!", "Gud mrng bhai! Kaise ho?", etc.)
   - 12:00 PM to 4:59 PM: Good Afternoon (Hinglish: "Good Afternoon bhai!", "Gud afternoon! Aaj ka din kaisa ja rha h?", etc.)
   - 5:00 PM to 8:59 PM: Good Evening (Hinglish: "Good Evening bhai!", "Gud evening! Kya chal rha h?", etc.)
   - 9:00 PM to 4:59 AM: Good Night / Late night (Hinglish: "Good Night bhai!", "Gud night!" or late-night greeting like "Hii bhai! Itni raat ko kaise yaad kiya?" depending on time)
2. Use this current time naturally in replies whenever relevant. If they ask about the date, day, or time, answer strictly using this device-live local time (e.g. "Bhai, abhi ${localTimeInfo.time} ho rahe hain." or "Aaj ${localTimeInfo.day} h, ${localTimeInfo.month} ${localTimeInfo.date}, ${localTimeInfo.year}."). Do NOT mention any placeholder or hardcoded default date/time.
3. Keep all responses strictly in Hinglish (Roman Hindi) and follow JX AI guidelines (friendly, casual, emojis).
4. If live time is unavailable, state that it cannot be determined instead of guessing.`;
    } else {
      systemInstruction += `\n\nIMPORTANT DATE/TIME REPLY DIRECTIVES:
1. Live device/local time is currently unavailable (could not be determined).
2. If the user asks for the current local time, date, or day, do NOT guess. Honestly tell them in Hinglish that you cannot determine their live local time/date right now because device info is missing, and politely ask them to check their system clock.`;
    }

    const { response, modelUsed } = await callGeminiWithRetryAndFallback(client, contents, systemInstruction);

    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({
      text: response.text || "",
      modelUsed
    });
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    res.setHeader("Content-Type", "application/json");
    return res.status(500).json({ 
      error: error.message || "Ram Ram Bhai! Platform pe kuch takleef aayi hai. Kripya dubaara koshish karein." 
    });
  }
});

// API endpoint for Image Generation (Unlocked for Developer, disabled for others)
app.post("/api/generate-image", async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  try {
    const userEmail = req.headers["x-user-email"] || req.body?.email;

    if (userEmail === "prathamjangra37@gmail.com") {
      const { prompt, aspectRatio } = req.body || {};
      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required." });
      }

      const client = getGeminiClient();
      console.log(`[Developer Bypass] Generating image prompt: "${prompt}" with aspect ratio: ${aspectRatio}`);

      const response = await client.models.generateContent({
        model: 'gemini-3.1-flash-lite-image',
        contents: {
          parts: [
            { text: prompt },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: aspectRatio || "1:1"
          }
        }
      });

      let base64Image = "";
      const candidate = response.candidates?.[0];
      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if (part.inlineData && part.inlineData.data) {
            // Some versions return raw base64 or with prefix
            const dataStr = part.inlineData.data;
            base64Image = dataStr.startsWith("data:") ? dataStr : `data:image/png;base64,${dataStr}`;
            break;
          }
        }
      }

      if (!base64Image) {
        throw new Error("No image data returned from Gemini Imagen model. Please try a different prompt or verify your key.");
      }

      // Register media to local memory cache so client can access it via real URL
      const id = Math.random().toString(36).substring(2, 15);
      mediaCache.set(id, {
        data: base64Image,
        name: `ai-generated-${Date.now()}.png`,
        mimeType: "image/png"
      });

      return res.status(200).json({ imageUrl: `/api/media/${id}` });
    }

    return res.status(403).json({
      error: "Image generation requires a supported paid Gemini API key. For the free version, please stick to text-based and image analysis requests which are fully active."
    });
  } catch (err: any) {
    console.error("Developer Image Generation Error:", err);
    return res.status(500).json({ 
      error: `[Developer Bypass Error] ${err.message || "Failed to generate image via Gemini API."}` 
    });
  }
});

// Secure endpoint for Developer Console Playground to test models and instructions
app.post("/api/developer/chat", async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  try {
    const userEmail = req.headers["x-user-email"] || req.body?.email;

    if (userEmail !== "prathamjangra37@gmail.com") {
      return res.status(403).json({ error: "Access Denied. Secure Developer authorization required." });
    }

    const { prompt, systemInstruction, model, temperature } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required." });
    }

    const client = getGeminiClient();
    const selectedModel = model || "gemini-3.5-flash";

    console.log(`[Developer Playground] Model: ${selectedModel}, Temp: ${temperature || 0.7}`);

    const response = await client.models.generateContent({
      model: selectedModel,
      contents: prompt,
      config: {
        systemInstruction: systemInstruction || "You are a professional development assistant.",
        temperature: temperature !== undefined ? parseFloat(temperature) : 0.7,
      }
    });

    return res.status(200).json({
      text: response.text || "",
      modelUsed: selectedModel,
      timestamp: new Date()
    });
  } catch (err: any) {
    console.error("Developer Chat Error:", err);
    return res.status(500).json({ error: err.message || "Playground generation failed." });
  }
});

// Lightweight health check ping endpoint for developer diagnostics
app.get("/api/developer/ping", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json({
    status: "online",
    timestamp: new Date(),
    environment: process.env.NODE_ENV || "development",
    uptime: process.uptime()
  });
});

// WhatsApp Chatbot Connection Status Check for Developer
app.get("/api/developer/whatsapp/status", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  try {
    const userEmail = req.headers["x-user-email"] || req.query?.email;

    if (userEmail !== "prathamjangra37@gmail.com") {
      return res.status(403).json({ error: "Access Denied. Secure Developer authorization required." });
    }

    const tokenSet = !!process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneIdSet = !!process.env.WHATSAPP_PHONE_NUMBER_ID;
    const verifyTokenSet = !!process.env.WHATSAPP_VERIFY_TOKEN;

    let overallStatus = "disconnected";
    if (tokenSet && phoneIdSet) {
      overallStatus = "connected";
    } else if (tokenSet || phoneIdSet) {
      overallStatus = "partial";
    }

    return res.status(200).json({
      status: overallStatus,
      config: {
        accessTokenSet: tokenSet,
        phoneIdSet: phoneIdSet,
        verifyTokenSet: verifyTokenSet,
        verifyTokenValue: process.env.WHATSAPP_VERIFY_TOKEN || "jx_ai_whatsapp_token_2026"
      },
      timestamp: new Date()
    });
  } catch (err: any) {
    console.error("WhatsApp Status Check Error:", err);
    return res.status(500).json({ error: err.message || "Failed to check WhatsApp status." });
  }
});

// WhatsApp Chatbot Send Test Message for Developer
app.post("/api/developer/whatsapp/test-message", async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  try {
    const userEmail = req.headers["x-user-email"] || req.body?.email;

    if (userEmail !== "prathamjangra37@gmail.com") {
      return res.status(403).json({ error: "Access Denied. Secure Developer authorization required." });
    }

    const { toPhone, message } = req.body || {};
    if (!toPhone) {
      return res.status(400).json({ error: "Recipient phone number is required." });
    }

    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

    if (!phoneId || !accessToken) {
      return res.status(400).json({ 
        error: "WhatsApp Cloud API is not configured on the server. Please check your system secrets." 
      });
    }

    const textToSend = message || "Ram Ram! This is a secure test message from your JX AI Developer Control Room. 🚀";
    console.log(`[Developer Test Message] Triggered test message to ${toPhone}`);
    const result = await sendWhatsAppTextMessage(phoneId, toPhone, textToSend, accessToken);
    return res.status(200).json({ success: true, result });
  } catch (err: any) {
    console.error("Developer Test Message Error:", err);
    return res.status(500).json({ error: err.message || "Failed to deliver WhatsApp test message." });
  }
});

// Store temporary media in a memory map so we can reference them with a stable real URL
const mediaCache = new Map<string, { data: string; name: string; mimeType: string }>();

// API endpoint to register media base64 data and get a real HTTP link
app.post("/api/register-media", (req, res) => {
  try {
    const { data, name, mimeType } = req.body || {};
    if (!data) {
      res.setHeader("Content-Type", "application/json");
      return res.status(400).json({ error: "Data is required." });
    }
    const id = Math.random().toString(36).substring(2, 15);
    mediaCache.set(id, { 
      data, 
      name: name || `file-${id}.png`, 
      mimeType: mimeType || "image/png" 
    });
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({ url: `/api/media/${id}` });
  } catch (error: any) {
    console.error("Register Media Error:", error);
    res.setHeader("Content-Type", "application/json");
    return res.status(500).json({ error: error.message || "Failed to register media" });
  }
});

// GET endpoint to serve the registered media natively in browser with correct headers
app.get("/api/media/:id", (req, res) => {
  const media = mediaCache.get(req.params.id);
  if (!media) {
    res.setHeader("Content-Type", "application/json");
    return res.status(404).json({
      error: "File Expired or Not Found. The requested media may have expired because the server restarted, or the URL link is invalid. Please generate a new image/file in your chat session!"
    });
  }

  try {
    if (media.data.startsWith("data:")) {
      const parts = media.data.split(",");
      const mime = parts[0].match(/:(.*?);/)?.[1] || media.mimeType;
      const base64Data = parts[1];
      const buffer = Buffer.from(base64Data, "base64");
      
      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Disposition", `inline; filename="${media.name}"`);
      return res.send(buffer);
    } else {
      // If it's already an HTTP url, redirect to it safely
      return res.redirect(media.data);
    }
  } catch (error: any) {
    console.error("Serve Media Error:", error);
    res.setHeader("Content-Type", "application/json");
    return res.status(500).json({ error: error.message || "Error serving media file" });
  }
});

// ==========================================
// Meta WhatsApp Cloud API Chatbot Backend
// ==========================================

// Webhook Verification (GET)
// Meta uses this endpoint to verify that your webhook URL belongs to you and is alive.
app.get("/api/whatsapp/webhook", (req, res) => {
  try {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "jx_ai_whatsapp_token_2026";
    const mode = req.query?.["hub.mode"];
    const token = req.query?.["hub.verify_token"];
    const challenge = req.query?.["hub.challenge"];

    console.log(`[WhatsApp Verification] Received request: mode=${mode}, token=${token}`);

    if (mode && token) {
      if (mode === "subscribe" && token === verifyToken) {
        console.log("✦ [WhatsApp Webhook] Webhook successfully verified and subscribed!");
        return res.status(200).send(challenge);
      } else {
        console.warn("⚠ [WhatsApp Webhook] Verification failed. Token mismatch.");
        return res.sendStatus(403);
      }
    }
    return res.status(400).send("Missing hub.mode or hub.verify_token");
  } catch (err: any) {
    console.error("WhatsApp Webhook Verification Error:", err);
    return res.status(500).send("Internal server error during verification");
  }
});

// Webhook Message Event Handler (POST)
// Receives WhatsApp messages, processes with Gemini AI, stores to Firestore, and responds.
app.post("/api/whatsapp/webhook", async (req, res) => {
  try {
    const body = req.body;

    // Check if this is indeed a whatsapp status/message event
    if (body.object !== "whatsapp_business_account") {
      return res.status(404).json({ error: "Not a WhatsApp business event" });
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    // Meta sends multiple webhooks, including read/delivery receipts.
    // If there are no actual messages in the payload, acknowledge receipt and return.
    if (!value || !value.messages || !Array.isArray(value.messages)) {
      return res.status(200).json({ status: "acknowledged" });
    }

    const message = value.messages[0];
    const contact = value.contacts?.[0];

    const fromPhone = message.from; // Sender phone (e.g., "919876543210")
    const senderName = contact?.profile?.name || "WhatsApp User";
    const messageId = message.id;
    const phoneId = value.metadata?.phone_number_id; // Your WhatsApp Phone ID

    // We only process text-based messages or basic attachments
    let messageText = "";
    if (message.type === "text") {
      messageText = message.text?.body || "";
    } else {
      messageText = `[Received non-text message of type: ${message.type}]`;
    }

    if (!messageText.trim()) {
      return res.status(200).json({ status: "empty_text" });
    }

    console.log(`\n✦ [WhatsApp Chat] Incoming message from ${fromPhone} (${senderName}): "${messageText}"`);

    // Verify WhatsApp Access Token configuration
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!accessToken) {
      console.error("⚠ [WhatsApp Config Error] WHATSAPP_ACCESS_TOKEN is missing in Environment Variables!");
      // Still return 200 OK to Meta so they stop retrying the same payload
      return res.status(200).json({ error: "WHATSAPP_ACCESS_TOKEN is missing in environment." });
    }

    // 1. Authenticate/Retrieve secure Firebase Auth profile by phone number
    const firebaseUser = await getOrCreateFirebaseUserByPhone(fromPhone, senderName);
    const uid = firebaseUser.uid;

    // 2. Register/Sync user details in global users_directory
    await syncUserInDirectory(uid, fromPhone, senderName);

    // 3. Load user's persistent chatbot session history from Firestore
    const { messages: chatHistory, title, createdAt } = await loadWhatsAppConversation(uid);

    // 4. Append user's new message to conversation log
    chatHistory.push({
      id: messageId,
      role: "user",
      content: messageText,
      timestamp: new Date()
    });

    // 5. Query the multimodal Gemini model using standard client
    const client = getGeminiClient();

    // Bound context messages to prevent massive latency or exceeding limits
    const maxHistoryContext = 12;
    const boundedHistory = chatHistory.slice(-maxHistoryContext);
    const contents = boundedHistory.map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }]
    }));

    // System instruction tuned specifically for the WhatsApp user interface medium
    const whatsappSystemInstruction = `Your name is JX AI. You are talking as JX AI on WhatsApp, created by Pratham Jangra.
If anyone asks "Who created JX AI?" or "Who developed you?", always reply: "JX AI was developed by Pratham Jangra." (written in friendly Roman Hindi style: "Bhai, JX AI was developed by Pratham Jangra. 😎").
If anyone asks "What is your name?" or "Who are you?", always reply: "My name is JX AI." (written in friendly Roman Hindi style: "Mera naam JX AI h. 🤗").

CRITICAL PERSONALITY & WHATSAPP FORMATTING RULES (Highest Priority):
1. Never ever use Devanagari script (no Hindi letters/characters like 'क्या', 'नमस्ते').
2. Always reply in Roman Hindi (Hinglish).
3. Reply exactly like a real Indian WhatsApp chat. Keep replies short, natural, casual, and extremely friendly.
4. Examples of replies you should write:
   - "Kya haal h bhai?"
   - "Haan ho jayega."
   - "Nhi bhai, ye sahi tareeka h."
   - "Bata kya help chahiye."
   - "Aap kaise ho?"
   - "Bhai bata."
5. Examples of replies you must NEVER write (Avoid):
   - "क्या हाल है?" (Devanagari)
   - "आप कैसे हैं?" (Formal/Devanagari)
   - "Aap kaise hain?" (Too formal)
6. Always reply with emojis naturally, like "bhai kaise ho🤗", "Haan ho jayega 👍", "Nhi bhai, ye sahi tareeka h 💯", "Bata kya help chahiye 🤔".
7. Keep responses dynamic, natural, and friendly. Do not use robotic patterns, lists, or headers unless the user specifically asks for code, technical roadmap, or structured details. Even then, keep the conversational introduction and conclusion extremely short and natural like a WhatsApp text.
8. WhatsApp format rules: Use *bold* for bold text, _italics_ for italicized text, ~strikethrough~ for strike, and \`code\` for inline code blocks. Do not use Markdown Headings or checklists.
9. If you do not know something, be honest in Hinglish: "Mera dimaag nahi chal rha isme bhai, sach batau to pta nahi h 😅".`;

    const { response, modelUsed } = await callGeminiWithRetryAndFallback(client, contents, whatsappSystemInstruction);
    const aiResponseText = response.text || "Ram Ram Bhai! Kuch samasya aayi hai, kripya dubaara koshish karein.";

    console.log(`[WhatsApp AI] Generation completed using model: ${modelUsed}`);

    // Format text specifically for pristine WhatsApp screen readability
    const formattedReply = formatTextForWhatsApp(aiResponseText);

    // 6. Append AI response to history
    const aiMsgId = `ai_msg_${Math.random().toString(36).substring(2, 11)}`;
    chatHistory.push({
      id: aiMsgId,
      role: "model",
      content: aiResponseText,
      timestamp: new Date()
    });

    // 7. Save conversation back to Firestore securely
    await saveWhatsAppConversation(uid, chatHistory, title, createdAt);

    // 8. Deliver response to user via official Meta API
    await sendWhatsAppTextMessage(phoneId, fromPhone, formattedReply, accessToken);

    return res.status(200).json({ status: "success", uid, model: modelUsed });
  } catch (err: any) {
    console.error("⚠ [WhatsApp Webhook Error]:", err);
    // Always return 200 OK to Meta so they stop flooding the webhook with retries
    return res.status(200).json({ status: "error", message: err.message || err });
  }
});

// Catch-all handler for unhandled /api/* routes to guarantee they return JSON and never HTML
app.all("/api/*", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  return res.status(404).json({ 
    error: `API route not found: ${req.method} ${req.originalUrl}` 
  });
});

// Global Error Handler to guarantee every server error is returned as JSON and never HTML
app.use((err: any, req: any, res: any, next: any) => {
  console.error("Global Server Error:", err);
  const status = err.status || err.statusCode || 500;
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json({
    error: err.message || "An unexpected error occurred on the server."
  });
});

export default app;
