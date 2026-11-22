# 記帳 Android APK

從 2.0 起，這個 App 不再連到自架的 ezBookkeeping 伺服器。帳目寫進你自己的 Google 試算表，AI 記帳透過 [OpenRouter](https://openrouter.ai/) 的免費模型。畫面是 `app/` 裡的 Vue 網頁，由 `android-shell/` 的 Capacitor 包裝成 APK。應用程式 ID 仍是 `com.richardhan.jizhang`，可直接覆蓋安裝先前的版本。

ezBookkeeping 的原始碼還留在 repo 根目錄，只是當參考，App 執行時不會用到它。

## 下載與安裝

1. 打開 GitHub repo 的 **Actions** 頁，點 **Android APK build**。
2. 選一次成功的 run（推送到 `main` 且有改到 `app/**`、`android-shell/**` 或這個 workflow 時會自動跑；也可以按 **Run workflow** 手動觸發）。
3. 在 run 頁面底部的 **Artifacts** 下載 `ji-zhang-debug-apk`（內含 `ji-zhang-debug-<版本>-<短 sha>.apk` 和 `SHA256SUMS.txt`）。Artifact 會保留 14 天。
4. 把 APK 傳到手機後開啟安裝。首次安裝需要允許「安裝未知來源的應用程式」。
5. 這個 APK 是 debug 簽章。只要之後的建置都用同一個穩定 debug key（repo secret `DEBUG_KEYSTORE_B64`），就可以直接覆蓋安裝、不用先解除安裝。

這個 repo 是公開的，Actions artifact 在保留期間任何人都能下載。目前不會發佈 GitHub Release。

## 你需要自己完成的設定

App 與 CI 不會幫你建立 Google Cloud 專案，也不會幫你申請 OpenRouter 金鑰。請依序做完下面步驟，否則 Google 登入無法使用。

### 1. Google Cloud：專案與 API

1. 到 [Google Cloud Console](https://console.cloud.google.com/) 建立一個專案，或選用現有專案。
2. 開啟 [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com) 並按啟用。
3. 開啟 [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com) 並按啟用（建立試算表、以及 `drive.file` 範圍會用到）。

### 2. OAuth 同意畫面

1. 到 **Google Auth Platform → Branding / Data Access**（或 **APIs & Services → OAuth consent screen**）。
2. User Type 選 **外部**。
3. 填應用程式名稱（例如「記帳」）與你的 Gmail。
4. 在 **Data Access / Scopes** 加入：
   - `openid`、`email`、`profile`（基本資料）
   - `https://www.googleapis.com/auth/spreadsheets`（讀寫試算表）
   - `https://www.googleapis.com/auth/drive.file`（建立或開啟本 App 使用的檔案）
5. 發布狀態先維持 **測試中（Testing）**。把你自己的 Gmail 加到 **測試使用者**。在通過 Google 驗證之前，只有測試使用者能登入。

`spreadsheets` 屬於敏感範圍。測試模式給自己用沒問題；若以後要給其他人公開使用，需要送審。

### 3. 建立 OAuth 用戶端

到 **Clients / Credentials** 建立兩個用戶端：

**Web 應用程式**

- 類型選 Web application。
- 不需要先填重新導向 URI 也能拿到「用戶端 ID」（給 Capacitor 當 `webClientId` 用）。若你也想用瀏覽器開發，可把 `http://localhost:5173` 加到已授權的 JavaScript 來源。
- 複製這個 **Web 用戶端 ID**（結尾是 `.apps.googleusercontent.com`）。這就是要設進 GitHub 的值。
- 不要把「Android 用戶端 ID」填進 App，Credential Manager 一定要用 **Web** 用戶端 ID。

**Android**

- 類型選 Android。
- 套件名稱：`com.richardhan.jizhang`
- SHA-1 憑證指紋（目前這把穩定 debug 金鑰）：

  `1E:C9:81:11:85:40:41:A8:C3:AC:B7:35:5A:C3:30:1E:9C:B3:EE:E0`

- Android 用戶端只要登記在 Console，不必寫進程式或 repo variable。

SHA-1 是公開的憑證指紋，不是金鑰本身。若以後改用正式簽章，要再為那把 key 新增一個 Android 用戶端。

### 4. 把 Web 用戶端 ID 設到 GitHub

1. 打開 repo 的 **Settings → Secrets and variables → Actions → Variables**。
2. 新增變數，名稱必須是：

   `GOOGLE_WEB_CLIENT_ID`

3. 值貼上剛才複製的 **Web 用戶端 ID**。
4. 也可以改放在 Actions **secret**（同名 `GOOGLE_WEB_CLIENT_ID`）；workflow 會先讀 variable，沒有再讀 secret。
5. 設好後再跑一次 **Android APK build**，才會把這個 ID 編進 App。

如果沒有設定這個變數，CI 還是會成功產出 APK，但打開 App 時會看到「尚未設定 Google 登入」的說明，無法登入。

本機建置可在 `app/` 複製 `.env.example` 成 `.env`（或 `.env.production`）並填入同一個 ID；`.env` 已被 gitignore，請勿提交。

### 5. OpenRouter API 金鑰

1. 到 [openrouter.ai/keys](https://openrouter.ai/keys) 註冊並建立一把金鑰。
2. 安裝 App、完成 Google 登入並選好試算表後，打開 **設定**，把金鑰貼上並儲存。
3. 金鑰只存在這台手機（Capacitor Preferences），不會進 git，也不要傳給任何人。

預設模型是免費的 `google/gemma-4-26b-a4b-it:free`；若該模型忙碌或失敗，會自動改試 `inclusionai/ling-3.2-flash:free`。可在設定裡改模型。

## 第一次使用

1. 打開「記帳」。
2. 按「使用 Google 登入」，允許試算表權限。
3. 選擇「建立新的記帳試算表」（會在你的 Google Drive 建立 `ji-zhang 記帳`，工作表名稱是「交易」），或貼上已有試算表的連結。
4. 在設定裡貼上 OpenRouter 金鑰。
5. 在「記一筆」輸入例如「午餐 120 信用卡」，確認後寫入試算表；也可以改用手動表單。
6. 「月報」會依月份加總支出／收入，並依分類畫出長條圖，可選再用 AI 寫一段觀察。

欄位為：日期、金額、類別、帳戶/付款方式、備註、類型（支出/收入）、建立時間、id。你也可以直接在 Google 試算表裡查看或備份。

## 本機建置（可選）

需要 Node.js 20+、JDK 21 與 Android SDK。

```sh
cd app
# 可選：cp .env.example .env 並填入 VITE_GOOGLE_WEB_CLIENT_ID
npm ci
npm run build

cd ../android-shell
npm ci
npx cap sync android
cd android
./gradlew :app:assembleDebug
```

APK 位於 `android-shell/android/app/build/outputs/apk/debug/app-debug.apk`。請不要把 keystore 或 OpenRouter 金鑰提交進 repo。
