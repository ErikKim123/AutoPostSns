// 캘린더 날짜 계산 — 브라우저 로컬 시간대 기준. 주는 월요일에 시작한다. 순수 함수(테스트: tests/dates.test.ts).

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
}

/** 그 주 월요일 0시. */
export function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  const offset = (day.getDay() + 6) % 7; // 월=0 … 일=6
  return addDays(day, -offset);
}

/** 월 보기 격자: 1일이 든 주의 월요일부터 6주(42칸). */
export function monthGrid(d: Date): Date[] {
  const first = startOfWeek(new Date(d.getFullYear(), d.getMonth(), 1));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

export type CalendarView = 'week' | 'month';

/** 화면에 보이는 기간 [from, to). */
export function visibleRange(view: CalendarView, anchor: Date): { from: Date; to: Date; days: Date[] } {
  if (view === 'week') {
    const from = startOfWeek(anchor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    return { from, to: addDays(from, 7), days };
  }
  const days = monthGrid(anchor);
  return { from: days[0]!, to: addDays(days[days.length - 1]!, 1), days };
}

export function shiftAnchor(view: CalendarView, anchor: Date, dir: -1 | 1): Date {
  return view === 'week' ? addDays(anchor, 7 * dir) : new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO → <input type="datetime-local"> 값(로컬). */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> 값(로컬) → ISO(UTC). 빈 값이면 null. */
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 새 게시물 기본 시각: 그날 10:00, 오늘이면 다음 정시(이미 늦은 밤이면 내일 10:00). */
export function defaultPublishAt(day: Date, now = new Date()): Date {
  if (!sameDay(day, now)) return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10, 0);
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0);
  return next.getHours() >= 23 || !sameDay(next, now) ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 10, 0) : next;
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function weekdayLabel(d: Date): string {
  return WEEKDAYS[d.getDay()]!;
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} (${weekdayLabel(d)}) ${fmtTime(iso)}`;
}

export function rangeLabel(view: CalendarView, anchor: Date): string {
  if (view === 'month') return `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월`;
  const from = startOfWeek(anchor);
  const to = addDays(from, 6);
  const head = `${from.getFullYear()}년 ${from.getMonth() + 1}월 ${from.getDate()}일`;
  const tail = from.getMonth() === to.getMonth() ? `${to.getDate()}일` : `${to.getMonth() + 1}월 ${to.getDate()}일`;
  return `${head} – ${tail}`;
}

/** 브라우저 시간대 이름(예: Asia/Seoul). */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
  } catch {
    return 'Asia/Seoul';
  }
}
