/**
 * SafariGuard Sovereign Cortex — AI Proxy Worker
 * Cloudflare Worker · Powered by Google Gemini (Free)
 * Keeps your API key hidden server-side. CORS locked to your domain.
 */

// ── ALLOWED ORIGINS ──
const ALLOWED_ORIGINS = [
  "https://robert-owuor74.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];

// ── RATE LIMITING (20 requests per IP per minute) ──
const rateLimitMap = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.start > windowMs) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return true;
  }
  if (entry.count >= 20) return false;
  entry.count++;
  return true;
}

// ── CORS HEADERS ──
function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

// ── MAIN HANDLER ──
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    // Only allow POST to /chat
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/chat") {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    // Block disallowed origins
    if (!ALLOWED_ORIGINS.includes(origin) && !origin.includes("localhost")) {
      return new Response(JSON.stringify({ error: "Origin not allowed" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    // Rate limiting
    if (!checkRateLimit(ip)) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait a moment." }), {
        status: 429,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    if (!body.messages || !Array.isArray(body.messages)) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    // Convert messages to Gemini format
    // Gemini uses "contents" with "parts" instead of "messages"
    const systemPrompt = body.system || "";

    const contents = body.messages.map(msg => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }]
    }));

    // Build Gemini request
    const geminiBody = {
      system_instruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: contents,
      generationConfig: {
        maxOutputTokens: 1000,
        temperature: 0.7,
      }
    };

    // Call Google Gemini API (free tier)
    try {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GOOGLE_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(geminiBody),
        }
      );

      const data = await geminiRes.json();

      // Extract reply text from Gemini response
      const replyText =
        data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        "Cortex signal weak. Please retry.";

      // Return in a simple format the frontend can use
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: replyText }]
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        }
      );

    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Cortex upstream error", detail: err.message }),
        {
          status: 502,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        }
      );
    }
  },
};
