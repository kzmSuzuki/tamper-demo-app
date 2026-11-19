// GitHub Pages の公開時に Worker の HTTPS URL を指定します。
export const API_BASE_URL = location.hostname === '127.0.0.1'
  ? 'http://127.0.0.1:8787'
  : '';
