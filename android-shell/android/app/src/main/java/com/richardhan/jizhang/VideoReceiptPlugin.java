package com.richardhan.jizhang;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.media.MediaMuxer;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;
import java.io.DataInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;

@CapacitorPlugin(name = "VideoReceipt")
public final class VideoReceiptPlugin extends Plugin {
    private boolean selecting;

    private File captureFile() {
        return new File(getContext().getCacheDir(), "receipt-capture.mp4");
    }

    @PluginMethod
    public void select(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (selecting) {
                call.reject("正在讀取另一段影片。");
                return;
            }
            boolean camera = call.getBoolean("camera", false);
            try {
                Intent intent;
                if (camera) {
                    intent = new Intent(MediaStore.ACTION_VIDEO_CAPTURE);
                    File file = captureFile();
                    if (file.exists() && !file.delete()) throw new IOException();
                    if (!file.createNewFile()) throw new IOException();
                    Uri output = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                    intent.putExtra(MediaStore.EXTRA_OUTPUT, output);
                    intent.setClipData(android.content.ClipData.newRawUri("video", output));
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    intent.putExtra(MediaStore.EXTRA_DURATION_LIMIT, 60);
                } else {
                    intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("video/*");
                }
                selecting = true;
                startActivityForResult(call, intent, "onVideo");
            } catch (IOException | RuntimeException e) {
                selecting = false;
                if (camera) captureFile().delete();
                call.reject("無法開啟相機或選擇器，請改用其他方式匯入。");
            }
        });
    }

    @ActivityCallback
    private void onVideo(PluginCall call, ActivityResult result) {
        if (call == null || PluginCall.CALLBACK_ID_DANGLING.equals(call.getCallbackId())
                || result.getResultCode() != Activity.RESULT_OK) {
            captureFile().delete();
            selecting = false;
            if (call != null) call.resolve();
            return;
        }
        boolean camera = call.getBoolean("camera", false);
        Intent data = result.getData();
        Uri returned = data == null ? null : data.getData();
        boolean captured = camera && captureFile().length() > 0;
        Uri uri = captured ? Uri.fromFile(captureFile()) : returned;
        execute(() -> {
            try {
                if (uri == null || (!captured && (!"content".equals(uri.getScheme())
                        || (getContext().getPackageName() + ".fileprovider").equals(uri.getAuthority())))) throw new IOException();
                JSObject response = readVideo(uri, call.getBoolean("audio", false));
                call.resolve(response);
            } catch (IllegalArgumentException e) {
                call.reject("請選取可播放、長度在 60 秒以內的短片。");
            } catch (Exception e) {
                call.reject("無法讀取影片，請改用其他短片。");
            } finally {
                if (camera) captureFile().delete();
                getActivity().runOnUiThread(() -> selecting = false);
            }
        });
    }

    private JSObject readVideo(Uri uri, boolean audio) throws Exception {
        MediaMetadataRetriever media = new MediaMetadataRetriever();
        JSArray frames = new JSArray();
        try (TextRecognizer recognizer = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build())) {
            media.setDataSource(getContext(), uri);
            long duration = Long.parseLong(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
            if (duration < 1 || duration > 60000) throw new IllegalArgumentException();
            int count = Math.min(30, (int) ((duration + 999) / 1000));
            for (int i = 0; i < count; i++) {
                long time = duration * 1000 * (2 * i + 1) / (2 * count);
                Bitmap frame = Build.VERSION.SDK_INT >= 27
                        ? media.getScaledFrameAtTime(time, MediaMetadataRetriever.OPTION_CLOSEST, 1600, 1600)
                        : media.getFrameAtTime(time, MediaMetadataRetriever.OPTION_CLOSEST);
                if (frame == null) continue;
                try {
                    String text = Tasks.await(recognizer.process(InputImage.fromBitmap(frame, 0))).getText();
                    if (!text.isEmpty()) frames.put(text.substring(0, Math.min(text.length(), 4096)));
                } finally {
                    frame.recycle();
                }
            }
        } finally {
            media.release();
        }
        JSObject response = new JSObject().put("frames", frames);
        if (audio) {
            try {
                String data = audioTrack(uri);
                if (data != null) response.put("audio", data);
                else response.put("audioNotice", "短片沒有可讀取的 AAC 音軌，請核對畫面結果。");
            } catch (IOException | RuntimeException e) {
                response.put("audioNotice", "無法讀取音軌，請核對畫面結果。");
            }
        }
        return response;
    }

    // Remux just the AAC samples. Nothing from the video track leaves this device.
    private String audioTrack(Uri uri) throws IOException {
        MediaExtractor extractor = new MediaExtractor();
        File temp = File.createTempFile("receipt-audio-", ".m4a", getContext().getCacheDir());
        try {
            extractor.setDataSource(getContext(), uri, null);
            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat format = extractor.getTrackFormat(i);
                if (!MediaFormat.MIMETYPE_AUDIO_AAC.equals(format.getString(MediaFormat.KEY_MIME))) continue;
                extractor.selectTrack(i);
                MediaMuxer muxer = new MediaMuxer(temp.getPath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
                try {
                    int track = muxer.addTrack(format);
                    muxer.start();
                    ByteBuffer sample = ByteBuffer.allocate(128 * 1024);
                    MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
                    int total = 0;
                    while (extractor.getSampleTime() >= 0) {
                        sample.clear();
                        int size = extractor.readSampleData(sample, 0);
                        if (size < 0) break;
                        total += size;
                        if (size > sample.capacity() || total > 4 * 1024 * 1024) throw new IOException();
                        info.set(0, size, extractor.getSampleTime(), 0);
                        muxer.writeSampleData(track, sample, info);
                        extractor.advance();
                    }
                    muxer.stop();
                } finally {
                    muxer.release();
                }
                byte[] bytes = new byte[(int) temp.length()];
                try (DataInputStream in = new DataInputStream(new FileInputStream(temp))) {
                    in.readFully(bytes);
                }
                return Base64.encodeToString(bytes, Base64.NO_WRAP);
            }
            return null;
        } finally {
            extractor.release();
            temp.delete();
        }
    }
}
