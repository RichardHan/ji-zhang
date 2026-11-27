package com.richardhan.jizhang;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
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
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;

@CapacitorPlugin(name = "ReceiptPhoto")
public final class ReceiptPhotoPlugin extends Plugin {
    private boolean selecting;

    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (!Intent.ACTION_SEND.equals(intent.getAction()) || !"text/plain".equals(intent.getType())) return;
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (text == null) return;
        intent.removeExtra(Intent.EXTRA_TEXT);
        JSObject shared = new JSObject();
        if (text.length() > InvoiceDocument.MAX_TEXT) shared.put("error", "分享文字過長，請一次匯入一張發票。");
        else shared.put("text", text.toString());
        getBridge().execute(() -> notifyListeners("sharedInvoice", shared, true));
    }

    private File captureFile() {
        return new File(getContext().getCacheDir(), "pending-receipt-camera.jpg");
    }

    @PluginMethod
    public void select(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (selecting) {
                call.reject("正在選取收據照片。");
                return;
            }
            boolean camera = call.getBoolean("camera", false);
            try {
                Intent intent;
                if (camera) {
                    intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                    if (intent.resolveActivity(getContext().getPackageManager()) == null) {
                        call.unavailable("找不到相機，請改用選取照片。");
                        return;
                    }
                    File file = captureFile();
                    if (file.exists() && !file.delete()) throw new IOException();
                    if (!file.createNewFile()) throw new IOException();
                    Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                    intent.putExtra(MediaStore.EXTRA_OUTPUT, uri);
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                } else {
                    intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
                    if (call.getBoolean("invoice", false)) {
                        intent.setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES,
                                new String[] {"image/*", "text/plain", "application/pdf"});
                    } else {
                        intent.setType("image/*");
                    }
                }
                selecting = true;
                startActivityForResult(call, intent, "onPhoto");
            } catch (RuntimeException | IOException e) {
                selecting = false;
                if (camera) captureFile().delete();
                call.reject("無法開啟相機或檔案選擇器。");
            }
        });
    }

    @ActivityCallback
    private void onPhoto(PluginCall call, ActivityResult result) {
        if (call == null || PluginCall.CALLBACK_ID_DANGLING.equals(call.getCallbackId())
                || result.getResultCode() != Activity.RESULT_OK) {
            selecting = false;
            captureFile().delete();
            if (call != null) call.resolve();
            return;
        }
        boolean camera = call.getBoolean("camera", false);
        Intent data = result.getData();
        Uri uri = camera ? Uri.fromFile(captureFile()) : data == null ? null : data.getData();
        execute(() -> {
            try {
                if (!camera && (uri == null || !"content".equals(uri.getScheme())
                        || (getContext().getPackageName() + ".fileprovider").equals(uri.getAuthority()))) {
                    throw new IOException();
                }
                if (call.getBoolean("invoice", false)) {
                    String type = camera ? "image/jpeg" : getContext().getContentResolver().getType(uri);
                    if ("application/pdf".equals(type) || "text/plain".equals(type)) {
                        call.resolve(InvoiceDocument.read(getContext().getContentResolver(), uri, type));
                    } else if (type != null && type.startsWith("image/")) {
                        Bitmap image = decode(uri);
                        try {
                            call.resolve(InvoiceDocument.readImage(image));
                        } finally {
                            image.recycle();
                        }
                    } else {
                        call.reject("請選取 TXT、PDF 或發票圖片。");
                    }
                    return;
                }
                Bitmap bitmap = decode(uri);
                ByteArrayOutputStream preview = new ByteArrayOutputStream();
                bitmap.compress(Bitmap.CompressFormat.JPEG, 78, preview);
                JSObject response = new JSObject().put("preview", "data:image/jpeg;base64,"
                        + Base64.encodeToString(preview.toByteArray(), Base64.NO_WRAP));
                try (TextRecognizer recognizer = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build())) {
                    String text = Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0))).getText();
                    response.put("text", text);
                } catch (Exception e) {
                    // Keep the preview so the user can enter unreadable fields by hand.
                    response.put("text", "");
                } finally {
                    bitmap.recycle();
                }
                call.resolve(response);
            } catch (InvoiceDocument.ImportException e) {
                call.reject(e.getMessage());
            } catch (IOException | RuntimeException e) {
                call.reject("無法讀取這張照片，請重拍或選取其他影像。");
            } finally {
                if (camera) captureFile().delete();
                getActivity().runOnUiThread(() -> selecting = false);
            }
        });
    }

    private Bitmap decode(Uri uri) throws IOException {
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        try (InputStream stream = getContext().getContentResolver().openInputStream(uri)) {
            BitmapFactory.decodeStream(stream, null, options);
        }
        if (options.outWidth <= 0 || options.outHeight <= 0) throw new IOException();
        options.inSampleSize = 1;
        while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 2400) options.inSampleSize *= 2;
        options.inJustDecodeBounds = false;
        Bitmap bitmap;
        try (InputStream stream = getContext().getContentResolver().openInputStream(uri)) {
            bitmap = BitmapFactory.decodeStream(stream, null, options);
        }
        if (bitmap == null) throw new IOException();
        int orientation;
        try (InputStream stream = getContext().getContentResolver().openInputStream(uri)) {
            orientation = new ExifInterface(stream).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1);
        } catch (IOException e) {
            return bitmap;
        }
        Matrix transform = new Matrix();
        switch (orientation) {
            case 2: transform.setScale(-1, 1); break;
            case 3: transform.setRotate(180); break;
            case 4: transform.setScale(1, -1); break;
            case 5: transform.setRotate(90); transform.postScale(-1, 1); break;
            case 6: transform.setRotate(90); break;
            case 7: transform.setRotate(-90); transform.postScale(-1, 1); break;
            case 8: transform.setRotate(-90); break;
            default: return bitmap;
        }
        Bitmap oriented = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), transform, true);
        if (oriented != bitmap) bitmap.recycle();
        return oriented;
    }
}
