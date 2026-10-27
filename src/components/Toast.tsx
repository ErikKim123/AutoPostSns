// 결과 알림 — 몇 초 뒤 사라진다.
'use client';
import { useEffect, useRef } from 'react';

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  // 부모가 다시 그려져 onDone 이 새로 만들어져도 타이머가 처음부터 다시 돌지 않게 ref 로 들고 있는다.
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => done.current(), 4000);
    return () => clearTimeout(t);
  }, [message]);
  if (!message) return null;
  return (
    <div role="status" className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-50 -translate-x-1/2 rounded-lg bg-fg px-4 py-2 text-sm text-bg shadow-lg">
      {message}
    </div>
  );
}
