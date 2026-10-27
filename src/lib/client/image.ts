// 업로드 전 이미지 정리 — 인스타그램 Graph API 는 이미지로 JPEG 만 받는다.
// PNG·WEBP 는 JPEG 로 바꾸고(투명 부분은 흰 바탕), 긴 변을 2048px 로 줄인다. GIF 는 X 용 움짤이라 그대로 둔다.
'use client';

const MAX_SIDE = 2048;
const QUALITY = 0.9;

export async function prepareImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  // 이미 충분히 작은 JPEG 는 다시 압축하지 않는다(화질 손실 방지).
  if (file.type === 'image/jpeg' && scale === 1) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', QUALITY));
  if (!blob) throw new Error(`${file.name}: 이미지를 JPEG 로 바꾸지 못했습니다.`);
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}
