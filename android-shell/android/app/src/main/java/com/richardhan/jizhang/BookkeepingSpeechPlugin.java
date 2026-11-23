package com.richardhan.jizhang;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.os.BadParcelableException;
import android.speech.RecognizerIntent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.List;

@CapacitorPlugin(name = "BookkeepingSpeech")
public final class BookkeepingSpeechPlugin extends Plugin {
    // Capacitor retains only one activity callback per plugin. Access on the UI thread.
    private boolean listening;

    @PluginMethod
    public void recognize(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (listening) {
                call.reject("語音輸入正在進行中。");
                return;
            }

            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-TW");

            listening = true;
            try {
                // The system speech activity owns microphone permission and only returns text.
                startActivityForResult(call, intent, "onSpeechResult");
            } catch (ActivityNotFoundException e) {
                listening = false;
                call.unavailable("這台手機沒有可用的 Android 語音辨識服務，可改用鍵盤輸入。");
            } catch (SecurityException e) {
                listening = false;
                call.reject("未允許使用 Android 語音辨識，可改用鍵盤輸入。");
            } catch (IllegalStateException e) {
                listening = false;
                call.reject("暫時無法開啟 Android 語音辨識，請再試一次或改用鍵盤輸入。");
            }
        });
    }

    @ActivityCallback
    private void onSpeechResult(PluginCall call, ActivityResult result) {
        listening = false;
        if (call == null || PluginCall.CALLBACK_ID_DANGLING.equals(call.getCallbackId())) return;

        try {
            Intent data = result.getData();
            int code = result.getResultCode();
            List<?> matches = code == Activity.RESULT_OK && data != null
                    ? data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS) : null;
            String text = transcriptFromResult(code, matches);
            JSObject response = new JSObject();
            if (text != null) response.put("text", text);
            call.resolve(response);
        } catch (IllegalStateException e) {
            call.reject(e.getMessage());
        } catch (BadParcelableException e) {
            call.reject("無法讀取語音辨識結果，請重試或改用鍵盤輸入。");
        }
    }

    static String transcriptFromResult(int code, List<?> matches) {
        if (code == Activity.RESULT_CANCELED) return null;
        if (code == Activity.RESULT_OK && matches != null) {
            for (Object match : matches) {
                if (match instanceof String) {
                    String text = ((String) match).trim();
                    if (!text.isEmpty()) return text;
                }
            }
        }
        if (code == Activity.RESULT_OK || code == RecognizerIntent.RESULT_NO_MATCH) {
            throw new IllegalStateException("沒有辨識到文字，請再說一次或改用鍵盤輸入。");
        }
        throw new IllegalStateException("Android 語音辨識失敗，請重試或改用鍵盤輸入。");
    }
}
