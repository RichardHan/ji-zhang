# 本機模型與 OpenRouter 模型選擇

這份文件說明 AI 來源的設計，以及目前已完成與尚未完成的部分。

## 預設行為

打開 App 之後，不必先挑模型：

- **來源**預設是「自動」：本機模型就緒就優先用本機，否則改走 OpenRouter。
- **OpenRouter 文字模型與視覺模型**預設都是「自動選免費」。App 會向 `https://openrouter.ai/api/v1/models` 取清單（快取 24 小時），把免費模型（價格為 0，或 ID 以 `:free` 結尾）篩出來自動挑；視覺模型另外要求 `input_modalities` 含 `image`。遇到錯誤或速率限制會改試下一個免費模型。若清單暫時抓不到，會改用內建的免費模型名單。
- 自行指定模型是選擇性的覆寫，不是預設。可從完整清單挑任何免費或付費模型，文字與視覺分開，並顯示每百萬 token 價格與免費／付費篩選。

OpenRouter API 金鑰仍需要使用者自己在設定裡貼上，只存在這台裝置。

## 本機模型（開發中）

目標是在 Samsung Galaxy S26 Ultra 上離線解析口語／打字記帳，以及收據、電子發票照片。

建議的主要執行環境是 **LiteRT-LM**（`com.google.ai.edge.litertlm:litertlm-android`），模型先用 **Gemma 4 E2B**（約 2.58 GB，`.litertlm`，支援文字與圖片）。Google 官方基准包含 S26 Ultra 的 GPU／CPU 數據。模型必須由使用者下載，不要打進 APK。

備援方案是裝置上已有的 **Gemini Nano（ML Kit GenAI Prompt API）**：S26 Ultra 有支援，不必再下載數 GB 模型，但只限特定機型、API 仍是 beta，且有前景與配額限制。更長遠的備選是 llama.cpp 這類可跑較小 VLM（例如 SmolVLM、Qwen2.5-VL）的方案。

設定頁已有來源切換、僅 Wi-Fi 下載、儲存空間與下載／刪除按鈕；原生 Capacitor plugin（`LocalAi`）目前是方法簽名與 TODO，真正的下載與推論還沒接上。
