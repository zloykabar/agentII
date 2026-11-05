/**
 * Cloudflare Worker — прокси для ИИ-агента с диагностикой.
 * Переменные окружения (Settings → Variables and Secrets):
 *   TARGET_URL   — по умолчанию https://api.openai.com
 *   PROXY_SECRET — необязательный секрет в заголовке X-Proxy-Secret
 */

export default {
  async fetch(request, env) {
    const TARGET_URL = (env.TARGET_URL || "https://api.openai.com").replace(/\/+$/, "");
    const PROXY_SECRET = env.PROXY_SECRET || "";

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Proxy-Secret",
      "Access-Control-Max-Age": "86400",
    };

    // -------- Диагностический ping --------
    if (request.method === "GET") {
      return json({
        ok: true,
        service: "ai-agent-proxy",
        target: TARGET_URL,
        secret_required: Boolean(PROXY_SECRET),
        hint: "Отправьте POST на /v1/chat/completions",
      }, 200, cors);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, cors);
    }

    // -------- Проверка секрета --------
    if (PROXY_SECRET) {
      const got = request.headers.get("X-Proxy-Secret");
      if (got !== PROXY_SECRET) {
        return json({
          error: "Bad X-Proxy-Secret",
          hint: "Секрет в настройках агента не совпадает с переменной PROXY_SECRET в Worker.",
        }, 401, cors);
      }
    }

    // -------- Сборка целевого URL --------
    const url = new URL(request.url);
    const targetUrl = TARGET_URL + url.pathname + url.search;

    const headers = new Headers(request.headers);
    headers.delete("X-Proxy-Secret");
    headers.delete("Host");
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ray");
    headers.delete("cf-visitor");
    headers.delete("x-forwarded-proto");
    headers.delete("x-real-ip");

    const body = await request.arrayBuffer();

    let upstream;
    try {
      upstream = await fetch(targetUrl, {
        method: "POST",
        headers,
        body,
        redirect: "follow",
      });
    } catch (err) {
      return json({
        error: "Upstream fetch failed",
        target: targetUrl,
        detail: String(err),
        hint: "Проверьте TARGET_URL и доступность провайдера из Cloudflare.",
      }, 502, cors);
    }

    const resp = new Response(upstream.body, upstream);
    for (const [k, v] of Object.entries(cors)) resp.headers.set(k, v);
    resp.headers.set("X-Proxy-Target", targetUrl);
    return resp;
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
