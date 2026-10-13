/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OXEN_REMOTE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
