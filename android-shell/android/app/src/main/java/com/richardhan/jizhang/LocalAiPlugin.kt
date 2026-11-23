package com.richardhan.jizhang

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.StatFs
import android.util.Base64
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.SamplerConfig
import com.google.ai.edge.litertlm.ThinkingConfig
import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.ImagePart
import com.google.mlkit.genai.prompt.SystemInstruction
import com.google.mlkit.genai.prompt.TextPart
import com.google.mlkit.genai.prompt.generateContentRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean

/**
 * On-device text + vision inference bridge:
 * 1) LiteRT-LM (.litertlm models downloaded outside the APK; GPU with CPU fallback)
 * 2) Gemini Nano via ML Kit GenAI Prompt API (zero-download system fallback on supported phones)
 */
@CapacitorPlugin(name = "LocalAi")
class LocalAiPlugin : Plugin() {

    private data class ModelSpec(
        val id: String,
        val name: String,
        val fileName: String,
        val url: String,
        val expectedBytes: Long,
    )

    companion object {
        private const val TAG = "LocalAiPlugin"
        private const val STORAGE_BUFFER_BYTES = 512L * 1024L * 1024L
        private const val DEFAULT_MODEL_ID = "gemma-4-e2b"

        private val MODELS = listOf(
            ModelSpec(
                id = "gemma-4-e2b",
                name = "Gemma 4 E2B（預設，中文與收據較準）",
                fileName = "gemma-4-E2B-it.litertlm",
                url = "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm",
                expectedBytes = 2_588_147_712L,
            ),
            ModelSpec(
                id = "qwen3.5-0.8b-vl",
                name = "Qwen 3.5 0.8B VL（輕量備選，省空間）",
                fileName = "Qwen3.5-0.8B-VL_int8.litertlm",
                url = "https://huggingface.co/litert-community/Qwen3.5-0.8B/resolve/main/Qwen3.5-0.8B-VL_int8.litertlm",
                expectedBytes = 1_303_724_032L,
            ),
        )

        private fun specFor(id: String?): ModelSpec =
            MODELS.firstOrNull { it.id == id } ?: MODELS.first { it.id == DEFAULT_MODEL_ID }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val engineMutex = Mutex()
    private val downloadMutex = Mutex()
    private val downloadActive = AtomicBoolean(false)
    private val cancelRequested = AtomicBoolean(false)

    @Volatile private var downloadingModelId: String? = null
    @Volatile private var downloadedBytesLive: Long = 0L
    @Volatile private var totalBytesLive: Long = 0L

    private var activeEngine: Engine? = null
    private var activeModelPath: String? = null
    private var activeBackend: String = ""

    private fun modelsDir(): File {
        val base = context.getExternalFilesDir(null) ?: context.filesDir
        val dir = File(base, "models")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    private fun modelFile(spec: ModelSpec): File = File(modelsDir(), spec.fileName)
    private fun partFile(spec: ModelSpec): File = File(modelsDir(), "${spec.fileName}.part")

    private fun freeStorageBytes(): Long {
        return try {
            val stat = StatFs(modelsDir().absolutePath)
            stat.availableBytes
        } catch (_: Throwable) {
            0L
        }
    }

    private fun isOnWifi(): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val network = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(network) ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    }

    private suspend fun queryNanoStatus(): Pair<String, String> {
        return try {
            val client = Generation.getClient()
            val status = client.checkStatus()
            val label = when (status) {
                FeatureStatus.AVAILABLE -> "available"
                FeatureStatus.DOWNLOADABLE -> "downloadable"
                FeatureStatus.DOWNLOADING -> "downloading"
                else -> "unavailable"
            }
            val baseName = if (status == FeatureStatus.AVAILABLE) {
                try {
                    client.getBaseModelName()
                } catch (_: Throwable) {
                    "gemini-nano"
                }
            } else {
                ""
            }
            label to baseName
        } catch (t: Throwable) {
            Log.d(TAG, "Gemini Nano unavailable: ${t.message}")
            "unavailable" to ""
        }
    }

    private fun closeEngineLocked() {
        try {
            activeEngine?.close()
        } catch (_: Throwable) {
        }
        activeEngine = null
        activeModelPath = null
        activeBackend = ""
    }

    private fun ensureEngineLocked(spec: ModelSpec): Engine {
        val file = modelFile(spec)
        if (!file.exists() || file.length() <= 0L) {
            throw IllegalStateException("尚未下載本機模型「${spec.name}」，請先到設定下載。")
        }
        val path = file.absolutePath
        val existing = activeEngine
        if (existing != null && activeModelPath == path && existing.isInitialized) {
            return existing
        }
        closeEngineLocked()

        val cachePath = File(context.cacheDir, "litert-lm").apply { mkdirs() }.absolutePath
        val candidates = listOf(
            "GPU" to Backend.GPU(),
            "CPU" to Backend.CPU(),
        )
        var lastError: Throwable? = null
        for ((label, backend) in candidates) {
            try {
                val config = EngineConfig(
                    modelPath = path,
                    backend = backend,
                    visionBackend = backend,
                    maxNumImages = 1,
                    cacheDir = cachePath,
                )
                val engine = Engine(config)
                engine.initialize()
                activeEngine = engine
                activeModelPath = path
                activeBackend = label
                Log.i(TAG, "LiteRT-LM initialized ($label) for ${spec.id}")
                return engine
            } catch (t: Throwable) {
                Log.w(TAG, "LiteRT-LM $label init failed: ${t.message}", t)
                lastError = t
            }
        }
        throw IllegalStateException(
            "無法啟動本機模型（${lastError?.message ?: "未知錯誤"}）。請確認儲存空間與檔案完整性。",
            lastError,
        )
    }

    private fun extractMessageText(message: Message): String {
        val parts = message.contents.contents.filterIsInstance<Content.Text>()
        val joined = parts.joinToString("") { it.text }.trim()
        return joined.ifEmpty { message.contents.toString().trim() }
    }

    private fun openWithRedirects(urlStr: String, rangeStart: Long): HttpURLConnection {
        var currentUrl = urlStr
        repeat(8) {
            val conn = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 20_000
                readTimeout = 60_000
                setRequestProperty("User-Agent", "ji-zhang-android/2.0")
                if (rangeStart > 0L) {
                    setRequestProperty("Range", "bytes=$rangeStart-")
                }
            }
            val code = conn.responseCode
            if (code in listOf(301, 302, 303, 307, 308)) {
                val location = conn.getHeaderField("Location")
                conn.disconnect()
                if (location.isNullOrBlank()) {
                    throw IllegalStateException("下載重新導向缺少 Location（HTTP $code）")
                }
                currentUrl = URL(URL(currentUrl), location).toString()
            } else {
                return conn
            }
        }
        throw IllegalStateException("下載重新導向次數過多")
    }

    private fun emitProgress(spec: ModelSpec, downloaded: Long, total: Long, state: String) {
        val payload = JSObject().apply {
            put("modelId", spec.id)
            put("downloadedBytes", downloaded.toDouble())
            put("totalBytes", total.toDouble())
            put("progress", if (total > 0L) downloaded.toDouble() / total.toDouble() else 0.0)
            put("state", state)
        }
        notifyListeners("localDownloadProgress", payload)
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val spec = specFor(call.getString("modelId"))
        scope.launch {
            val finalFile = modelFile(spec)
            val part = partFile(spec)
            val isDownloadingThis = downloadActive.get() && downloadingModelId == spec.id
            val available = !isDownloadingThis && finalFile.exists() && finalFile.length() > 0L
            val downloaded = when {
                isDownloadingThis -> downloadedBytesLive
                available -> finalFile.length()
                part.exists() -> part.length()
                else -> 0L
            }
            val total = when {
                isDownloadingThis && totalBytesLive > 0L -> totalBytesLive
                available -> finalFile.length()
                else -> spec.expectedBytes
            }
            val freeBytes = freeStorageBytes()
            val (nanoStatus, nanoModelName) = queryNanoStatus()

            val reason = when {
                isDownloadingThis -> "正在下載 ${spec.name}…"
                available -> "已下載，可離線使用（${if (activeBackend.isNotEmpty()) activeBackend else "LiteRT-LM"}）"
                part.exists() && part.length() > 0L -> "上次下載尚未完成，可從中斷處續傳。"
                nanoStatus == "available" -> "本機大模型尚未下載；自動模式可先用內建 Gemini Nano。"
                else -> "尚未下載，下載後即可離線解析文字與收據照片。"
            }

            val ret = JSObject().apply {
                put("available", available)
                put("downloading", isDownloadingThis)
                put("downloadProgress", if (total > 0L) downloaded.toDouble() / total.toDouble() else 0.0)
                put("reason", reason)
                put("backend", if (activeModelPath == finalFile.absolutePath) activeBackend else "")
                put("modelId", spec.id)
                put("modelName", spec.name)
                put("modelPath", if (available) finalFile.absolutePath else "")
                put("downloadedBytes", downloaded.toDouble())
                put("totalBytes", total.toDouble())
                put("freeStorageBytes", freeBytes.toDouble())
                put("nanoStatus", nanoStatus)
                put("nanoModelName", nanoModelName)
            }
            call.resolve(ret)
        }
    }

    @PluginMethod
    fun downloadModel(call: PluginCall) {
        val spec = specFor(call.getString("modelId"))
        val wifiOnly = call.getBoolean("wifiOnly", true) ?: true

        if (wifiOnly && !isOnWifi()) {
            call.reject("目前不是 Wi-Fi 連線（已設定僅在 Wi-Fi 下載）。請連上 Wi-Fi 或取消勾選後再試。")
            return
        }

        scope.launch {
            if (!downloadMutex.tryLock()) {
                call.reject("已有下載正在進行中，請稍候或先取消。")
                return@launch
            }
            var conn: HttpURLConnection? = null
            try {
                val finalFile = modelFile(spec)
                if (finalFile.exists() && finalFile.length() > 0L) {
                    call.resolve()
                    return@launch
                }

                val part = partFile(spec)
                val existingBytes = if (part.exists()) part.length() else 0L
                val remaining = (spec.expectedBytes - existingBytes).coerceAtLeast(0L)
                val free = freeStorageBytes()
                if (free > 0L && free < remaining + STORAGE_BUFFER_BYTES) {
                    val needGb = String.format("%.2f", (remaining + STORAGE_BUFFER_BYTES) / 1e9)
                    val freeGb = String.format("%.2f", free / 1e9)
                    call.reject("手機儲存空間不足（剩餘 $freeGb GB，需要約 $needGb GB）。")
                    return@launch
                }

                cancelRequested.set(false)
                downloadActive.set(true)
                downloadingModelId = spec.id
                downloadedBytesLive = existingBytes
                totalBytesLive = spec.expectedBytes
                emitProgress(spec, existingBytes, spec.expectedBytes, "downloading")

                conn = openWithRedirects(spec.url, existingBytes)
                val code = conn.responseCode
                if (code !in listOf(HttpURLConnection.HTTP_OK, HttpURLConnection.HTTP_PARTIAL)) {
                    throw IllegalStateException("伺服器回應錯誤（HTTP $code）")
                }

                val append = code == HttpURLConnection.HTTP_PARTIAL && existingBytes > 0L
                var currentBytes = if (append) existingBytes else 0L
                val contentLength = conn.contentLengthLong
                val totalBytes = when {
                    append && contentLength > 0L -> existingBytes + contentLength
                    contentLength > 0L -> contentLength
                    else -> spec.expectedBytes
                }
                totalBytesLive = totalBytes
                downloadedBytesLive = currentBytes

                conn.inputStream.use { input ->
                    FileOutputStream(part, append).use { output ->
                        val buffer = ByteArray(256 * 1024)
                        var lastEmitMs = System.currentTimeMillis()
                        while (true) {
                            if (cancelRequested.get()) {
                                throw InterruptedException("已取消下載（進度已保留，之後可續傳）。")
                            }
                            val read = input.read(buffer)
                            if (read == -1) break
                            output.write(buffer, 0, read)
                            currentBytes += read
                            downloadedBytesLive = currentBytes
                            val now = System.currentTimeMillis()
                            if (now - lastEmitMs >= 300L) {
                                lastEmitMs = now
                                emitProgress(spec, currentBytes, totalBytes, "downloading")
                            }
                        }
                        output.flush()
                    }
                }

                if (contentLength > 0L && part.length() != totalBytes) {
                    throw IllegalStateException("下載檔案大小不完整（收到 ${part.length()} / $totalBytes bytes），請再試一次。")
                }
                if (finalFile.exists()) finalFile.delete()
                if (!part.renameTo(finalFile)) {
                    throw IllegalStateException("無法搬移下載完成的模型檔案。")
                }
                emitProgress(spec, finalFile.length(), finalFile.length(), "completed")
                call.resolve()
            } catch (t: Throwable) {
                Log.w(TAG, "Model download stopped: ${t.message}", t)
                emitProgress(spec, downloadedBytesLive, totalBytesLive, "failed")
                call.reject(t.message ?: "模型下載失敗")
            } finally {
                try {
                    conn?.disconnect()
                } catch (_: Throwable) {
                }
                downloadActive.set(false)
                downloadingModelId = null
                downloadMutex.unlock()
            }
        }
    }

    @PluginMethod
    fun cancelDownload(call: PluginCall) {
        cancelRequested.set(true)
        call.resolve()
    }

    @PluginMethod
    fun deleteModel(call: PluginCall) {
        val spec = specFor(call.getString("modelId"))
        if (downloadActive.get() && downloadingModelId == spec.id) {
            cancelRequested.set(true)
        }
        scope.launch {
            engineMutex.withLock {
                val target = modelFile(spec)
                if (activeModelPath == target.absolutePath) {
                    closeEngineLocked()
                }
                target.delete()
                partFile(spec).delete()
            }
            call.resolve()
        }
    }

    @PluginMethod
    fun downloadNano(call: PluginCall) {
        scope.launch {
            try {
                val client = Generation.getClient()
                var failedMsg: String? = null
                client.download().collect { status ->
                    when (status) {
                        is DownloadStatus.DownloadStarted -> {
                            notifyListeners(
                                "nanoDownloadProgress",
                                JSObject().apply {
                                    put("state", "downloading")
                                    put("bytes", 0)
                                    put("totalBytes", status.bytesToDownload.toDouble())
                                },
                            )
                        }
                        is DownloadStatus.DownloadProgress -> {
                            notifyListeners(
                                "nanoDownloadProgress",
                                JSObject().apply {
                                    put("state", "downloading")
                                    put("bytes", status.totalBytesDownloaded.toDouble())
                                },
                            )
                        }
                        DownloadStatus.DownloadCompleted -> {
                            notifyListeners(
                                "nanoDownloadProgress",
                                JSObject().apply { put("state", "completed") },
                            )
                        }
                        is DownloadStatus.DownloadFailed -> {
                            failedMsg = status.e.message ?: "Gemini Nano 下載失敗"
                        }
                    }
                }
                if (failedMsg != null) {
                    call.reject(failedMsg)
                } else {
                    call.resolve()
                }
            } catch (t: Throwable) {
                call.reject(t.message ?: "無法下載 Gemini Nano")
            }
        }
    }

    @PluginMethod
    fun parseText(call: PluginCall) {
        val prompt = call.getString("prompt")?.trim().orEmpty()
        val systemPrompt = call.getString("systemPrompt")?.trim().orEmpty()
        val runtime = call.getString("runtime") ?: "litert"
        val spec = specFor(call.getString("modelId"))
        if (prompt.isEmpty()) {
            call.reject("請輸入要解析的內容。")
            return
        }

        scope.launch {
            try {
                if (runtime == "nano") {
                    val client = Generation.getClient()
                    val status = client.checkStatus()
                    if (status != FeatureStatus.AVAILABLE) {
                        call.reject("裝置上的 Gemini Nano 尚未就緒（狀態碼 $status）。")
                        return@launch
                    }
                    val req = generateContentRequest(
                        SystemInstruction(systemPrompt),
                        TextPart(prompt),
                    ) {
                        temperature = 0.2f
                        maxOutputTokens = 1024
                    }
                    val res = client.generateContent(req)
                    val out = res.candidates.firstOrNull()?.text?.trim().orEmpty()
                    if (out.isEmpty()) throw IllegalStateException("Gemini Nano 回傳空白內容。")
                    call.resolve(
                        JSObject().apply {
                            put("text", out)
                            put("modelUsed", "gemini-nano")
                            put("runtime", "nano")
                        },
                    )
                    return@launch
                }

                val out = engineMutex.withLock {
                    val engine = ensureEngineLocked(spec)
                    val convConfig = ConversationConfig(
                        systemInstruction = if (systemPrompt.isNotEmpty()) Contents.of(systemPrompt) else null,
                        samplerConfig = SamplerConfig(topK = 40, topP = 0.95, temperature = 0.2, seed = 42),
                        thinkingConfig = ThinkingConfig(enableThinking = false),
                    )
                    engine.createConversation(convConfig).use { conversation ->
                        val response = conversation.sendMessage(Contents.of(Content.Text(prompt)))
                        extractMessageText(response)
                    }
                }
                if (out.isEmpty()) throw IllegalStateException("本機模型回傳空白內容。")
                call.resolve(
                    JSObject().apply {
                        put("text", out)
                        put("modelUsed", "${spec.id} ($activeBackend)")
                        put("runtime", "litert")
                    },
                )
            } catch (t: Throwable) {
                Log.w(TAG, "parseText ($runtime) failed: ${t.message}", t)
                call.reject(t.message ?: "本機文字解析失敗")
            }
        }
    }

    @PluginMethod
    fun parseImage(call: PluginCall) {
        val prompt = call.getString("prompt")?.trim().orEmpty().ifEmpty { "請解析這張收據或電子發票。" }
        val systemPrompt = call.getString("systemPrompt")?.trim().orEmpty()
        val imageBase64 = call.getString("imageBase64")?.trim().orEmpty()
        val runtime = call.getString("runtime") ?: "litert"
        val spec = specFor(call.getString("modelId"))
        if (imageBase64.isEmpty()) {
            call.reject("缺少圖片內容。")
            return
        }

        scope.launch {
            try {
                val bytes = Base64.decode(imageBase64, Base64.DEFAULT)
                val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    ?: throw IllegalArgumentException("無法解碼這張照片。")

                if (runtime == "nano") {
                    try {
                        val client = Generation.getClient()
                        val status = client.checkStatus()
                        if (status != FeatureStatus.AVAILABLE) {
                            call.reject("裝置上的 Gemini Nano 尚未就緒（狀態碼 $status）。")
                            return@launch
                        }
                        val req = generateContentRequest(
                            SystemInstruction(systemPrompt),
                            ImagePart(bitmap),
                            TextPart(prompt),
                        ) {
                            temperature = 0.2f
                            maxOutputTokens = 1024
                        }
                        val res = client.generateContent(req)
                        val out = res.candidates.firstOrNull()?.text?.trim().orEmpty()
                        if (out.isEmpty()) throw IllegalStateException("Gemini Nano 回傳空白內容。")
                        call.resolve(
                            JSObject().apply {
                                put("text", out)
                                put("modelUsed", "gemini-nano")
                                put("runtime", "nano")
                            },
                        )
                    } finally {
                        bitmap.recycle()
                    }
                    return@launch
                }

                val tmpFile = File.createTempFile("receipt_", ".jpg", context.cacheDir)
                try {
                    FileOutputStream(tmpFile).use { fos ->
                        bitmap.compress(Bitmap.CompressFormat.JPEG, 90, fos)
                    }
                    bitmap.recycle()

                    val out = engineMutex.withLock {
                        val engine = ensureEngineLocked(spec)
                        val convConfig = ConversationConfig(
                            systemInstruction = if (systemPrompt.isNotEmpty()) Contents.of(systemPrompt) else null,
                            samplerConfig = SamplerConfig(topK = 40, topP = 0.95, temperature = 0.2, seed = 42),
                            thinkingConfig = ThinkingConfig(enableThinking = false),
                        )
                        engine.createConversation(convConfig).use { conversation ->
                            val response = conversation.sendMessage(
                                Contents.of(
                                    Content.ImageFile(tmpFile.absolutePath),
                                    Content.Text(prompt),
                                ),
                            )
                            extractMessageText(response)
                        }
                    }
                    if (out.isEmpty()) throw IllegalStateException("本機視覺模型回傳空白內容。")
                    call.resolve(
                        JSObject().apply {
                            put("text", out)
                            put("modelUsed", "${spec.id} ($activeBackend)")
                            put("runtime", "litert")
                        },
                    )
                } finally {
                    tmpFile.delete()
                }
            } catch (t: Throwable) {
                Log.w(TAG, "parseImage ($runtime) failed: ${t.message}", t)
                call.reject(t.message ?: "本機圖片解析失敗")
            }
        }
    }

    override fun handleOnDestroy() {
        try {
            cancelRequested.set(true)
            closeEngineLocked()
            scope.cancel()
        } catch (_: Throwable) {
        }
        super.handleOnDestroy()
    }
}
