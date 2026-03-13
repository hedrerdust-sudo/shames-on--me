"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

export default function EndPage() {
  const params = useParams<{ code: string }>();
  const code = useMemo(() => (params?.code ?? "").toString().toUpperCase(), [params]);

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center p-6">
      <div className="w-full max-w-md">
        <header className="flex items-center justify-between mb-6">
          <div className="text-xs text-white/60">Room</div>
          <div className="ml-2 text-xl font-semibold tracking-widest">{code}</div>
        </header>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
          <h1 className="text-xl font-semibold text-white mb-2">Oyun bitti 🎉</h1>
          <p className="text-sm text-white/70">
            Tüm sorular cevaplandı. Yeni bir oyun başlatmak için ana sayfaya dönebilirsin.
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <Link
            href="/"
            className="w-full rounded-xl bg-white text-black py-3 text-center text-sm font-semibold"
          >
            Yeni oyun başlat
          </Link>
          <Link
            href={`/room/${code}`}
            className="w-full rounded-xl border border-white/20 py-3 text-center text-sm text-white/80"
          >
            Odaya geri dön
          </Link>
        </div>
      </div>
    </main>
  );
}

