 /**
  * SafariGuard Sovereign Cortex — Production AI Proxy
  * Cloudflare Worker (Gemini AI Gateway)
  * Secure, scalable, Vercel-compatible
  */

const ALLOWED_ORIGINS = [
  "https://safariguard.vercel.app",
  "https://robert-owuor74.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];

// ----------------------------
// UTIL: CORS HANDLER
// ----------------------------
function getCorsHeaders(origin) {
  const isAllowed = ALLOWED_ORIGINS.includes(origin);

  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

// ----------------------------
// UTIL: RATE LIMIT (in-memory)
// ----------------------------
const rateMap = new Map();

function rateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;

  const record = rateMap.get(ip);

  if (!record || now - record.start > windowMs) {
    rateMap.set(ip, { count: 1, start: now });
    return true;
  }

  if (record.count >= 25) return false;

  record.count++;
  return true;
}

// ----------------------------
// MAIN WORKER
// ----------------------------
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";

    const cors = getCorsHeaders(origin);

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    // Only /chat endpoint
    if (url.pathname !== "/chat") {
      return jsonResponse({ error: "Not Found" }, 404, cors);
    }

    // Only POST
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method Not Allowed" }, 405, cors);
    }

    // Origin check (non-breaking fallback)
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return jsonResponse(
        { error: "Origin not allowed", origin },
        403,
        cors
      );
    }

    // Rate limit
    if (!rateLimit(ip)) {
      return jsonResponse(
        { error: "Rate limit exceeded" },
        429,
        cors
      );
    }

    // Parse body
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400, cors);
    }

    if (!body.messages || !Array.isArray(body.messages)) {
      return jsonResponse(
        { error: "messages[] required" },
        400,
        cors
      );
    }

    const systemPrompt = body.system || `
You are SafariGuard Cortex AI.
You act as a real-time safety and route intelligence system.
You analyze locations, risks, and provide safe routing advice.
Keep responses short, actionable, and safety-focused.
`;

    // Convert to Gemini format
    const contents = body.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const geminiPayload = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents,
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 800,
      },
    };

    // Check API key
    if (!env.GOOGLE_API_KEY) {
      return jsonResponse(
        { error: "Missing GOOGLE_API_KEY in environment" },
        500,
        cors
      );
    }

    // Call Gemini
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GOOGLE_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(geminiPayload),
        }
      );

      const data = await response.json();

      const text =
        data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        "Cortex temporarily unavailable. Try again.";

      return jsonResponse(
        {
          success: true,
          reply: text,
        },
        200,
        cors
      );
    } catch (err) {
      return jsonResponse(
        {
          error: "Cortex AI failure",
          detail: err.message,
        },
        502,
        cors
      );
    }
  },
};

// ----------------------------
// HELPER: JSON RESPONSE
// ----------------------------
function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}
