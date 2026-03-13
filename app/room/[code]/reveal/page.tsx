"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";
import { QUESTIONS } from "../../../../data/questions";

type RoomRow = { id: string | number; code: string };
type PlayerRow = { id: string | number; name: string };
type AnswerRow = { player_id: string | number; answer: string };
type RuleType = "majority" | "minority";
type OptionResult = { option: string; names: string[]; percent: number; count: number };

export default function RevealPage() {
  const params = useParams<{ code: string }>();
  const code = useMemo(() => (params?.code ?? "").toString().toUpperCase(), [params]);
  const router = useRouter();

  const [room, setRoom] = useState<RoomRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [optionResults, setOptionResults] = useState<OptionResult[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(5);
  const [rule, setRule] = useState<RuleType | null>(null);
  const [isRandomRule, setIsRandomRule] = useState(false);

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
      // If somehow there is no current question, go to final screen.
      router.push(`/room/${code}/end`);
    }
  }, [currentQuestion, code, router]);

  useEffect(() => {
    if (!currentQuestion) return;

    let cancelled = false;

    async function loadRevealData() {
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

        const [{ data: players, error: playersError }, { data: answers, error: answersError }] =
          await Promise.all([
            supabase
              .from("players")
              .select("id, name")
              .eq("room_id", foundRoom.id),
            supabase
              .from("answers")
              .select("player_id, answer")
              .eq("room_id", foundRoom.id)
              .eq("question", currentQuestion.text),
          ]);

        if (playersError) throw playersError;
        if (answersError) throw answersError;

        const playersById = new Map<string, string>();
        (players as PlayerRow[] | null)?.forEach((p) => {
          playersById.set(String(p.id), p.name);
        });

        const optionToNames = new Map<string, string[]>();
        (currentQuestion.options ?? []).forEach((opt) => {
          optionToNames.set(opt, []);
        });

        (answers as AnswerRow[] | null)?.forEach((a) => {
          const name = playersById.get(String(a.player_id));
          if (!name) return;
          const key = a.answer;
          if (!optionToNames.has(key)) return;
          optionToNames.get(key)!.push(name);
        });

        const allOptions = Array.from(optionToNames.keys());
        const counts = allOptions.map((opt) => optionToNames.get(opt)!.length);
        const totalAnswers = counts.reduce((sum, c) => sum + c, 0);

        const results: OptionResult[] = allOptions.map((opt, idx) => {
          const names = optionToNames.get(opt) ?? [];
          const count = names.length;
          const percent = totalAnswers ? Math.round((count / totalAnswers) * 100) : 0;
          return { option: opt, names: [...names], percent, count };
        });

        if (!cancelled) {
          setRoom(foundRoom as RoomRow);
          setOptionResults(results);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setError("Could not load results.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (code && code.length === 4) loadRevealData();
    else {
      setLoading(false);
      setError("Invalid room code.");
    }

    return () => {
      cancelled = true;
    };
  }, [code, currentQuestion]);

  useEffect(() => {
    if (!currentQuestion) return;

    try {
      const storedRule = sessionStorage.getItem(
        `som:rule:${code}:${String(currentQuestion.id)}`
      ) as RuleType | null;
      const storedRandom =
        sessionStorage.getItem(`som:rule_random:${code}:${String(currentQuestion.id)}`) ===
        "true";

      if (storedRule === "majority" || storedRule === "minority") {
        setRule(storedRule);
        setIsRandomRule(storedRandom);
        return;
      }

      const randomRule: RuleType = Math.random() < 0.5 ? "majority" : "minority";
      setRule(randomRule);
      setIsRandomRule(true);

      sessionStorage.setItem(
        `som:rule:${code}:${String(currentQuestion.id)}`,
        randomRule
      );
      sessionStorage.setItem(
        `som:rule_random:${code}:${String(currentQuestion.id)}`,
        "true"
      );
    } catch {
      // If session storage fails, fall back to a default rule.
      if (!rule) {
        setRule("majority");
        setIsRandomRule(false);
      }
    }
  }, [code, currentQuestion, rule]);

  useEffect(() => {
    if (loading || error || !room || !currentQuestion || !rule) return;

    setSecondsRemaining(5);

    const interval = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);

          const nextIndex = questionIndex + 1;
          if (nextIndex < QUESTIONS.length) {
            try {
              sessionStorage.setItem(`som:question_index:${code}`, String(nextIndex));
            } catch {
              // ignore
            }
            router.push(`/room/${code}/play`);
          } else {
            router.push(`/room/${code}/end`);
          }

          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [loading, error, room, currentQuestion, questionIndex, code, router]);

  const totalAnswers = optionResults.reduce((sum, r) => sum + r.count, 0);
  let majorityOption: string | null = null;
  let minorityOption: string | null = null;

  if (totalAnswers > 0 && optionResults.length > 0) {
    const counts = optionResults.map((r) => r.count);
    const max = Math.max(...counts);
    const min = Math.min(...counts);

    const maxOptions = optionResults.filter((r) => r.count === max);
    const minOptions = optionResults.filter((r) => r.count === min);

    majorityOption = maxOptions.length === 1 ? maxOptions[0].option : null;
    minorityOption = minOptions.length === 1 ? minOptions[0].option : null;
  }

  const drinkingOption =
    rule === "majority" ? majorityOption : rule === "minority" ? minorityOption : null;

  const ruleLabelTr =
    rule === "majority" ? "ÇOĞUNLUK İÇER!" : rule === "minority" ? "AZINLIK İÇER!" : "";

  return (
    <main className="min-h-screen flex flex-col items-center p-6 text-white">
      <div className="w-full max-w-md">
        <header className="flex items-center justify-between mb-6">
          <div className="text-xs text-white/60">Room</div>
          <div className="ml-2 text-xl font-semibold tracking-widest">{code}</div>
        </header>

        <div className="rounded-3xl border border-white/20 bg-white/15 backdrop-blur-md p-5">
          {!loading && !error && rule && (
            <div className="mb-4 flex justify-center">
              <div className="rule-pill rule-bounce-in">
                <span className="question-font text-xl sm:text-2xl font-extrabold tracking-[0.1em]">
                  {ruleLabelTr}
                </span>
              </div>
            </div>
          )}

          <h1 className="text-lg font-semibold mb-4 question-font">
            {currentQuestion?.text ?? "Question"}
          </h1>

          {loading && <p className="text-sm text-white/60 mb-3">Loading results...</p>}
          {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

          {!loading && !error && (
            <>
              <div className="space-y-6">
                {optionResults.map((result) => (
                  <section
                    key={result.option}
                    className={
                      drinkingOption === result.option
                        ? "rounded-2xl border border-white/60 bg-[#7ED957]/80 backdrop-blur-md shadow-lg -mx-1 px-4 py-3"
                        : "rounded-2xl border border-white/10 bg-black/20 px-4 py-3"
                    }
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h2 className="text-sm font-semibold question-font">
                        {result.option}
                      </h2>
                      <span className="text-sm text-white/80">{result.percent}%</span>
                    </div>
                    {result.names.length === 0 ? (
                      <p className="text-xs text-white/50">No one chose this.</p>
                    ) : (
                      <ul className="space-y-1 text-sm text-center">
                        {result.names.map((name) => (
                          <li key={`${result.option}-${name}`} className="name-tag">
                            {name}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ))}
              </div>

              <p className="mt-6 text-xs text-white/50 text-center">
                Next question in {secondsRemaining}...
              </p>
            </>
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

