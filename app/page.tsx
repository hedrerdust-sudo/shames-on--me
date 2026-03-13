"use client"

import { supabase } from "../lib/supabase";
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [createResultCode, setCreateResultCode] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [hostName, setHostName] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [joinResult, setJoinResult] = useState<{ code: string; name: string } | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const normalizedRoomCode = useMemo(
    () => roomCode.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4),
    [roomCode]
  );

  function generateRoomCode() {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let code = "";
    for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    return code;
  }

  async function createRoom() {
    const name = hostName.trim();
    if (!name) {
      setCreateError("Please enter a host name.");
      return;
    }

    setBusy("create");
    setCreateError(null);
    setJoinError(null);
    setJoinResult(null);

    try {
      let lastError: unknown = null;

      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateRoomCode();

        const { data: room, error: roomError } = await supabase
          .from("rooms")
          .insert([{ code }])
          .select("id, code")
          .single();

        if (roomError) {
          lastError = roomError;
          continue;
        }

        const { data: hostPlayer, error: hostError } = await supabase
          .from("players")
          .insert([{ room_id: room.id, name, is_host: true }])
          .select("id, name, is_host")
          .single();

        if (hostError) {
          lastError = hostError;
          // Best effort cleanup is omitted (no server-side auth); user can recreate.
          break;
        }

        try {
          sessionStorage.setItem("som:room_code", room.code);
          sessionStorage.setItem("som:player_name", hostPlayer?.name ?? name);
          sessionStorage.setItem("som:is_host", hostPlayer?.is_host ? "true" : "false");
          sessionStorage.setItem("som:player_id", String(hostPlayer?.id ?? ""));
        } catch {
          // Ignore storage failures (private mode etc.)
        }

        setCreateResultCode(room.code);
        return;
      }

      throw lastError ?? new Error("Failed to create room");
    } catch (e) {
      console.error(e);
      setCreateError("Could not create room. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function joinRoom() {
    const name = playerName.trim();
    const code = normalizedRoomCode;

    setBusy("join");
    setJoinError(null);
    setCreateError(null);

    try {
      if (!name) {
        setJoinError("Please enter your name.");
        return;
      }
      if (code.length !== 4) {
        setJoinError("Please enter a 4-letter room code.");
        return;
      }

      const { data: room, error: roomError } = await supabase
        .from("rooms")
        .select("id, code")
        .eq("code", code)
        .maybeSingle();

      if (roomError) throw roomError;
      if (!room) {
        setJoinError("Room not found.");
        return;
      }

      const { data: player, error: playerError } = await supabase
        .from("players")
        .insert([
          {
            room_id: room.id,
            name,
            is_host: false,
          },
        ])
        .select("id, is_host")
        .single();

      if (playerError) throw playerError;

      try {
        sessionStorage.setItem("som:room_code", room.code);
        sessionStorage.setItem("som:player_name", name);
        sessionStorage.setItem("som:is_host", player?.is_host ? "true" : "false");
        sessionStorage.setItem("som:player_id", String(player?.id ?? ""));
      } catch {
        // Ignore storage failures.
      }

      setJoinResult({ code: room.code, name });
      router.push(`/room/${room.code}`);
    } catch (e) {
      console.error(e);
      setJoinError("Could not join room. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold tracking-tight text-center">Shames On Me</h1>
        <p className="mt-2 text-center text-sm text-white/60">
          Create a room or join one with a code.
        </p>

        <div className="mt-8 space-y-6">
          <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <h2 className="text-sm font-semibold text-white/80">Host</h2>

            <div className="mt-3 space-y-3">
              <div>
                <label className="text-xs text-white/60">Host name</label>
                <input
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  placeholder="e.g. Halil"
                  className="mt-1 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-3 outline-none focus:border-white/30"
                />
              </div>

              <button
                onClick={createRoom}
                disabled={busy !== null}
                className="w-full rounded-xl bg-white text-black py-3 font-semibold disabled:opacity-50"
              >
                {busy === "create" ? "Creating..." : "Create Room"}
              </button>
            </div>

            {createResultCode && (
              <div className="mt-4 rounded-xl bg-black/40 border border-white/10 p-3">
                <div className="text-xs text-white/60">Created room code</div>
                <div className="mt-1 text-2xl font-bold tracking-widest">{createResultCode}</div>
                <button
                  onClick={() => router.push(`/room/${createResultCode}`)}
                  className="mt-3 w-full rounded-xl bg-red-600 py-2.5 font-semibold"
                >
                  Enter Room
                </button>
              </div>
            )}

            {createError && <p className="mt-3 text-sm text-red-400">{createError}</p>}
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <h2 className="text-sm font-semibold text-white/80">Player</h2>

            <div className="mt-3 space-y-3">
              <div>
                <label className="text-xs text-white/60">Player name</label>
                <input
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="e.g. Halile"
                  className="mt-1 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-3 outline-none focus:border-white/30"
                />
              </div>

              <div>
                <label className="text-xs text-white/60">Room code</label>
                <input
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
                  placeholder="ABCD"
                  inputMode="text"
                  autoCapitalize="characters"
                  className="mt-1 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-3 tracking-widest uppercase outline-none focus:border-white/30"
                />
              </div>

              <button
                onClick={joinRoom}
                disabled={busy !== null}
                className="w-full rounded-xl bg-red-600 py-3 font-semibold disabled:opacity-50"
              >
                {busy === "join" ? "Joining..." : "Join Room"}
              </button>

              {joinError && <p className="text-sm text-red-400">{joinError}</p>}

              {joinResult && (
                <div className="rounded-xl bg-black/40 border border-white/10 p-3 text-sm">
                  <div>
                    <span className="text-white/60">Joined room:</span>{" "}
                    <span className="font-semibold tracking-widest">{joinResult.code}</span>
                  </div>
                  <div className="mt-1">
                    <span className="text-white/60">Player name:</span>{" "}
                    <span className="font-semibold">{joinResult.name}</span>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}