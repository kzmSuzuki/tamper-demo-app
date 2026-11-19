import { API_BASE_URL } from './config.js';

export class ApiError extends Error {
  constructor(message, status = 0, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = 'GET', body, token, signal } = {}) {
  if (!API_BASE_URL) throw new ApiError('接続先が設定されていません。教員に連絡してください。');
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    const timeout = AbortSignal.timeout(15_000);
    response = await fetch(`${API_BASE_URL.replace(/\/$/, '')}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit', cache: 'no-store', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    throw new ApiError('通信できませんでした。接続を確認し、もう一度お試しください。');
  }
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    throw new ApiError(payload?.error?.message || '現在サービスを利用できません。少し時間をおいてお試しください。',
      response.status, payload?.error?.code);
  }
  return payload;
}
