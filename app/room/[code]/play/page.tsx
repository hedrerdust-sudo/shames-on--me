"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";
import { QUESTIONS } from "../../../../data/questions";

type RoomRow = { id: string | number; code: string };

export default function PlayPage() {
  const params = useParams<{ code: string }>();
  const code = useMemo(() => (params?.code ?? "").toString().toUpperCase(), [params]);
  const router = useRouter();

  const [room, setRoom] = useState<RoomRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [answering, setAnswering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [answeredCount, setAnsweredCount] = useState<number | null>(null);
  const [totalPlayers, setTotalPlayers] = useState<number | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [hasNavigatedToReveal, setHasNavigatedToReveal] = useState(false);

  const currentQuestion = QUESTIONS[questionIndex];

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(`som:question_index:${code}`);
      const parsed = stored !== null ? Number(stored) : 0;
      const safeIndex =
        Number.isFinite(parsed) && parsed >= 0 && parsed < QUESTIONS.length ? parsed : 0;
      setQuestionIndex(safeIndex);
    } catch {
      setQuestionIndex(0);
    }
  }, [code]);

  useEffect(() => {
    if (!currentQuestion) {
      // All questions answered; go to reveal.
      router.push(`/room/${code}/reveal`);
    }
  }, [currentQuestion, code, router]);

  useEffect(() => {
    if (!currentQuestion) return;

    let cancelled = false;

    async function loadRoomAndCounts() {
      setLoading(true);
      setError(null);

      try {
        const { data: foundRoom, error: roomError } = await supabase
          .from("rooms")
          .select("id, code")
          .eq("code", code)
          .maybeSingle();

        if (roomError) throw roomError;
        if (!foundRoom) {
          if (!cancelled) setError("Room not found.");
          return;
        }

        const [
          { count: playersCount, error: playersError },
          { count: answersCount, error: answersError },
        ] =
          await Promise.all([
            supabase
              .from("players")
              .select("id", { count: "exact", head: true })
              .eq("room_id", foundRoom.id),
            supabase
              .from("answers")
              .select("id", { count: "exact", head: true })
              .eq("room_id", foundRoom.id)
              .eq("question", currentQuestion.text),
          ]);

        if (playersError) throw playersError;
        if (answersError) throw answersError;

        if (!cancelled) {
          setRoom(foundRoom as RoomRow);
          setTotalPlayers(playersCount ?? 0);
          setAnsweredCount(answersCount ?? 0);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setError("Could not load room.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (code && code.length === 4) loadRoomAndCounts();
    else {
      setLoading(false);
      setError("Invalid room code.");
    }

    return () => {
      cancelled = true;
    };
  }, [code, currentQuestion]);

  useEffect(() => {
    if (!room || !currentQuestion || hasNavigatedToReveal) return;

    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled || hasNavigatedToReveal) return;

      try {
        const [
          { count: playersCount, error: playersError },
          { count: answersCount, error: answersError },
        ] = await Promise.all([
          supabase
            .from("players")
            .select("id", { count: "exact", head: true })
            .eq("room_id", room.id),
          supabase
            .from("answers")
            .select("id", { count: "exact", head: true })
            .eq("room_id", room.id)
            .eq("question", currentQuestion.text),
        ]);

        if (playersError || answersError) {
          // Ignore transient polling errors; main load already surfaces issues.
          return;
        }

        setTotalPlayers(playersCount ?? 0);
        setAnsweredCount(answersCount ?? 0);

        if (
          playersCount !== null &&
          answersCount !== null &&
          playersCount > 0 &&
          answersCount === playersCount
        ) {
          setHasNavigatedToReveal(true);
          router.push(`/room/${code}/reveal`);
        }
      } catch {
        // Ignore transient errors during polling.
      }
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [room, currentQuestion, hasNavigatedToReveal, code, router]);

  async function handleAnswer(answer: string) {
    if (!room || hasAnswered || !currentQuestion) return;

    setAnswering(answer);
    setError(null);

    try {
      const playerId = sessionStorage.getItem("som:player_id");
      if (!playerId) {
        setError("Player not found. Please rejoin the room.");
        return;
      }

      // Avoid duplicate answers from the same player for this question in this room.
      const { count: existingCount, error: existingError } = await supabase
        .from("answers")
        .select("id", { count: "exact", head: true })
        .eq("room_id", room.id)
        .eq("player_id", playerId)
        .eq("question", currentQuestion.text);

      if (existingError) throw existingError;
      if ((existingCount ?? 0) > 0) {
        // Player has already answered; mark as answered and refresh count once.
        const { count: answersCount, error: answersError } = await supabase
          .from("answers")
          .select("id", { count: "exact", head: true })
          .eq("room_id", room.id)
          .eq("question", currentQuestion.text);

        if (answersError) throw answersError;

        setHasAnswered(true);
        setAnsweredCount(answersCount ?? null);
        return;
      }

      const { error: insertError } = await supabase.from("answers").insert([
        {
          room_id: room.id,
          player_id: playerId,
          question: currentQuestion.text,
          answer,
        },
      ]);

      if (insertError) throw insertError;

      // After answering, refresh counts once for this question.
      const { count: answersCount, error: answersError } = await supabase
        .from("answers")
        .select("id", { count: "exact", head: true })
        .eq("room_id", room.id)
        .eq("question", currentQuestion.text);

      if (answersError) throw answersError;

      setHasAnswered(true);
      setAnsweredCount(answersCount ?? null);
    } catch (e) {
      console.error(e);
      setError("Could not submit your answer. Please try again.");
    } finally {
      setAnswering(null);
    }
  }

  const waitingText =
    hasAnswered && answeredCount !== null && totalPlayers !== null
      ? `${answeredCount} / ${totalPlayers} answered`
      : null;

  return (
    <main className="min-h-screen flex flex-col items-center p-6 text-white">
      <div className="w-full max-w-md">
        <header className="flex items-center justify-between mb-6">
          <div className="text-xs text-white/60">Room</div>
          <div className="ml-2 text-xl font-semibold tracking-widest">{code}</div>
        </header>

        <div className="rounded-3xl border border-white/20 bg-white/15 backdrop-blur-md p-5">
          {!hasAnswered ? (
            <>
              <h1 className="text-lg font-semibold mb-4 question-font">
                {currentQuestion?.text ?? "No question"}
              </h1>

              {loading && (
                <p className="text-sm text-white/60 mb-3">Loading room info...</p>
              )}

              {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

              <div className="space-y-3">
                {currentQuestion?.options.map((option, index) => (
                  <button
                    key={option}
                    className={`w-full question-font ${
                      index === 0 ? "btn-primary" : "btn-secondary"
                    } disabled:opacity-50`}
                    onClick={() => handleAnswer(option)}
                    disabled={loading || !!error || !room || !!answering || hasAnswered}
                  >
                    {answering === option ? "Sending..." : option}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-6">
              <p className="text-sm text-white/80">Waiting for other players...</p>
              {waitingText && (
                <p className="mt-2 text-sm text-white/60">{waitingText}</p>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 text-center">
          <Link
            href={`/room/${code}`}
            className="text-sm text-white/60 underline underline-offset-4"
          >
            Geri dön
          </Link>
        </div>
      </div>
    </main>
  );
}

