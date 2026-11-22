# android-shell

Capacitor Android 包裝，用來把 `app/` 裡的 Vue 記帳介面打成 APK。`webDir` 指向 `../app/dist`，請先在 `app/` 執行 `npm ci && npm run build`，再在這裡執行 `npx cap sync android`。

應用程式 ID 仍是 `com.richardhan.jizhang`，可覆蓋安裝先前的版本。說明見 `docs/android-apk.md`。
