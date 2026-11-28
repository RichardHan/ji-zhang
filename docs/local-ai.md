# 本機模型與 OpenRouter 模型選擇

這份文件說明 AI 來源的定案設計與使用方式。

## 預設行為（開箱免挑模型）

- **來源**：預設「自動」，順序為 **本機 LiteRT-LM（已下載時）→ 裝置內建 Gemini Nano → OpenRouter**。
- **OpenRouter**：文字與視覺模型預設都是「自動選免費」。App 會向 `https://openrouter.ai/api/v1/models` 取清單（快取 24 小時），篩出免費模型（價格為 0，或 ID 以 `:free` 結尾）；視覺模型另外要求 `input_modalities` 含 `image`。遇錯誤或限速（429）會改試下一個免費模型。
- **自行指定模型**（可選任何免費或付費模型）：文字與視覺分開挑選，清單顯示每百萬 token 價格並可篩選免費／付費。
- **付費模型失敗處理**：**絕不自動切換成另一個付費模型**，避免意外扣款。預設「失敗時改用免費自動模式」並跳出提示通知；這個開關可在設定裡關閉。

## 本機模型定案（目標裝置：Samsung Galaxy S26 Ultra）

1. **主要本機模型：LiteRT-LM + Gemma 4 E2B（預設）**
   - 檔案：`gemma-4-E2B-it.litertlm`（約 **2.59 GB**，來自 Hugging Face `litert-community/gemma-4-E2B-it-litert-lm`，Apache-2.0、免登入、支援斷點續傳）。
   - 理由：單一多模態模型可同時處理中文口語／打字記帳與收據／電子發票照片；Google 官方在 S26 Ultra 上實測 GPU 解碼約 52 tok/s（Prefill 3,808 tok/s），表現最均衡。GPU 初始化失敗時會自動改用 CPU。
2. **輕量備選模型：Qwen 3.5 0.8B VL（可選）**
   - 檔案：`Qwen3.5-0.8B-VL_int8.litertlm`（約 **1.30 GB**，來自 `litert-community/Qwen3.5-0.8B`）。
   - 理由：體積少一半且仍保留視覺能力，適合手機空間較吃緊時使用；缺點是台灣電子發票等細小字體的辨識力較 Gemma 4 E2B 弱。
3. **免下載系統備援：Gemini Nano（ML Kit GenAI Prompt API）**
   - S26 Ultra 在官方支援名單（`nano-v3`，含 `ImagePart` 圖片輸入）。
   - 只要系統 AICore 已備好 Nano，不需再下載 GB 級檔案就能離線使用（可在設定關閉；有前景與配額限制）。

## 下載管理

- 模型下載在 App 外部儲存區（`getExternalFilesDir/models`），**不會打進 APK**。
- 支援檢查手機剩餘空間（至少需模型大小 + 512 MB 緩衝）、預設僅在 Wi-Fi 下載、進度顯示、暫停／HTTP Range 續傳與刪除。首次推論也會建立與裝置相關的運算快取，可能額外占用數 GB；在設定刪除該模型時會一併清除。
