const SYSTEM_PROMPT = `You are a knowledgeable, careful L'Oreal beauty advisor. Help with skincare, haircare, makeup, fragrance, beauty products, and general beauty routines. Keep the full conversation context in mind.

For routine recommendations, use only product information supplied in the conversation. Never invent ingredients, benefits, or product claims. Explain when the available information is insufficient. Organize steps in a sensible order, identify morning and evening use when appropriate, explain how selected products work together, and flag relevant precautions or potential conflicts only when supported by the supplied information or established general safety guidance. Do not diagnose or replace a medical professional.

Politely redirect unrelated questions to beauty topics. Be concise, practical, and clear. Use short plain-text headings and numbered steps so the routine is easy to scan. The supplied catalog details are local product information, not live web research.`;

function getAllowedOrigin(request, env) {
  const requestOrigin = request.headers.get("Origin");
  const allowedOrigins = (env.ALLOWED_ORIGIN || "http://localhost:5500,http://127.0.0.1:5500")
    .split(",")
    .map((origin) => origin.trim());

  if (!requestOrigin) return "";
  if (allowedOrigins.includes("*")) return "*";
  return allowedOrigins.includes(requestOrigin) ? requestOrigin : null;
}

function jsonResponse(body, status, origin) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request, env) {
    const origin = getAllowedOrigin(request, env);
    if (origin === null) return jsonResponse({ error: "This website is not allowed to use the advisor." }, 403, "");

    if (request.method === "OPTIONS") {
      if (!origin) return new Response(null, { status: 204 });
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin",
        },
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Use POST to send a conversation." }, 405, origin);
    }
    if (!env.OPENAI_API_KEY) {
      return jsonResponse({ error: "The advisor is not configured yet. Add the API key as a Worker secret." }, 500, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch (error) {
      return jsonResponse({ error: "The request body must be valid JSON." }, 400, origin);
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 40) {
      return jsonResponse({ error: "Send between 1 and 40 conversation messages." }, 400, origin);
    }

    const messages = [];
    for (const message of body.messages) {
      if (!message || !["user", "assistant"].includes(message.role) || typeof message.content !== "string") {
        return jsonResponse({ error: "Each message must have a user or assistant role and text content." }, 400, origin);
      }
      if (message.content.length > 16000) {
        return jsonResponse({ error: "A message is too long. Please shorten it and try again." }, 400, origin);
      }
      messages.push({ role: message.role, content: message.content });
    }

    try {
      const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: env.OPENAI_MODEL || "gpt-4.1",
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        }),
      });

      if (aiResponse.status === 429) {
        return jsonResponse({ error: "The advisor is busy right now. Please wait a moment and try again." }, 429, origin);
      }
      if (!aiResponse.ok) {
        return jsonResponse({ error: "The advisor could not complete that request. Please try again shortly." }, 502, origin);
      }

      const result = await aiResponse.json();
      const reply = result.choices?.[0]?.message?.content;
      if (typeof reply !== "string" || !reply.trim()) {
        return jsonResponse({ error: "The advisor returned an empty response. Please try again." }, 502, origin);
      }
      return jsonResponse({ choices: [{ message: { role: "assistant", content: reply } }] }, 200, origin);
    } catch (error) {
      return jsonResponse({ error: "The advisor is temporarily unavailable. Check your connection and try again." }, 502, origin);
    }
  },
};