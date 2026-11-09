/// <reference types="vite/client" />

/** Actions 実行時にビルドへ注入される GITHUB_REPOSITORY（例: "owner/repo"）。 */
declare const __GITHUB_REPOSITORY__: string;

interface ImportMetaEnv {
  readonly VITE_GITHUB_OWNER?: string;
  readonly VITE_GITHUB_REPO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
