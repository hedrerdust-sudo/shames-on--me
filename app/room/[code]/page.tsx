"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

type RoomRow = { id: string | number; code: string; started?: boolean | null };
type PlayerRow = { id: string | number; name: string; is_host: boolean };

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = useMemo(() => (params?.code ?? "").toString().toUpperCase(), [params]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [hasNavigatedToPlay, setHasNavigatedToPlay] = useState(false);
  const [joinName, setJoinName] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isKnownPlayer, setIsKnownPlayer] = useState(false);

  useEffect(() => {
    try {
      const storedCode = sessionStorage.getItem("som:room_code")?.toUpperCase();
      const storedIsHost = sessionStorage.getItem("som:is_host") === "true";
      setIsHost(Boolean(storedCode && storedCode === code && storedIsHost));
    } catch {
      setIsHost(false);
    }
  }, [code]);

  useEffect(() => {
    try {
      const storedPlayerId = sessionStorage.getItem("som:player_id");
      if (!storedPlayerId) return;

      const me = players.find((p) => String(p.id) === storedPlayerId);
      if (me) {
        setIsKnownPlayer(true);
        setIsHost(Boolean(me.is_host));
      }
    } catch {
      // If session storage is unavailable, keep existing host state.
    }
  }, [players]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const { data: foundRoom, error: roomError } = await supabase
          .from("rooms")
          .select("id, code, started")
          .eq("code", code)
          .maybeSingle();

        if (roomError) throw roomError;
        if (!foundRoom) {
          if (!cancelled) setError("Room not found.");
          return;
        }

        const { data: foundPlayers, error: playersError } = await supabase
          .from("players")
          .select("id, name, is_host")
          .eq("room_id", foundRoom.id)
          .order("is_host", { ascending: false })
          .order("name", { ascending: true });

        if (playersError) throw playersError;

        if (!cancelled) {
          setRoom(foundRoom as RoomRow);
          setPlayers((foundPlayers ?? []) as PlayerRow[]);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setError("Could not load room.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (code && code.length === 4) load();
    else {
      setLoading(false);
      setError("Invalid room code.");
    }

    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    if (!code || code.length !== 4 || hasNavigatedToPlay) return;

    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled || hasNavigatedToPlay) return;

      try {
        const { data, error } = await supabase
          .from("rooms")
          .select("started")
          .eq("code", code)
          .maybeSingle();

        if (error) {
          // Swallow polling errors; UI already surfaces main load error.
          return;
        }

        if (data?.started) {
          setHasNavigatedToPlay(true);
          router.push(`/room/${code}/play`);
        }
      } catch {
        // Ignore transient errors in polling.
      }
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [code, hasNavigatedToPlay, router]);

  async function handleJoinRoomHere() {
    const name = joinName.trim();
    if (!name || !room) {
      setJoinError("Please enter your name.");
      return;
    }

    setJoinBusy(true);
    setJoinError(null);

    try {
      const { data: player, error: playerError } = await supabase
        .from("players")
        .insert([
          {
            room_id: room.id,
            name,
            is_host: false,
          },
        ])
        .select("id, name, is_host")
        .single();

      if (playerError) throw playerError;

      try {
        sessionStorage.setItem("som:room_code", code);
        sessionStorage.setItem("som:player_name", player?.name ?? name);
        sessionStorage.setItem("som:is_host", player?.is_host ? "true" : "false");
        sessionStorage.setItem("som:player_id", String(player?.id ?? ""));
      } catch {
        // ignore storage errors
      }

      setPlayers((prev) =>
        player
          ? [
              ...prev,
              {
                id: player.id,
                name: player.name,
                is_host: player.is_host,
              },
            ]
          : prev
      );
      setIsKnownPlayer(true);
      setJoinName("");
    } catch (e) {
      console.error(e);
      setJoinError("Could not join this room. Please try again.");
    } finally {
      setJoinBusy(false);
    }
  }

  async function handleStartGame() {
    if (!room) return;

    try {
      const { error } = await supabase
        .from("rooms")
        .update({ started: true })
        .eq("id", room.id);

      if (error) {
        console.error(error);
        setError("Could not start game. Please try again.");
        return;
      }

      setHasNavigatedToPlay(true);
      router.push(`/room/${code}/play`);
    } catch (e) {
      console.error(e);
      setError("Could not start game. Please try again.");
    }
  }

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center p-6">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/60">Room</div>
          <div className="mt-1 text-2xl font-bold tracking-widest">{code}</div>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
          <h2 className="text-sm font-semibold text-white/80">Players in room</h2>

          {loading && <p className="mt-3 text-sm text-white/60">Loading...</p>}
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

          {!loading && !error && (
            <ul className="mt-3 space-y-2">
              {players.length === 0 ? (
                <li className="text-sm text-white/60">No players yet.</li>
              ) : (
                players.map((p) => (
                  <li
                    key={String(p.id)}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-black/40 px-3 py-2"
                  >
                    <span className="font-medium">{p.name}</span>
                    {p.is_host && (
                      <span className="text-xs rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-white/80">
                        Host
                      </span>
                    )}
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        {isKnownPlayer && isHost && (
          <button
            className="mt-6 w-full rounded-xl bg-red-600 py-3 font-semibold disabled:opacity-50"
            onClick={handleStartGame}
            disabled={loading || Boolean(error) || !room}
          >
            Start Game
          </button>
        )}

        {!isKnownPlayer && !loading && !error && room && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
            <h2 className="text-sm font-semibold text-white/80">Join this room</h2>
            <div className="mt-3 space-y-3">
              <div>
                <label className="text-xs text-white/60">Your name</label>
                <input
                  value={joinName}
                  onChange={(e) => setJoinName(e.target.value)}
                  placeholder="e.g. Halil"
                  className="mt-1 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-3 outline-none focus:border-white/30"
                />
              </div>

              <button
                onClick={handleJoinRoomHere}
                disabled={joinBusy}
                className="w-full rounded-xl bg-red-600 py-3 font-semibold disabled:opacity-50"
              >
                {joinBusy ? "Joining..." : "Join Room"}
              </button>

              {joinError && <p className="text-sm text-red-400">{joinError}</p>}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

