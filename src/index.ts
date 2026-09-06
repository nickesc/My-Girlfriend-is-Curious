import type { SpotifySession } from "./spotify-session";
export { SpotifySession } from "./spotify-session";

export interface Bindings {
  ASSETS: Fetcher;
  SPOTIFY_SESSION: DurableObjectNamespace<SpotifySession>;
  PUBLIC_BASE_URL: string;
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  SPOTIFY_USER_ID: string;
  IFTTT_KEY: string;
  IFTTT_EVENT: string;
  ALLOWED_ORIGINS: string;
}

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const url = new URL(request.url);
    const routes = ["/current", "/health", "/login", "/callback", "/missingAlbum.svg"];
    let response: Response;
    if (!routes.includes(url.pathname)) response = new Response("Not found", { status: 404 });
    else if (request.method === "OPTIONS" && url.pathname === "/current") response = new Response(null, { status: 204 });
    else if (request.method !== "GET") response = new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
    else if (url.pathname === "/missingAlbum.svg") response = await env.ASSETS.fetch(request);
    else if (url.pathname === "/health") response = Response.json({ ok: true });
    else if (!env.PUBLIC_BASE_URL || !env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET || !env.SPOTIFY_USER_ID || !env.IFTTT_KEY || !env.IFTTT_EVENT) {
      response = Response.json({ error: "backend_not_configured" }, { status: 503 });
    } else {
      try {
        const base = new URL(env.PUBLIC_BASE_URL);
        if (base.protocol !== "https:" || base.origin !== url.origin) {
          response = Response.json({ error: "invalid_origin" }, { status: 400 });
        } else {
          response = await env.SPOTIFY_SESSION.getByName("owner").fetch(new Request(request, { redirect: "manual" }));
        }
      } catch {
        response = Response.json({ error: "backend_unavailable" }, { status: 503 });
      }
    }
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", url.pathname === "/missingAlbum.svg" ? "public, max-age=86400" : "no-store");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (url.pathname === "/current") {
      headers.set("Vary", "Origin");
      const origin = request.headers.get("Origin");
      if (origin && env.ALLOWED_ORIGINS.split(",").map(s => s.trim()).includes(origin)) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
        headers.set("Access-Control-Expose-Headers", "Retry-After, X-Playback-Stale");
      }
    }
    return new Response(response.body, { status: response.status, headers });
  }
} satisfies ExportedHandler<Bindings>;
