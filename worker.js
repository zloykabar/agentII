/**
 * Cloudflare Worker — прокси для ИИ-агента.
 * Пересылает запросы в OpenAI (или любой OpenAI-совместимый API)
 * и добавляет CORS-заголовки, чтобы браузер не блокировал ответ.
 *
 * Настройка через переменные окружения Worker'а (Settings → Variables):
 *   TARGET_URL     — куда пересылать (по умолчанию https://api.openai.com)
 *   PROXY_SECRET   — секрет, который должен присылать клиент в заголовке X-Proxy-Secret
 */

export default {
  async fetch(request, env) {
    const TARGET_URL = env.TARGET_URL || "https://api.openai.com";
    const PROXY_SECRET = env.PROXY_SECRET || "";

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Proxy-Secret",
      "Access-Control-Max-Age": "86400",
    };

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Проверка секрета (если задан)
    if (PROXY_SECRET) {
      const got = request.headers.get("X-Proxy-Secret");
      if (got !== PROXY_SECRET) {
        return new Response(
          JSON.stringify({ error: "Unauthorized: bad X-Proxy-Secret" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Собираем целевой URL
    const url = new URL(request.url);
    const targetUrl = TARGET_URL.replace(/\/$/, "") + url.pathname + url.search;

    // Копируем заголовки, убирая X-Proxy-Secret (чужому API он не нужен)
    const newHeaders = new Headers(request.headers);
    newHeaders.delete("X-Proxy-Secret");
    newHeaders.delete("Host");

    let body = null;
    if (request.method !== "GET" && request.method !== "HEAD") {
      body = await request.arrayBuffer();
    }

    let upstream;
    try {
      upstream = await fetch(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body,
        redirect: "follow",
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Upstream fetch failed", detail: String(err) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Возвращаем ответ с CORS-заголовками
    const resp = new Response(upstream.body, upstream);
    for (const [k, v] of Object.entries(corsHeaders)) {
      resp.headers.set(k, v);
    }
    return resp;
  },
};
