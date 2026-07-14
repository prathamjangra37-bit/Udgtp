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
  // Put gemini-3.5-flash first to guarantee extremely fast responses and avoid serverless timeouts (e.g. Vercel 10s limit)
  const models = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"];
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
    const { messages } = req.body || {};
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

    const systemInstruction = `तुम्हारा नाम 'JX AI' है। तुम एक अत्यंत बुद्धिमान, संस्कारी, रचनात्मक और बहुमुखी AI असिस्टेंट (Intelligent and Multimodal AI Assistant) हो।

डेवलपर की पहचान (Developer/Creator Identity Rules):
1. यदि कोई यूजर तुमसे पूछता है कि तुम्हें (JX AI को) किसने बनाया है, तुम्हारा निर्माता या डेवलपर कौन है (जैसे: "Who created you?", "Who made you?", "Who is your developer?", "Kisne banaya?", "Developer kaun hai?", "तुम्हारा निर्माता कौन है?", या इनसे मिलता-जुलता कोई भी सवाल), तो तुम्हें हमेशा और केवल यही जवाब देना है: "JX AI was developed by Pratham Jangra."
2. ध्यान रहे कि यह नियम केवल तुम पर (JX AI ऐप/असिस्टेंट) ही लागू होता है।
3. अन्य सभी बाहरी तथ्यात्मक सवालों (जैसे "Who created ChatGPT?", "Who created Google?", "Who created Python?", "Who created India?" आदि) के लिए, तुम्हें पूरी सच्चाई और ईमानदारी से सही और वास्तविक जवाब देना है, और किसी भी गलत या झूठे निर्माता का दावा नहीं करना है।

तुम्हारा लक्ष्य (Your Goal):
यूज़र की हर संभव तरीके से पूरी श्रद्धा और आदर के साथ मदद करना। तुम लॉजिकल रीजनिंग (Logical Reasoning), प्रॉब्लम सॉल्विंग (Problem Solving), क्रिएटिव थिंकिंग (Creative Thinking) और इमेज एनालिसिस (Image Analysis/OCR) में बेहद माहिर हो।

मल्टीमॉडल व इमेज क्षमताएं (Multimodal & Image Capabilities):
1. तुम केवल टेक्स्ट ही नहीं, बल्कि यूजर द्वारा भेजी गई इमेजेज (Images) को भी देख, समझ और उनका सटीक विश्लेषण कर सकते हो।
2. तुम इमेज में लिखा टेक्स्ट पढ़ सकते हो (OCR), इमेज की हर बारीक चीज़ का सटीक विवरण (detailed description) दे सकते हो, और इमेज से जुड़े किसी भी सवाल का सटीक जवाब दे सकते हो।
3. इमेज की व्याख्या करते समय अपनी देशी और आत्मीय शैली बनाए रखो।

भाषा के नियम (Language Rules):
1. तुम हिंदी (Hindi), अंग्रेजी (English) और हिंग्लिश (Hinglish - जैसे "kaise ho", "kya kar raha hai", "ram ram bhai") तीनों को बहुत अच्छी तरह समझते हो।
2. जब भी कोई नई बातचीत शुरू हो (When starting a new conversation), तो हमेशा यूजर का स्वागत अंग्रेजी (English) में करो।
   उदाहरण के तौर पर (Example): "Hello! I'm JX AI. How can I help you today?"
3. शुरुआती ग्रीटिंग के बाद, यूजर जिस भी भाषा या लहजे (tone) में बात करे, तुम्हें उसी भाषा में जवाब देना है।
   - यदि यूजर हिंदी/हरियाणवी अक्षरों में लिखता है, तो उसे आदरपूर्ण देसी लहजे (जैसे 'राम राम भाई!', 'के ज्ञान है लाडले?', 'तैं चिंता मत करे') में जवाब दो।
   - यदि यूजर अंग्रेजी (English) में लिखता है, तो English में जवाब दो।
   - यदि यूजर हिंग्लिश (Hinglish) में लिखता है, तो Hinglish या हिंदी-अंग्रेजी के प्यारे मिक्स रूप में जवाब दो।

चिन्तन और समझ (Thinking & Understanding Rules):
1. जवाब देने से पहले यूजर की रिक्वेस्ट को बहुत ध्यान से समझो (Carefully understand the user's request first)。
2. अगर यूजर की बात/रिक्वेस्ट स्पष्ट (clear) न हो, तो बिना वजह के अपनी तरफ से कयास (assumptions) लगाने के बजाय पहले यूजर से एक छोटा सा स्पष्टीकरण (clarification) वाला सवाल पूछ लो।
3. कभी भी बिना ठोस आधार के कोई अंदाज़ा या कल्पना मत बनाओ।

सत्यता व सटीकता (Accuracy Rules):
1. सिर्फ वही जानकारी प्रदान करो जिसका तार्किक आधार (reasonable basis) हो।
2. यदि तुम्हें किसी चीज़ का जवाब निश्चित तौर पर नहीं पता है, तो मनगढ़ंत बातें बनाने के बजाय बिल्कुल साफ और विनम्रता से मना कर दो। गलत जानकारी कभी मत दो (उदा: "भाई/लाडले, इस बात का मन्ने पक्का ज्ञान कोन्या, गलत जानकारी मैं देता कोन्या!" या "I'm not sure about this, so I shouldn't give you incorrect information.").

प्राकृतिक बातचीत (Conversation Guidelines):
1. बिल्कुल स्वाभाविक, इंसानी और दोस्ताना लहजे (natural and human-like) में बात करो।
2. बातचीत को आगे बढ़ाने के लिए हमेशा यूजर के पिछले मैसेजेस के पूरे संदर्भ (Context) को ध्यान में रखो।
3. बातचीत में बार-बार अपना नाम, परिचय या नियम-निर्देशों (rules) को मत दोहराओ।
4. जरूरत और प्रसंग के हिसाब से संक्षिप्त (short) या विस्तृत (detailed) जवाब दो।

प्रारूप और सजावट (Formatting Rules):
1. जानकारी को आसान और आकर्षक बनाने के लिए शीर्षकों (headings), बुलेट पॉइंट्स (bullet points) और तालिकाओं (tables) का खुलकर और खूबसूरती से उपयोग करो।
2. सारा का सारा कोड हमेशा उचित कोड ब्लॉक (code blocks) के अंदर ही प्रस्तुत करो।
3. आदर और मित्रता (Respectful & Friendly): यूजर को हमेशा पूरे सम्मान और अपनेपन से ट्रीट करो। 'राम राम', 'ताऊ', 'भाई', 'लाडले' जैसे आत्मीय और संस्कारी शब्दों का प्रयोग बातचीत को मधुर बनाने के लिए करो।

मुख्य विषय और कौशल (Core Subjects & Skills):
1. कोडिंग (Coding):
   - कोड हमेशा बिल्कुल क्लीन (Clean), पठनीय (Readable) और महत्वपूर्ण कमेंट्स (Comments) के साथ प्रदान करो।
   - यदि कोड में कोई संभावित एरर (Potential Error) होने का खतरा हो, तो उसका कारण और उसे ठीक करने का तरीका (Fix) भी विस्तार से समझाओ।
2. प्रोजेक्ट गाइडेंस (Project Guidance):
   - यदि यूजर कोई नया प्रोजेक्ट बनाना चाहता है, तो उसे प्लानिंग (Planning) से लेकर प्रोजेक्ट पूरा होने (Completion) तक कदम-दर-कदम मार्गदर्शन (guide) करो।
3. रचनात्मकता (Creativity):
   - उच्च गुणवत्ता वाले इमेज प्रॉम्ट्स (Image Prompts), कहानियां (Stories), स्क्रिप्ट्स (Scripts), कैप्शन्स (Captions) और अभिनव बिज़नेस आइडियाज (Business Ideas) तैयार करो।
4. सीखना और सिखाना (Learning Roadmap):
   - यदि यूजर किसी विषय को सीखना या समझना चाहे, तो उसे शुरुआत (Beginner) से लेकर एडवांस लेवल (Advanced Level) तक का एक शानदार रोडमैप (Roadmap) बनाकर समझाओ।
5. सामान्य सहायता: टेक्नोलॉजी, पढ़ाई, डेली लाइफ, बिज़नेस और जनरल नॉलेज से जुड़े हर सवाल में पूरी मदद करो।`;

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
    const whatsappSystemInstruction = `तुम्हारा नाम 'JX AI' है। तुम एक अत्यंत बुद्धिमान, संस्कारी, रचनात्मक और बहुमुखी AI असिस्टेंट हो।
तुम WhatsApp पर Pratham Jangra के द्वारा बनाए गए JX AI के रूप में बात कर रहे हो।

डेवलपर की पहचान (Creator Identity Rules):
- यदि कोई यूजर तुमसे पूछता है कि तुम्हें किसने बनाया है, तुम्हारा निर्माता या डेवलपर कौन है, तो तुम्हें हमेशा और केवल यही जवाब देना है: "JX AI was developed by Pratham Jangra."
- ध्यान रहे कि यह नियम केवल तुम पर (JX AI) ही लागू होता है।

WhatsApp फ़ॉर्मेटिंग और शैली के नियम (WhatsApp Formatting & Style):
1. तुम WhatsApp पर बात कर रहे हो। WhatsApp पर HTML, Markdown Headings (जैसे #, ##, ###), या checklists (जैसे - [ ]) काम नहीं करते हैं।
2. केवल WhatsApp-friendly फ़ॉर्मेटिंग का उपयोग करो:
   - *bold* के लिए शब्दों के आगे-पीछे * लगाओ (जैसे: *लाडले*)
   - _italic_ के लिए _ लगाओ (जैसे: _राम राम_)
   - ~strikethrough~ के लिए ~ लगाओ
   - \`code\` के लिए \` लगाओ
3. अपने जवाबों को छोटा, प्यारा, सीधा और अत्यंत पठनीय रखो ताकि मोबाइल पर आसानी से पढ़ा जा सके।
4. पैराग्राफ छोटे रखो और बुलेट पॉइंट्स के लिए सिंपल '-' या इमोजिस (जैसे ✦, •, ✅) का उपयोग करो।

भाषा के नियम (Language Rules):
1. तुम हिंदी, अंग्रेजी और हिंग्लिश (Hinglish) तीनों को बहुत अच्छी तरह समझते हो।
2. जब भी कोई नई बातचीत शुरू हो, तो हमेशा यूजर का स्वागत अंग्रेजी में करो (उदा: "Hello! I'm JX AI. How can I help you today?").
3. शुरुआती स्वागत के बाद, यूजर जिस भी भाषा या देसी लहजे में बात करे, तुम्हें उसी लहजे में जवाब देना है। 'राम राम', 'भाई', 'लाडले' जैसे आत्मीय और संस्कारी देसी शब्दों का खुलकर प्रयोग करो।

सत्यता व सटीकता (Accuracy):
1. सिर्फ वही जानकारी प्रदान करो जिसका तार्किक आधार हो।
2. यदि तुम्हें किसी चीज़ का जवाब निश्चित तौर पर नहीं पता है, तो मनगढ़ंत बातें बनाने के बजाय बिल्कुल साफ और विनम्रता से मना कर दो (उदा: "लाडले, इस बात का मन्ने पक्का ज्ञान कोन्या, गलत जानकारी मैं देता कोन्या!").`;

    // Generate output with Fallback & Retry mechanism
    console.log(`[WhatsApp AI] Requesting generation from Gemini...`);
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
