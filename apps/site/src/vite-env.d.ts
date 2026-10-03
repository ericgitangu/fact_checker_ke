/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of services/api, e.g. http://localhost:8080 (no trailing slash). */
  readonly VITE_API_URL: string;
  /** Public URL of apps/web, used to link out to pages that live there (e.g. /methodology). */
  readonly VITE_WEB_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
