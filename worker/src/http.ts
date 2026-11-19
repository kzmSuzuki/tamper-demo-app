export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function invalid(message = '入力内容を確認してください。'): never {
  throw new ApiError(400, 'INVALID_INPUT', message);
}

export function missing(): never {
  throw new ApiError(404, 'ROOM_NOT_FOUND', '授業ルームが見つかりません。コードを確認してください。');
}

export function closed(): never {
  throw new ApiError(409, 'ROOM_CLOSED', 'この授業ルームは投稿受付を終了しました。');
}

export async function readJson(request: Request, allowed: string[]): Promise<Record<string, unknown>> {
  const maxBytes = 2048;
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
      || !request.body) invalid('JSON形式で送信してください。');
  if (Number(request.headers.get('Content-Length')) > maxBytes) invalid('送信データが大きすぎます。');

  const reader = request.body.getReader();
  const bytes = new Uint8Array(maxBytes);
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (length + value.byteLength > maxBytes) {
        void reader.cancel().catch(() => undefined);
        invalid('送信データが大きすぎます。');
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    invalid('送信データを読み取れませんでした。');
  } finally {
    reader.releaseLock();
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes.subarray(0, length)));
  } catch {
    invalid('JSONの形式を確認してください。');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !allowed.includes(key))) invalid();
  return body as Record<string, unknown>;
}

const unsafeControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;

export function checkedText(value: unknown, min: number, max: number, label: string, multiline = false) {
  if (typeof value !== 'string' || !value.isWellFormed() || unsafeControls.test(value)
      || (!multiline && /[\r\n\t\u2028\u2029]/u.test(value))) invalid(`${label}に使えない文字が含まれています。`);
  const text = value.trim();
  const length = Array.from(text).length;
  if (length < min || length > max) invalid(`${label}は${min}〜${max}文字で入力してください。`);
  return text;
}

export function optionalBoolean(body: Record<string, unknown>, key: string) {
  if (!Object.hasOwn(body, key)) return undefined;
  const value = body[key];
  if (typeof value !== 'boolean') invalid();
  return value;
}

export function optionalProbability(body: Record<string, unknown>) {
  if (!Object.hasOwn(body, 'tamperProbability')) return undefined;
  const value = body.tamperProbability;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) invalid();
  return value;
}

export function uuid(value: unknown) {
  if (typeof value !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)) invalid();
  return value.toLowerCase();
}

const encoder = new TextEncoder();
const digest = (text: string) => crypto.subtle.digest('SHA-256', encoder.encode(text));

export async function sha256(text: string) {
  return Array.from(new Uint8Array(await digest(text)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function authorize(request: Request, secret?: string) {
  const header = request.headers.get('Authorization');
  const token = header && header.length <= 520 ? /^Bearer ([\x21-\x7e]+)$/i.exec(header)?.[1] : undefined;
  if (secret && secret.length >= 32 && token) {
    const [expected, actual] = await Promise.all([digest(secret), digest(token)]);
    if (typeof crypto.subtle.timingSafeEqual === 'function') {
      if (crypto.subtle.timingSafeEqual(expected, actual)) return;
    } else if (equalDigests(expected, actual)) {
      return;
    }
  }
  throw new ApiError(401, 'ADMIN_UNAUTHORIZED', '教員トークンを確認してください。');
}

// Used by the Node test runtime, which lacks the Workers Web Crypto extension.
function equalDigests(expected: ArrayBuffer, actual: ArrayBuffer) {
  const a = new Uint8Array(expected);
  const b = new Uint8Array(actual);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
