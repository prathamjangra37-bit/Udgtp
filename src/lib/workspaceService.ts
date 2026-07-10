// Workspace Service for JX AI
// Houses client-side interactions with Gmail and Google Calendar APIs

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;
    date?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
  };
  htmlLink?: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  body?: string;
}

/**
 * Base helper to make authorized fetch requests
 */
async function fetchAuthorized(url: string, token: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    let errMsg = `Request failed: ${response.status} ${response.statusText}`;
    try {
      const errJson = await response.json();
      if (errJson?.error?.message) {
        errMsg = errJson.error.message;
      }
    } catch (_) {}
    throw new Error(errMsg);
  }

  // Some operations (like DELETE calendar event or Trash message) return 204 No Content
  if (response.status === 204) {
    return null;
  }

  return response.json();
}

/**
 * --- GOOGLE CALENDAR API FUNCTIONS ---
 */

// List upcoming events
export async function listCalendarEvents(token: string, maxResults = 20): Promise<CalendarEvent[]> {
  const now = new Date().toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=${maxResults}&orderBy=startTime&singleEvents=true&timeMin=${now}`;
  const data = await fetchAuthorized(url, token);
  return data.items || [];
}

// Create a new calendar event
export async function createCalendarEvent(
  token: string,
  event: Omit<CalendarEvent, "id">
): Promise<CalendarEvent> {
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events`;
  return await fetchAuthorized(url, token, {
    method: "POST",
    body: JSON.stringify(event),
  });
}

// Delete a calendar event
export async function deleteCalendarEvent(token: string, eventId: string): Promise<void> {
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`;
  await fetchAuthorized(url, token, {
    method: "DELETE",
  });
}

/**
 * --- GMAIL API FUNCTIONS ---
 */

// Helper to decode Base64Url (Gmail body format) safely
function decodeBase64Url(base64Url: string): string {
  try {
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    // Standard base64 decoding with UTF-8 support
    const raw = atob(base64);
    const uInt8Array = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      uInt8Array[i] = raw.charCodeAt(i);
    }
    const decoder = new TextDecoder("utf-8");
    return decoder.decode(uInt8Array);
  } catch (error) {
    console.error("Base64Url decode error:", error);
    return "";
  }
}

// Parse single message details (extracting headers)
function parseGmailMessage(messageDetail: any): GmailMessage {
  const headers = messageDetail.payload?.headers || [];
  const getHeader = (name: string) => {
    const header = headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
    return header ? header.value : "";
  };

  const subject = getHeader("subject") || "(No Subject)";
  const from = getHeader("from") || "(Unknown Sender)";
  const to = getHeader("to") || "";
  const date = getHeader("date") || "";

  // Extract body
  let body = "";
  const parts = messageDetail.payload?.parts;
  
  const extractBodyFromParts = (partsList: any[]): string => {
    for (const part of partsList) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      } else if (part.mimeType === "text/html" && part.body?.data) {
        // Fallback to HTML if plain text isn't found first
        return decodeBase64Url(part.body.data);
      } else if (part.parts) {
        const nestedBody = extractBodyFromParts(part.parts);
        if (nestedBody) return nestedBody;
      }
    }
    return "";
  };

  if (messageDetail.payload?.body?.data) {
    body = decodeBase64Url(messageDetail.payload.body.data);
  } else if (parts && parts.length > 0) {
    body = extractBodyFromParts(parts);
  }

  // If we couldn't get a body, fallback to snippet
  if (!body.trim()) {
    body = messageDetail.snippet || "";
  }

  return {
    id: messageDetail.id,
    threadId: messageDetail.threadId,
    subject,
    from,
    to,
    date,
    snippet: messageDetail.snippet || "",
    body,
  };
}

// List messages
export async function listGmailMessages(
  token: string,
  maxResults = 15,
  query = ""
): Promise<GmailMessage[]> {
  let url = `https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}`;
  if (query) {
    url += `&q=${encodeURIComponent(query)}`;
  }
  
  const listData = await fetchAuthorized(url, token);
  if (!listData.messages || listData.messages.length === 0) {
    return [];
  }

  // Fetch full details of messages in parallel
  const detailPromises = listData.messages.map((msg: any) =>
    fetchAuthorized(`https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}`, token)
  );

  const rawDetails = await Promise.all(detailPromises);
  return rawDetails.map(parseGmailMessage);
}

// Fetch single message
export async function fetchGmailMessage(token: string, messageId: string): Promise<GmailMessage> {
  const url = `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}`;
  const rawDetail = await fetchAuthorized(url, token);
  return parseGmailMessage(rawDetail);
}

// Send email
export async function sendGmailEmail(
  token: string,
  to: string,
  subject: string,
  body: string
): Promise<any> {
  const url = `https://www.googleapis.com/gmail/v1/users/me/messages/send`;

  // Construct RFC 2822 format email
  const emailLines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    "",
    body,
  ];

  const rawEmail = emailLines.join("\r\n");
  
  // Safe base64url encoding
  const encodedEmail = btoa(unescape(encodeURIComponent(rawEmail)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return await fetchAuthorized(url, token, {
    method: "POST",
    body: JSON.stringify({
      raw: encodedEmail,
    }),
  });
}

// Move email to trash (delete)
export async function deleteGmailMessage(token: string, messageId: string): Promise<any> {
  const url = `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}/trash`;
  return await fetchAuthorized(url, token, {
    method: "POST",
  });
}
