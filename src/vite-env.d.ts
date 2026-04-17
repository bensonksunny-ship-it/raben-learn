/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string
  readonly VITE_FIREBASE_AUTH_DOMAIN: string
  readonly VITE_FIREBASE_PROJECT_ID: string
  readonly VITE_FIREBASE_STORAGE_BUCKET: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string
  readonly VITE_FIREBASE_APP_ID: string
  readonly VITE_FIREBASE_MEASUREMENT_ID: string
  readonly VITE_FIREBASE_FUNCTIONS_REGION: string
  /** Optional: force on/off same-origin `/__gcf__` proxy for Cloud Functions (default: auto from localhost + dev). */
  readonly VITE_USE_GCF_PROXY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
