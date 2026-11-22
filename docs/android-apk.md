# 記帳 Android APK

這是一個薄薄的 Capacitor 套殼 App（程式碼在 `android-shell/`），用來開啟你自架的 ezBookkeeping / ji-zhang 伺服器手機版頁面。本身不含帳本資料，也不內建後端。

## 下載與安裝

1. 打開 GitHub repo 的 **Actions** 頁，點 **Android APK build**。
2. 選一次成功的 run（推送到 `main` 且有改到 `android-shell/**` 或這個 workflow 時會自動跑；也可以按 **Run workflow** 手動觸發）。
3. 在 run 頁面底部的 **Artifacts** 下載 `ji-zhang-debug-apk`（內含 `ji-zhang-debug-<版本>-<短 sha>.apk` 和 `SHA256SUMS.txt`）。Artifact 會保留 14 天。
4. 把 APK 傳到手機後開啟安裝。首次安裝需要允許「安裝未知來源的應用程式」。
5. 這個 APK 是 debug 簽章。只要之後的建置都用同一個穩定 debug key（repo secret `DEBUG_KEYSTORE_B64`），就可以直接覆蓋安裝、不用先解除安裝。

這個 repo 是公開的，Actions artifact 在保留期間任何人都能下載。目前不會發佈 GitHub Release。

## 設定伺服器網址

1. 打開「記帳」App。
2. 輸入你的伺服器網址，必須是 `http://` 或 `https://`，例如：
   - `https://example.com`
   - `http://192.168.1.10:8080`（區網 HTTP 可以使用）
   - 若服務裝在子路徑，把路徑一起填上，例如 `https://example.com/ez`
3. 點 **儲存並開啟**。App 會前往 `{網址}/mobile`。
4. 用你的帳號登入即可記帳。伺服器必須已經在運行。

之後若要改網址：

- 長按主畫面的「記帳」圖示，選 **變更伺服器**；或
- 如果連線失敗，App 會回到設定頁，可再改一次。

## 本機建置（可選）

需要 JDK 21 與 Android SDK。

```sh
cd android-shell
npm ci
npx cap sync android
cd android
./gradlew :app:assembleDebug
```

APK 位於 `android/app/build/outputs/apk/debug/app-debug.apk`。請不要把 keystore 提交進 repo。
