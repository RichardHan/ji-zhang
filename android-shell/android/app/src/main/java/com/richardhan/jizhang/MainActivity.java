package com.richardhan.jizhang;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    static final String ACTION_CHANGE_SERVER = "com.richardhan.jizhang.CHANGE_SERVER";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        installErrorClient();
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void installErrorClient() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (shouldReturnToSettings(request)) {
                    loadLocalPage("error=1");
                    return;
                }
                super.onReceivedError(view, request, error);
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                if (shouldReturnToSettings(request) && errorResponse != null && errorResponse.getStatusCode() >= 400) {
                    loadLocalPage("error=1");
                    return;
                }
                super.onReceivedHttpError(view, request, errorResponse);
            }
        });
    }

    private boolean shouldReturnToSettings(WebResourceRequest request) {
        if (request == null || !request.isForMainFrame() || request.getUrl() == null) {
            return false;
        }
        return !isLocalUrl(request.getUrl().toString());
    }

    private boolean isLocalUrl(String url) {
        if (url == null) {
            return false;
        }
        return url.startsWith("https://localhost")
            || url.startsWith("http://localhost")
            || url.startsWith("capacitor://localhost");
    }

    private void handleIntent(Intent intent) {
        if (intent != null && ACTION_CHANGE_SERVER.equals(intent.getAction())) {
            loadLocalPage("settings=1");
        }
    }

    private void loadLocalPage(String query) {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        String base = getBridge().getLocalUrl();
        if (base == null || base.isEmpty()) {
            base = "https://localhost";
        }
        if (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        String target = base + "/index.html?" + query;
        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(target));
    }
}
