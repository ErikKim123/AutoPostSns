// 브라우저 → 서버 API 호출 + react-query 훅. DB 는 직접 만지지 않는다.
'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccountView } from '@/lib/accounts';
import type { Network } from '@/lib/networks/rules';
import type { PostView, SaveInput } from '@/lib/posts';
import { prepareImage } from '@/lib/client/image';
import { createClient } from '@/lib/supabase/client';
import { MEDIA_BUCKET } from '@/lib/supabase/cookie';

export type { AccountView, PostView, SaveInput };

/** 서버가 400 으로 돌려준 오류 — 작성 창이 네트워크별로 나눠 보여 준다. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public byNetwork: Partial<Record<Network, string[]>> = {},
  ) {
    super(message);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; byNetwork?: Partial<Record<Network, string[]>> };
  if (!res.ok) throw new ApiError(json.error ?? `요청 실패 (${res.status})`, res.status, json.byNetwork);
  return json;
}

export function usePosts(from: Date, to: Date) {
  return useQuery({
    queryKey: ['posts', from.toISOString(), to.toISOString()],
    queryFn: () =>
      call<{ posts: PostView[]; undated: PostView[] }>(
        `/api/posts?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
      ),
    // 발행 중인 게시물이 보이면 결과가 반영될 때까지 자주 다시 읽는다.
    refetchInterval: (q) => (q.state.data?.posts.some((p) => p.status === 'publishing') ? 5000 : 60_000),
  });
}

export function useTrash() {
  return useQuery({ queryKey: ['posts', 'trash'], queryFn: () => call<{ posts: PostView[] }>('/api/posts?view=trash') });
}

export function useAccounts() {
  return useQuery({ queryKey: ['accounts'], queryFn: () => call<{ accounts: AccountView[] }>('/api/accounts') });
}

export function useSavePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: SaveInput }) =>
      call<{ post: PostView }>(id ? `/api/posts/${id}` : '/api/posts', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(input) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['posts'] }),
  });
}

/** 휴지통·영구 삭제는 ok, 복원은 movedToDraft, 복제는 post 를 돌려준다. */
export interface PostActionResult {
  ok?: true;
  movedToDraft?: boolean;
  post?: PostView;
}

export function usePostAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'trash' | 'purge' | 'restore' | 'duplicate' }): Promise<PostActionResult> => {
      if (action === 'trash') return call(`/api/posts/${id}`, { method: 'DELETE' });
      if (action === 'purge') return call(`/api/posts/${id}?permanent=1`, { method: 'DELETE' });
      if (action === 'restore') return call(`/api/posts/${id}/restore`, { method: 'POST' });
      return call(`/api/posts/${id}/duplicate`, { method: 'POST' });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['posts'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}

export function useConnectAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { network: Network; accessToken: string; refreshToken?: string; externalIds?: string[] }) =>
      call<{ candidates?: { externalId: string; handle: string }[]; accounts?: AccountView[] }>('/api/accounts', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (r) => {
      if (r.accounts) qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}

export function useDisconnectAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => call<{ ok: true }>(`/api/accounts/${id}`, { method: 'DELETE' }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['posts'] });
    },
  });
}

/** 파일들을 스토리지에 직접 올리고 공개 URL 을 돌려준다(서명 URL 은 서버가 발급). 이미지는 먼저 JPEG 로 정리. */
export async function uploadFiles(picked: File[]): Promise<{ url: string; kind: 'image' | 'video' }[]> {
  const files = await Promise.all(picked.map(prepareImage));
  const { uploads } = await call<{ uploads: { path: string; token: string; publicUrl: string; kind: 'image' | 'video' }[] }>(
    '/api/media/upload-url',
    { method: 'POST', body: JSON.stringify({ files: files.map((f) => ({ name: f.name, type: f.type, size: f.size })) }) },
  );
  const storage = createClient().storage.from(MEDIA_BUCKET);
  const out: { url: string; kind: 'image' | 'video' }[] = [];
  for (let i = 0; i < uploads.length; i++) {
    const u = uploads[i]!;
    const { error } = await storage.uploadToSignedUrl(u.path, u.token, files[i]!, { contentType: files[i]!.type });
    if (error) throw new ApiError(`${files[i]!.name} 업로드 실패: ${error.message}`, 500);
    out.push({ url: u.publicUrl, kind: u.kind });
  }
  return out;
}
