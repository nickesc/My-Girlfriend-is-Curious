import { DurableObject } from "cloudflare:workers";
import type { Bindings } from "./index";
import { transform, type Playback, type Current } from "./transform";

const CACHE_MS = 10_000;
const LINK_MS = 24 * 60 * 60 * 1000;
const COOKIE = "__Host-mgic-oauth";
type Tokens = { access: string; refresh: string; expiresAt: number };
type Recovery = { ticket: string; expiresAt: number; nextAttemptAt: number; sent: boolean };
type Login = { state: string; browser: string; expiresAt: number };
type Snapshot = { value: Current; at: number };
type Failure = { error: string; status: number; until: number };
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, "0")).join("");

class UpstreamError extends Error {
  constructor(public code: string, public status = 503, public retry = 10) { super(code); }
}

export class SpotifySession extends DurableObject<Bindings> {
  // Serialize the whole operation, including network awaits. Durable Object
  // storage gates alone do not prevent interleaving while fetching Spotify.
  private queue: Promise<unknown> = Promise.resolve();

  fetch(request: Request): Promise<Response> {
    const operation = this.queue.then(() => this.handle(request));
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  private async handle(request: Request): Promise<Response> {
    try {
      switch (new URL(request.url).pathname) {
        case "/current": return await this.current();
        case "/login": return await this.login(request);
        case "/callback": return await this.callback(request);
        default: return new Response("Not found", { status: 404 });
      }
    } catch (error) {
      const failure = error instanceof UpstreamError ? error : new UpstreamError("spotify_unavailable");
      return Response.json({ error: failure.code }, { status: failure.status, headers: { "Retry-After": String(failure.retry) } });
    }
  }

  private async network(url: string, init: RequestInit = {}): Promise<Response> {
    // Clear the timeout immediately after the response arrives so it cannot
    // keep an otherwise idle object awake.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const body = await response.arrayBuffer();
      return new Response(response.status === 204 ? null : body, { status: response.status, headers: response.headers });
    } catch { throw new UpstreamError("spotify_unavailable"); }
    finally { clearTimeout(timeout); }
  }

  private async check(response: Response): Promise<void> {
    if (response.ok) return;
    if (response.status === 429) {
      const raw = response.headers.get("Retry-After");
      const seconds = raw && /^\d+$/.test(raw) ? Number(raw) : 60;
      throw new UpstreamError("spotify_rate_limited", 429, Math.max(1, seconds));
    }
    if (response.status === 403) throw new UpstreamError("spotify_forbidden", 503, 60);
    throw new UpstreamError("spotify_unavailable", 503, 10);
  }

  private async exchange(body: URLSearchParams, previous?: Tokens): Promise<Tokens> {
    const response = await this.network("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${this.env.SPOTIFY_CLIENT_ID}:${this.env.SPOTIFY_CLIENT_SECRET}`)}` },
      body: body.toString()
    });
    if (response.status === 400) {
      const data = await response.json() as { error?: string };
      if (data.error === "invalid_grant") throw new UpstreamError("spotify_reauthorization_required", 503, 60);
    }
    await this.check(response);
    const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!data.access_token || !(data.refresh_token || previous?.refresh) || !data.expires_in || data.expires_in <= 0) throw new UpstreamError("spotify_invalid_response");
    return { access: data.access_token, refresh: data.refresh_token || previous!.refresh, expiresAt: Date.now() + data.expires_in * 1000 };
  }

  private async token(force = false): Promise<Tokens> {
    const saved = await this.ctx.storage.get<Tokens>("tokens");
    if (!saved) throw new UpstreamError("spotify_reauthorization_required", 503, 60);
    if (!force && saved.expiresAt > Date.now() + 60_000) return saved;
    const next = await this.exchange(new URLSearchParams({ grant_type: "refresh_token", refresh_token: saved.refresh }), saved);
    await this.ctx.storage.put("tokens", next);
    return next;
  }

  private async notify(): Promise<void> {
    let recovery = await this.ctx.storage.get<Recovery>("recovery");
    const now = Date.now();
    if (!recovery || recovery.expiresAt <= now) {
      recovery = { ticket: random(), expiresAt: now + LINK_MS, nextAttemptAt: 0, sent: false };
    }
    if (recovery.sent || recovery.nextAttemptAt > now) return;
    // Persist before sending: a crash or ambiguous response must not cause
    // every widget request to send another notification.
    recovery.nextAttemptAt = now + 15 * 60_000;
    await this.ctx.storage.put("recovery", recovery);
    try {
      const link = new URL("/login", this.env.PUBLIC_BASE_URL);
      link.searchParams.set("ticket", recovery.ticket);
      const response = await this.network(`https://maker.ifttt.com/trigger/${encodeURIComponent(this.env.IFTTT_EVENT)}/with/key/${encodeURIComponent(this.env.IFTTT_KEY)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value1: link.href, value2: "Spotify needs reauthorization. This link expires in 24 hours." })
      });
      if (response.ok) {
        recovery.sent = true;
        await this.ctx.storage.put("recovery", recovery);
      }
    } catch { /* Retry only on a later request after the persisted cooldown. */ }
  }

  private async current(): Promise<Response> {
    const now = Date.now();
    const snapshot = await this.ctx.storage.get<Snapshot>("playback");
    const failure = await this.ctx.storage.get<Failure>("failure");
    if (failure && failure.until > now) return this.failureResponse(failure, snapshot);
    if (snapshot && now - snapshot.at < CACHE_MS) return Response.json(snapshot.value);
    try {
      let tokens = await this.token();
      const playerUrl = "https://api.spotify.com/v1/me/player?additional_types=episode";
      let response = await this.network(playerUrl, { headers: { Authorization: `Bearer ${tokens.access}` } });
      if (response.status === 401) {
        tokens = await this.token(true);
        response = await this.network(playerUrl, { headers: { Authorization: `Bearer ${tokens.access}` } });
      }
      await this.check(response);
      const playback = response.status === 204 ? null : await response.json() as Playback;
      if (response.status !== 204 && (!playback || typeof playback.is_playing !== "boolean")) throw new UpstreamError("spotify_invalid_response");
      let context: Parameters<typeof transform>[1];
      // Album/show names already exist in the player response. Only enrich
      // other contexts, and cache their small metadata separately.
      const match = playback?.context?.uri?.match(/^spotify:(playlist|artist):([A-Za-z0-9]+)$/);
      if (playback?.is_playing && match) {
        const key = `context:${match[1]}:${match[2]}`;
        const cached = await this.ctx.storage.get<{ value: Parameters<typeof transform>[1]; at: number }>("context");
        const cachedKey = await this.ctx.storage.get<string>("contextKey");
        if (cached && cachedKey === key && now - cached.at < 3600_000) context = cached.value;
        else {
          try {
            const extra = await this.network(`https://api.spotify.com/v1/${match[1]}s/${match[2]}${match[1] === "playlist" ? "?fields=name,type,external_urls" : ""}`, { headers: { Authorization: `Bearer ${tokens.access}` } });
            if (extra.status === 429) await this.check(extra);
            context = extra.ok ? await extra.json() as NonNullable<Parameters<typeof transform>[1]> : null;
            await this.ctx.storage.put({ context: { value: context, at: now }, contextKey: key });
          } catch (error) {
            if (error instanceof UpstreamError && error.code === "spotify_rate_limited") throw error;
            // Optional context must not hide otherwise valid playback.
            context = null;
          }
        }
      }
      const missingAlbumUrl = new URL("/missingAlbum.svg", this.env.PUBLIC_BASE_URL).href;
      const value = transform(playback, context, missingAlbumUrl);
      await this.ctx.storage.put("playback", { value, at: Date.now() });
      await this.ctx.storage.delete("failure");
      return Response.json(value);
    } catch (error) {
      const problem = error instanceof UpstreamError ? error : new UpstreamError("spotify_unavailable");
      if (problem.code === "spotify_reauthorization_required") {
        await this.ctx.storage.delete(["tokens", "playback"]);
        await this.notify();
      }
      const next = { error: problem.code, status: problem.status, until: Date.now() + problem.retry * 1000 };
      await this.ctx.storage.put("failure", next);
      return this.failureResponse(next, snapshot);
    }
  }

  private failureResponse(failure: Failure, snapshot?: Snapshot): Response {
    const headers = { "Retry-After": String(Math.max(1, Math.ceil((failure.until - Date.now()) / 1000))) };
    if (["spotify_unavailable", "spotify_rate_limited"].includes(failure.error) && snapshot && Date.now() - snapshot.at <= 30_000) {
      return Response.json(snapshot.value, { headers: { ...headers, "X-Playback-Stale": "true" } });
    }
    return Response.json({ error: failure.error }, { status: failure.status, headers });
  }

  private async login(request: Request): Promise<Response> {
    const recovery = await this.ctx.storage.get<Recovery>("recovery");
    const ticket = new URL(request.url).searchParams.get("ticket");
    if (!recovery || recovery.expiresAt <= Date.now() || ticket !== recovery.ticket) return new Response("This login link has expired. Open the widget to request a new notification.", { status: 400 });
    const login: Login = { state: random(), browser: random(), expiresAt: Date.now() + 10 * 60_000 };
    await this.ctx.storage.put("login", login);
    const url = new URL("https://accounts.spotify.com/authorize");
    url.search = new URLSearchParams({ client_id: this.env.SPOTIFY_CLIENT_ID, response_type: "code", redirect_uri: new URL("/callback", this.env.PUBLIC_BASE_URL).href, state: login.state, scope: "user-read-playback-state" }).toString();
    return new Response(null, { status: 302, headers: { Location: url.href, "Set-Cookie": `${COOKIE}=${login.browser}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600` } });
  }

  private async callback(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const login = await this.ctx.storage.get<Login>("login");
    const cookie = request.headers.get("Cookie")?.split(";").map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (!login || login.expiresAt <= Date.now() || url.searchParams.get("state") !== login.state || cookie !== login.browser) return new Response("Invalid or expired authorization. Reopen your IFTTT link.", { status: 400 });
    await this.ctx.storage.delete("login");
    const code = url.searchParams.get("code");
    if (url.searchParams.has("error") || !code) return new Response("Authorization cancelled. Reopen your IFTTT link to try again.", { status: 400 });
    const tokens = await this.exchange(new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: new URL("/callback", this.env.PUBLIC_BASE_URL).href }));
    const profile = await this.network("https://api.spotify.com/v1/me", { headers: { Authorization: `Bearer ${tokens.access}` } });
    await this.check(profile);
    const owner = await profile.json() as { id?: string };
    if (owner.id !== this.env.SPOTIFY_USER_ID) return new Response("Please authorize the Spotify account configured for this widget.", { status: 403 });
    await this.ctx.storage.put("tokens", tokens);
    await this.ctx.storage.delete(["recovery", "failure", "playback", "context", "contextKey"]);
    return new Response("Spotify is connected. You can close this page.", { headers: { "Set-Cookie": `${COOKIE}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` } });
  }
}
