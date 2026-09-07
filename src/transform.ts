type Entity = {
    name?: string;
    type?: string;
    publisher?: string;
    images?: {url?: string}[];
    external_urls?: {spotify?: string};
};
export interface Playback {
    is_playing?: boolean;
    progress_ms?: number | null;
    shuffle_state?: boolean;
    repeat_state?: string;
    device?: {name?: string; type?: string; volume_percent?: number | null; is_private_session?: boolean} | null;
    context?: {type?: string; uri?: string; external_urls?: {spotify?: string}} | null;
    item?:
        | (Entity & {duration_ms?: number; explicit?: boolean; album?: Entity; show?: Entity; artists?: Entity[]})
        | null;
}

export function spotifyUrl(value: unknown): string | null {
    if (typeof value !== "string") return null;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && url.hostname === "open.spotify.com" ? url.href : null;
    } catch {
        return null;
    }
}

export function transform(playback: Playback | null, context: Entity | null | undefined, missingAlbumUrl: string) {
    const item = playback?.item;
    const supported = item?.type === "track" || item?.type === "episode";
    if (!playback?.is_playing || !item || !supported || playback.device?.is_private_session) {
    return { playing: false, device: {}, player: {}, track: { context: null, artists: { names: [] } } };
    }
    const episode = item.type === "episode";
    const group = episode ? item.show : item.album;
    const artists = episode
        ? [item.show?.publisher || item.show?.name || "Podcast"]
        : (item.artists || []).map((a) => a.name || "Unknown artist");
    const contextEntity = context === undefined ? group : context;
    const image = (episode ? item.images : item.album?.images)?.find((i) => i.url?.startsWith("https://"))?.url;
    const deviceType = playback.device?.type || "";
    return {
        playing: true,
        device: {
            name: playback.device?.name || "",
            type: deviceType.charAt(0).toUpperCase() + deviceType.slice(1).toLowerCase(),
        },
        player: {
            vol: Math.max(0, Math.min(100, playback.device?.volume_percent ?? 0)),
            shuffle: playback.shuffle_state ?? false,
            repeat: playback.repeat_state || "off",
            progress:
                item.duration_ms && item.duration_ms > 0
                    ? Math.max(0, Math.min(1, (playback.progress_ms ?? 0) / item.duration_ms))
                    : 0,
        },
        track: {
            context: contextEntity?.name
                ? {
                      name: contextEntity.name,
                      type: contextEntity.type || (episode ? "show" : "album"),
                      url: spotifyUrl(contextEntity.external_urls?.spotify),
                  }
                : null,
            artists: {
                names: artists,
                url: spotifyUrl(
                    episode ? item.show?.external_urls?.spotify : item.artists?.[0]?.external_urls?.spotify,
                ),
            },
            contentType: item.type,
            name: item.name || "Unknown title",
            image: image || missingAlbumUrl,
            explicit: item.explicit ?? false,
            url: spotifyUrl(item.external_urls?.spotify),
        },
    };
}
export type Current = ReturnType<typeof transform>;
