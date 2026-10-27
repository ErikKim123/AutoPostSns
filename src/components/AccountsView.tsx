// 계정 연결 — 토큰을 붙여 넣으면 그 토큰으로 접근할 수 있는 계정을 찾아 보여 주고, 고른 것만 연결한다.
// 토큰은 서버에만 저장되고 화면으로 다시 내려오지 않는다.
'use client';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { NetworkBadge } from './Badges';
import { Toast } from './Toast';
import { useAccounts, useConnectAccount, useDisconnectAccount, type AccountView } from '@/lib/client/api';
import { fmtDateTime } from '@/lib/client/dates';
import { NETWORKS, RULES, type Network } from '@/lib/networks/rules';

const HELP: Record<Network, { scopes: string; how: string; refresh?: boolean }> = {
  instagram: {
    scopes: 'instagram_basic, instagram_content_publish, pages_show_list, pages_read_engagement',
    how: 'Meta 개발자 Graph API 탐색기에서 앱을 고르고 위 권한으로 사용자 토큰을 만드세요. 인스타는 비즈니스·크리에이터 계정이어야 하고 Facebook 페이지에 연결돼 있어야 합니다.',
  },
  facebook: {
    scopes: 'pages_manage_posts, pages_read_engagement, pages_show_list',
    how: 'Graph API 탐색기에서 위 권한으로 사용자 토큰을 만들면, 관리 중인 페이지가 후보로 나옵니다. 페이지 토큰으로 저장됩니다.',
  },
  threads: {
    scopes: 'threads_basic, threads_content_publish',
    how: 'Threads 앱(Meta 개발자)에서 위 권한으로 사용자 토큰을 만드세요.',
  },
  x: {
    scopes: 'tweet.read, tweet.write, users.read, media.write, offline.access',
    how: 'X 개발자 포털의 OAuth 2.0 앱으로 받은 사용자 토큰과 refresh token 을 넣으세요. 토큰은 2시간이면 만료되므로 refresh token 이 있어야 예약이 계속 됩니다.',
    refresh: true,
  },
  tiktok: {
    scopes: 'user.info.basic, video.publish',
    how: 'TikTok 개발자 앱으로 받은 사용자 토큰과 refresh token 을 넣으세요. 심사 전 앱은 "나만 보기"로만 게시됩니다.',
    refresh: true,
  },
};

function AccountRow({ a, onRemove, busy }: { a: AccountView; onRemove: () => void; busy: boolean }) {
  const expiresSoon = a.tokenExpiresAt && new Date(a.tokenExpiresAt).getTime() < Date.now() + 7 * 86_400_000;
  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <NetworkBadge network={a.network} size="md" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            @{a.handle} <span className="font-normal text-muted">· {RULES[a.network].label}</span>
          </p>
          <p className="text-xs text-muted">
            {a.status === 'active' ? <span className="text-ok">연결됨</span> : <span className="text-danger">다시 연결 필요</span>}
            {a.tokenExpiresAt && <span className={clsx(expiresSoon && 'text-warn')}> · 토큰 만료 {fmtDateTime(a.tokenExpiresAt)}</span>}
            {a.openTargets > 0 && <span> · 대기 중인 예약 {a.openTargets}건</span>}
          </p>
          {a.lastError && a.status !== 'active' && <p className="text-xs text-danger">{a.lastError}</p>}
        </div>
      </div>
      <button type="button" disabled={busy} onClick={onRemove} className="self-start rounded-lg px-3 py-1.5 text-sm text-danger hover:bg-danger-soft sm:self-auto">
        연결 해제
      </button>
    </li>
  );
}

export function AccountsView() {
  const accounts = useAccounts();
  const connect = useConnectAccount();
  const disconnect = useDisconnectAccount();

  const [network, setNetwork] = useState<Network>('instagram');
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [candidates, setCandidates] = useState<{ externalId: string; handle: string }[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const help = HELP[network];

  function reset(n: Network) {
    setNetwork(n);
    setCandidates(null);
    setChosen(new Set());
    setError(null);
  }

  async function find() {
    setError(null);
    try {
      const r = await connect.mutateAsync({ network, accessToken, refreshToken: refreshToken || undefined });
      setCandidates(r.candidates ?? []);
      setChosen(new Set((r.candidates ?? []).map((c) => c.externalId)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '계정을 찾지 못했습니다.');
    }
  }

  async function link() {
    setError(null);
    try {
      await connect.mutateAsync({ network, accessToken, refreshToken: refreshToken || undefined, externalIds: [...chosen] });
      setToast(`${chosen.size}개 계정을 연결했습니다.`);
      setAccessToken('');
      setRefreshToken('');
      setCandidates(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '연결 실패');
    }
  }

  async function remove(a: AccountView) {
    const warn = a.openTargets > 0 ? `\n이 계정으로 대기 중인 예약 ${a.openTargets}건에서 이 계정이 빠집니다.` : '';
    if (!window.confirm(`@${a.handle} 연결을 해제합니다.${warn}`)) return;
    try {
      await disconnect.mutateAsync(a.id);
      setToast('연결을 해제했습니다.');
    } catch (err) {
      setToast(err instanceof Error ? err.message : '해제 실패');
    }
  }

  const list = accounts.data?.accounts ?? [];
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">계정 연결</h1>
        <p className="text-sm text-muted">게시할 SNS 계정을 연결합니다. 토큰은 서버에만 저장됩니다.</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-xs font-medium tracking-wide text-muted">연결된 계정 {list.length}개</h2>
        {accounts.error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{accounts.error.message}</p>}
        {list.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line bg-surface px-4 py-8 text-center text-sm text-muted">아직 연결된 계정이 없습니다. 아래에서 연결하세요.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {list.map((a) => (
              <AccountRow key={a.id} a={a} busy={disconnect.isPending} onRemove={() => remove(a)} />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold">새 계정 연결</h2>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="SNS">
          {NETWORKS.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={network === n}
              onClick={() => reset(n)}
              className={clsx('flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm', network === n ? 'border-accent bg-accent-soft' : 'border-line')}
            >
              <NetworkBadge network={n} size="md" />
              {RULES[n].label}
            </button>
          ))}
        </div>

        <div className="space-y-1 text-sm">
          <p className="text-muted">{help.how}</p>
          <p className="text-xs text-muted">
            필요한 권한: <code className="rounded bg-sunken px-1">{help.scopes}</code>
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="acc-token" className="text-xs font-medium text-muted">
              액세스 토큰
            </label>
            <textarea
              id="acc-token"
              value={accessToken}
              onChange={(e) => {
                setAccessToken(e.target.value);
                setCandidates(null);
              }}
              rows={3}
              spellCheck={false}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs outline-none focus:border-accent"
            />
          </div>
          {help.refresh && (
            <div className="space-y-1">
              <label htmlFor="acc-refresh" className="text-xs font-medium text-muted">
                Refresh token
              </label>
              <input
                id="acc-refresh"
                value={refreshToken}
                onChange={(e) => setRefreshToken(e.target.value)}
                spellCheck={false}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs outline-none focus:border-accent"
              />
            </div>
          )}
          {!candidates && (
            <button
              type="button"
              disabled={connect.isPending || accessToken.trim().length < 10}
              onClick={find}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-50"
            >
              {connect.isPending && <Loader2 className="animate-spin" size={14} />}이 토큰으로 계정 찾기
            </button>
          )}
        </div>

        {candidates && (
          <div className="space-y-3">
            <p className="text-sm">찾은 계정 {candidates.length}개 — 연결할 계정을 고르세요.</p>
            <ul className="space-y-1">
              {candidates.map((c) => (
                <li key={c.externalId}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={chosen.has(c.externalId)}
                      onChange={() =>
                        setChosen((s) => {
                          const n = new Set(s);
                          if (n.has(c.externalId)) n.delete(c.externalId);
                          else n.add(c.externalId);
                          return n;
                        })
                      }
                    />
                    <NetworkBadge network={network} />@{c.handle}
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button type="button" onClick={() => setCandidates(null)} className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-sunken">
                취소
              </button>
              <button
                type="button"
                disabled={connect.isPending || chosen.size === 0}
                onClick={link}
                className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-50"
              >
                {connect.isPending && <Loader2 className="animate-spin" size={14} />}
                {chosen.size}개 연결
              </button>
            </div>
          </div>
        )}
        {error && (
          <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </section>
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
