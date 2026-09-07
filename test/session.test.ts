import {env} from "cloudflare:workers";
import {SELF, runInDurableObject, reset, evictDurableObject} from "cloudflare:test";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import worker, {type Bindings} from "../src/index";
import {transform} from "../src/transform";

const bindings = env as unknown as Bindings;
const missingAlbumUrl = "https://mgic.example/missingAlbum.svg";
const stub = () => bindings.SPOTIFY_SESSION.getByName("owner");
const get = (path = "/current", headers = {}) =>
    worker.fetch(new Request(`https://mgic.example${path}`, {headers}), bindings);
const state = <T>(key: string) => runInDurableObject(stub(), (_, ctx) => ctx.storage.get<T>(key));
const put = (values: Record<string, unknown>) => runInDurableObject(stub(), (_, ctx) => ctx.storage.put(values));
const track = {
    is_playing: true,
    progress_ms: 500,
    device: {type: "computer", name: "Laptop", volume_percent: 50},
    item: {
        type: "track",
        name: "Track",
        duration_ms: 1000,
        album: {name: "Album", type: "album", images: [{url: "https://i.scdn.co/image/a"}]},
        artists: [{name: "Artist"}],
    },
};
let fetchMock: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request"));
});
afterEach(async () => {
    vi.restoreAllMocks();
    await reset();
});
async function seed(expired = false) {
    await put({tokens: {access: "access", refresh: "refresh", expiresAt: Date.now() + (expired ? -1 : 3600_000)}});
}

it("keeps health, unknown routes, and methods independent of Spotify", async () => {
    expect((await get("/health")).status).toBe(200);
    expect((await get("/missing")).status).toBe(404);
    expect((await worker.fetch(new Request("https://mgic.example/current", {method: "POST"}), bindings)).status).toBe(
        405,
    );
    expect(fetchMock).not.toHaveBeenCalled();
});

it("serves the missing album artwork from the Worker", async () => {
    const response = await SELF.fetch("https://mgic.example/missingAlbum.svg");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("image/svg+xml");
    expect(await response.text()).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
});

it("returns the Worker's artwork URL when Spotify has no image", async () => {
    await seed();
    fetchMock.mockImplementation(() =>
        Response.json({...track, item: {...track.item, album: {...track.item.album, images: []}}}),
    );
    expect(await (await get()).json()).toMatchObject({track: {image: missingAlbumUrl}});
});

it("restricts CORS without requiring browser visibility headers", async () => {
    await seed();
    fetchMock.mockImplementation(() => Response.json(track));
    const result = await get("/current", {Origin: "https://nickesc.github.io"});
    expect(result.headers.get("Access-Control-Allow-Origin")).toBe("https://nickesc.github.io");
    expect(
        (await get("/current", {Origin: "https://untrusted.example"})).headers.get("Access-Control-Allow-Origin"),
    ).toBeNull();
    expect((await get()).status).toBe(200);
});

it("refreshes and fetches once for concurrent consumers, then survives eviction", async () => {
    await seed(true);
    fetchMock.mockImplementation(async (url: RequestInfo | URL) =>
        String(url).includes("/api/token")
            ? Response.json({access_token: "new-access", refresh_token: "rotated", expires_in: 3600})
            : Response.json(track),
    );
    const responses = await Promise.all(Array.from({length: 8}, () => get()));
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await state<{refresh: string}>("tokens"))?.refresh).toBe("rotated");
    await Promise.all(responses.map((response) => (response.bodyUsed ? undefined : response.arrayBuffer())));
    await evictDurableObject(stub());
    expect((await get()).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("keeps the existing refresh token when refresh omits a replacement", async () => {
    await seed(true);
    fetchMock
        .mockImplementationOnce(() => Response.json({access_token: "new", expires_in: 3600}))
        .mockImplementationOnce(() => new Response(null, {status: 204}));
    expect(await (await get()).json()).toMatchObject({playing: false});
    expect((await state<{refresh: string}>("tokens"))?.refresh).toBe("refresh");
});

it("retries a playback 401 only once", async () => {
    await seed();
    fetchMock
        .mockImplementationOnce(() => new Response(null, {status: 401}))
        .mockImplementationOnce(() => Response.json({access_token: "new", expires_in: 3600}))
        .mockImplementationOnce(() => new Response(null, {status: 401}));
    expect((await get()).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
});

it.each([403, 429, 500])("backs off on Spotify %s without calling it on each poll", async (status) => {
    await seed();
    fetchMock.mockImplementation(() => new Response(null, {status, headers: {"Retry-After": "120"}}));
    const first = await get();
    expect(first.status).toBe(status === 429 ? 429 : 503);
    if (status === 429) expect(first.headers.get("Retry-After")).toBe("120");
    await get();
    expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("respects the notification cooldown across eviction", async () => {
    await seed(true);
    fetchMock
        .mockImplementationOnce(() => Response.json({error: "invalid_grant"}, {status: 400}))
        .mockImplementationOnce(() => new Response("ok"));
    const responses = await Promise.all([get(), get(), get()]);
    expect(await responses[0].json()).toEqual({error: "spotify_reauthorization_required"});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await state("tokens")).toBeUndefined();
    await Promise.all(responses.map((response) => (response.bodyUsed ? undefined : response.arrayBuffer())));
    await evictDurableObject(stub());
    await put({failure: {until: 0}});
    await get();
    expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("completes browser-bound authorization and rejects callback replay", async () => {
    fetchMock.mockImplementationOnce(() => new Response("ok"));
    await get();
    const recovery = await state<{ticket: string}>("recovery");
    const login = await get(`/login?ticket=${recovery!.ticket}`);
    expect(login.status).toBe(302);
    const oauth = new URL(login.headers.get("Location")!);
    expect(oauth.searchParams.get("scope")).toBe("user-read-playback-state");
    const cookie = login.headers.get("Set-Cookie")!.split(";")[0];
    const path = `/callback?state=${oauth.searchParams.get("state")}&code=test-code`;
    expect((await get(path)).status).toBe(400);
    fetchMock
        .mockImplementationOnce(() =>
            Response.json({access_token: "access", refresh_token: "refresh", expires_in: 3600}),
        )
        .mockImplementationOnce(() => Response.json({id: "goofyshnoofy"}));
    expect((await get(path, {Cookie: cookie})).status).toBe(200);
    expect(await state("recovery")).toBeUndefined();
    expect((await get(path, {Cookie: cookie})).status).toBe(400);
});

it("rejects expired login links and renews the notification on demand", async () => {
    await put({recovery: {ticket: "expired", expiresAt: 0, nextAttemptAt: 0, sent: true}});
    expect((await get("/login?ticket=expired")).status).toBe(400);
    fetchMock.mockImplementation(() => new Response("ok"));
    await get();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await state<{ticket: string}>("recovery"))?.ticket).not.toBe("expired");
});

it("does not spam IFTTT after an ambiguous delivery failure", async () => {
    await get();
    await put({failure: {until: 0}});
    await get();
    expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("maps tracks, podcasts without publisher, private sessions and unknown items safely", () => {
    expect(transform(track, undefined, missingAlbumUrl)).toMatchObject({
        playing: true,
        player: {progress: 0.5},
        track: {name: "Track"},
        device: {type: "Computer"},
    });
    expect(
        transform(
            {is_playing: true, item: {type: "episode", name: "Episode", show: {name: "Show"}}},
            undefined,
            missingAlbumUrl,
        ),
    ).toMatchObject({track: {artists: {names: ["Show"]}, context: {name: "Show"}, image: missingAlbumUrl}});
    expect(transform({...track, device: {is_private_session: true}}, undefined, missingAlbumUrl).playing).toBe(false);
    expect(transform({is_playing: true, item: {type: "ad"}}, undefined, missingAlbumUrl).playing).toBe(false);
    expect(transform(null, undefined, missingAlbumUrl).playing).toBe(false);
});

it("serves a ten-second cache, then bounds stale playback during an outage", async () => {
    await seed();
    fetchMock.mockImplementationOnce(() => Response.json(track));
    const value = await (await get()).json();
    await put({playback: {value, at: Date.now() - 9000}});
    expect((await get()).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await put({playback: {value, at: Date.now() - 11000}});
    fetchMock.mockImplementationOnce(() => new Response(null, {status: 500}));
    expect((await get()).headers.get("X-Playback-Stale")).toBe("true");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await put({playback: {value, at: Date.now() - 31000}});
    expect((await get()).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("does not make optional playlist metadata a playback dependency", async () => {
    await seed();
    fetchMock.mockImplementationOnce(() => Response.json({...track, context: {uri: "spotify:playlist:abc"}}));
    expect(await (await get()).json()).toMatchObject({playing: true, track: {context: null}});
});

it("caches playlist metadata across playback updates", async () => {
    await seed();
    fetchMock.mockImplementation(async (url: RequestInfo | URL) =>
        String(url).includes("/playlists/")
            ? Response.json({
                  name: "Playlist",
                  type: "playlist",
                  external_urls: {spotify: "https://open.spotify.com/playlist/abc"},
              })
            : Response.json({...track, context: {uri: "spotify:playlist:abc"}}),
    );
    const value = await (await get()).json();
    expect(value).toMatchObject({track: {context: {name: "Playlist"}}});
    await put({playback: {value, at: 0}});
    await get();
    expect(fetchMock).toHaveBeenCalledTimes(3);
});

it.each(["wrong-owner", "cancel", "expired"])("rejects %s authorization without changing tokens", async (mode) => {
    await seed();
    await put({login: {state: "state", browser: "browser", expiresAt: mode === "expired" ? 0 : Date.now() + 60000}});
    fetchMock
        .mockImplementationOnce(() => Response.json({access_token: "wrong", refresh_token: "wrong", expires_in: 3600}))
        .mockImplementationOnce(() => Response.json({id: "someone-else"}));
    const response = await get(`/callback?state=state&${mode === "cancel" ? "error=access_denied" : "code=code"}`, {
        Cookie: "__Host-mgic-oauth=browser",
    });
    expect(response.status).toBe(mode === "wrong-owner" ? 403 : 400);
    expect((await state<{access: string}>("tokens"))?.access).toBe("access");
    expect(fetchMock).toHaveBeenCalledTimes(mode === "wrong-owner" ? 2 : 0);
});

it("fails closed for missing configuration and unexpected hosts", async () => {
    expect(
        (await worker.fetch(new Request("https://mgic.example/current"), {...bindings, SPOTIFY_CLIENT_ID: ""})).status,
    ).toBe(503);
    expect((await worker.fetch(new Request("https://other.example/current"), bindings)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
});

it("does not misreport malformed playback as offline", async () => {
    await seed();
    fetchMock.mockImplementationOnce(() => Response.json({unexpected: true}));
    const result = await get();
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({error: "spotify_invalid_response"});
});

it("recovers from a 401 with the refreshed access token", async () => {
    await seed();
    fetchMock
        .mockImplementationOnce(() => new Response(null, {status: 401}))
        .mockImplementationOnce(() => Response.json({access_token: "new", expires_in: 3600}))
        .mockImplementationOnce((_: RequestInfo | URL, options?: RequestInit) => {
            expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer new");
            return Response.json(track);
        });
    expect((await get()).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("retries a failed IFTTT delivery only after the persisted cooldown", async () => {
    await get();
    const recovery = await state<{nextAttemptAt: number}>("recovery");
    expect(recovery!.nextAttemptAt).toBeGreaterThan(Date.now() + 9 * 60000);
    await put({failure: {until: 0}, recovery: {...recovery, nextAttemptAt: 0}});
    fetchMock.mockImplementationOnce(() => new Response("ok"));
    await get();
    expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("sends another IFTTT notification after a successful delivery cooldown", async () => {
    fetchMock.mockImplementation(() => new Response("ok"));
    await get();
    const recovery = await state<{nextAttemptAt: number}>("recovery");
    expect(recovery!.nextAttemptAt).toBeGreaterThan(Date.now() + 9 * 60000);
    await put({failure: {until: 0}, recovery: {...recovery, nextAttemptAt: 0}});
    await get();
    expect(fetchMock).toHaveBeenCalledTimes(2);
});
