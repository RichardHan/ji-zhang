# app/

ji-zhang 的 Vue 3 + Vite + TypeScript 介面。資料寫入使用者自己的 Google 試算表，AI 解析使用 OpenRouter。由 `android-shell/` 打包成 Android APK。

```sh
npm ci
# 可選：cp .env.example .env 並填入 VITE_GOOGLE_WEB_CLIENT_ID
npm run dev     # 瀏覽器預覽（Google 原生登入需在 APK 上測試）
npm run build
```

設定與 OAuth 步驟見 [`docs/android-apk.md`](../docs/android-apk.md)。
