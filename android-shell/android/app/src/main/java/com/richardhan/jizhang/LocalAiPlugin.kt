package com.richardhan.jizhang

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Bridge for on-device text + vision inference.
 *
 * TODO: implement with LiteRT-LM Kotlin API:
 *   implementation("com.google.ai.edge.litertlm:litertlm-android:0.19.1")
 *   Engine(EngineConfig(
 *     modelPath = modelFile.absolutePath,
 *     backend = Backend.GPU(),          // fall back to Backend.CPU()
 *     visionBackend = Backend.GPU(),
 *   ))
 *   engine.initialize()
 *   engine.createConversation().sendMessage(...)
 * Model: Hugging Face litert-community/gemma-4-E2B-it-litert-lm
 * (gemma-4-E2B-it.litertlm, ~2.58 GB). Do not bundle it in the APK.
 */
@CapacitorPlugin(name = "LocalAi")
class LocalAiPlugin : Plugin() {
    companion object {
        const val MODEL_NAME = "Gemma 4 E2B（LiteRT-LM）"
        const val EXPECTED_BYTES = 2_580_000_000.0
        const val NOT_IMPLEMENTED =
            "本機模型推論尚未實作。下一步會用 LiteRT-LM 載入 Gemma 4 E2B，在手機上離線解析文字與收據照片。"
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val ret = JSObject()
        ret.put("available", false)
        ret.put(
            "reason",
            "本機模型尚未下載。預計使用 LiteRT-LM 與 Gemma 4 E2B（約 2.58 GB），可離線處理文字與收據照片。",
        )
        ret.put("backend", "")
        ret.put("modelName", MODEL_NAME)
        ret.put("modelPath", "")
        ret.put("downloadedBytes", 0)
        ret.put("totalBytes", EXPECTED_BYTES)
        call.resolve(ret)
    }

    @PluginMethod
    fun downloadModel(call: PluginCall) {
        // TODO: Download the .litertlm file to context.getExternalFilesDir(null),
        // honor call.getBoolean("wifiOnly", true), and resume with HTTP Range.
        call.reject("本機模型下載尚未實作。預計檔案約 2.58 GB，建議僅在 Wi-Fi 下載。")
    }

    @PluginMethod
    fun cancelDownload(call: PluginCall) {
        call.reject("本機模型下載尚未實作，沒有進行中的下載可取消。")
    }

    @PluginMethod
    fun deleteModel(call: PluginCall) {
        // TODO: Delete the downloaded .litertlm and release the Engine.
        call.reject("本機模型刪除尚未實作。")
    }

    @PluginMethod
    fun parseText(call: PluginCall) {
        // val prompt = call.getString("prompt") ?: ""
        // val today = call.getString("today") ?: ""
        call.reject(NOT_IMPLEMENTED)
    }

    @PluginMethod
    fun parseImage(call: PluginCall) {
        // val prompt = call.getString("prompt") ?: ""
        // val today = call.getString("today") ?: ""
        // val imageBase64 = call.getString("imageBase64") ?: ""
        // TODO: Decode JPEG/PNG, send Content.Text + Content.ImageBytes via Conversation.
        call.reject(NOT_IMPLEMENTED)
    }
}
