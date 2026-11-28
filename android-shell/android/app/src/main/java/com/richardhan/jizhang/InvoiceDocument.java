package com.richardhan.jizhang;

import android.content.ContentResolver;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

final class InvoiceDocument {
    static final int MAX_TEXT = 65536;

    static final class ImportException extends IOException {
        ImportException(String message) { super(message); }
    }

    static JSObject read(ContentResolver resolver, Uri uri, String type) throws IOException {
        if ("text/plain".equals(type)) {
            try (InputStream stream = resolver.openInputStream(uri)) {
                if (stream == null) throw new IOException();
                InputStreamReader reader = new InputStreamReader(stream, StandardCharsets.UTF_8);
                StringBuilder text = new StringBuilder();
                char[] buffer = new char[4096];
                int count;
                while ((count = reader.read(buffer)) != -1) {
                    if (text.length() + count > MAX_TEXT) throw new ImportException("檔案過長，請一次匯入一張收據。");
                    text.append(buffer, 0, count);
                }
                return new JSObject().put("text", text.toString());
            }
        }
        try (ParcelFileDescriptor fd = resolver.openFileDescriptor(uri, "r")) {
            if (fd == null) throw new IOException();
            try (PdfRenderer pdf = new PdfRenderer(fd)) {
                StringBuilder text = new StringBuilder();
                JSArray codes = new JSArray();
                for (int index = 0; index < pdf.getPageCount(); index++) {
                    try (PdfRenderer.Page page = pdf.openPage(index)) {
                        double scale = 2000.0 / Math.max(page.getWidth(), page.getHeight());
                        Bitmap image = Bitmap.createBitmap(Math.max(1, (int) (page.getWidth() * scale)),
                                Math.max(1, (int) (page.getHeight() * scale)), Bitmap.Config.ARGB_8888);
                        try {
                            image.eraseColor(Color.WHITE);
                            page.render(image, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                            JSObject result = readImage(image);
                            text.append(result.getString("text")).append('\n');
                            if (text.length() > MAX_TEXT) throw new ImportException("檔案過長，請選取單張發票。");
                            org.json.JSONArray pageCodes = result.optJSONArray("codes");
                            for (int i = 0; i < pageCodes.length(); i++) codes.put(pageCodes.optString(i));
                        } finally {
                            image.recycle();
                        }
                    }
                }
                return new JSObject().put("text", text.toString()).put("codes", codes);
            }
        }
    }

    static JSObject readImage(Bitmap bitmap) throws IOException {
        InputImage input = InputImage.fromBitmap(bitmap, 0);
        BarcodeScannerOptions options = new BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build();
        try (BarcodeScanner scanner = BarcodeScanning.getClient(options);
             TextRecognizer ocr = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build())) {
            JSArray codes = new JSArray();
            List<Rect> barcodeAreas = new ArrayList<>();
            for (Barcode code : Tasks.await(scanner.process(input))) {
                Rect bounds = code.getBoundingBox();
                if (bounds != null) barcodeAreas.add(bounds);
                if (code.getRawValue() != null) codes.put(code.getRawValue());
                else if (code.getRawBytes() != null) codes.put(new String(code.getRawBytes(), StandardCharsets.ISO_8859_1));
            }
            StringBuilder printed = new StringBuilder();
            for (Text.TextBlock block : Tasks.await(ocr.process(input)).getTextBlocks()) {
                for (Text.Line line : block.getLines()) {
                    Rect bounds = line.getBoundingBox();
                    if (bounds != null && barcodeAreas.stream().anyMatch(area -> Rect.intersects(area, bounds))) continue;
                    printed.append(line.getText()).append('\n');
                }
            }
            return new JSObject().put("codes", codes).put("text", printed.toString());
        } catch (Exception e) {
            throw new ImportException("無法辨識發票，請重拍或貼上收據文字。");
        }
    }
}
