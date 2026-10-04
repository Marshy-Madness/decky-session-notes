package com.marshymadness.sessionnotes

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.util.Base64
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONArray
import org.json.JSONObject

/**
 * Thin native shell around the Session Notes website (served by your own server).
 * Native extras: remembers the server, microphone access for voice notes, the file/photo picker,
 * the Android back button, and "Share to Session Notes" from other apps.
 */
class MainActivity : Activity() {
    private lateinit var webView: WebView
    private val prefs by lazy { getSharedPreferences("session-notes", MODE_PRIVATE) }

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermission: PermissionRequest? = null
    private var pendingShare: String? = null
    private var pageReady = false

    private val server: String? get() = prefs.getString("server", null)

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)
        webView.setBackgroundColor(0xFF14171C.toInt())
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
        }
        CookieManager.getInstance().setAcceptCookie(true)
        webView.addJavascriptInterface(Bridge(), "SessionNotesApp")
        webView.webViewClient = Client()
        webView.webChromeClient = Chrome()
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

        handleShareIntent(intent)
        if (savedInstanceState != null) webView.restoreState(savedInstanceState) else loadHome()
    }

    private fun loadHome() {
        val url = server
        if (url == null) webView.loadUrl("file:///android_asset/setup.html") else webView.loadUrl("$url/")
    }

    private fun showSetup(error: String? = null) {
        val q = StringBuilder("file:///android_asset/setup.html?url=").append(Uri.encode(server ?: ""))
        if (error != null) q.append("&error=").append(Uri.encode(error))
        webView.loadUrl(q.toString())
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShareIntent(intent)
        deliverShare()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    @Deprecated("Simple back handling; the website closes its own dialogs first.")
    override fun onBackPressed() {
        webView.evaluateJavascript("window.snBack ? window.snBack() : false") { handled ->
            if (handled == "true") return@evaluateJavascript
            if (webView.canGoBack()) webView.goBack() else finish()
        }
    }

    // ---------- sharing into the app ----------

    private fun handleShareIntent(intent: Intent?) {
        if (intent == null || (intent.action != Intent.ACTION_SEND && intent.action != Intent.ACTION_SEND_MULTIPLE)) return
        val uris = mutableListOf<Uri>()
        @Suppress("DEPRECATION")
        if (intent.action == Intent.ACTION_SEND) {
            (intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))?.let { uris.add(it) }
        } else {
            intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.let { uris.addAll(it) }
        }
        val files = JSONArray()
        for (uri in uris.take(10)) {
            val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: continue
            if (bytes.size > 40 * 1024 * 1024) continue
            files.put(JSONObject().apply {
                put("name", displayName(uri))
                put("type", contentResolver.getType(uri) ?: "application/octet-stream")
                put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
            })
        }
        pendingShare = JSONObject().apply {
            put("title", intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: "")
            put("text", intent.getStringExtra(Intent.EXTRA_TEXT) ?: "")
            put("files", files)
        }.toString()
        intent.action = null // don't re-handle on rotation
    }

    private fun displayName(uri: Uri): String {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) return c.getString(0) ?: "shared"
        }
        return uri.lastPathSegment ?: "shared"
    }

    private fun deliverShare() {
        val share = pendingShare ?: return
        if (!pageReady) return
        pendingShare = null
        webView.evaluateJavascript("window.snReceiveShareNative && window.snReceiveShareNative($share)", null)
    }

    // ---------- JS bridge (window.SessionNotesApp) ----------

    inner class Bridge {
        @JavascriptInterface
        fun setServer(url: String) {
            prefs.edit().putString("server", url).apply()
            runOnUiThread { webView.clearHistory(); webView.loadUrl("$url/") }
        }

        @JavascriptInterface
        fun changeServer() = runOnUiThread { showSetup() }

        /** Called by the website once it's logged in and loaded, so a pending share can be delivered. */
        @JavascriptInterface
        fun ready() = runOnUiThread { pageReady = true; deliverShare() }

        @JavascriptInterface
        fun version(): String = BuildConfig.VERSION_NAME
    }

    // ---------- WebView plumbing ----------

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            val home = server?.let { Uri.parse(it) }
            if (url.scheme == "file") return false
            if (home != null && url.host == home.host && url.port == home.port) return false
            startActivity(Intent(Intent.ACTION_VIEW, url)) // other links open in the browser
            return true
        }

        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
            pageReady = false
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame && request.url.scheme != "file") showSetup(error.description?.toString())
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onPermissionRequest(request: PermissionRequest) {
            runOnUiThread {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE !in request.resources) return@runOnUiThread request.deny()
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                } else {
                    pendingPermission = request
                    requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
                }
            }
        }

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            return try {
                startActivityForResult(params.createIntent(), REQ_FILES)
                true
            } catch (e: Exception) {
                fileCallback = null
                false
            }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        if (requestCode != REQ_MIC) return
        val req = pendingPermission ?: return
        pendingPermission = null
        if (results.firstOrNull() == PackageManager.PERMISSION_GRANTED) req.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else req.deny()
    }

    @Deprecated("Fine for a single file picker.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQ_FILES) return super.onActivityResult(requestCode, resultCode, data)
        val uris = mutableListOf<Uri>()
        if (resultCode == RESULT_OK && data != null) {
            data.clipData?.let { clip -> for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri) }
            if (uris.isEmpty()) data.data?.let { uris.add(it) }
        }
        fileCallback?.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
        fileCallback = null
    }

    companion object {
        private const val REQ_MIC = 1
        private const val REQ_FILES = 2
    }
}
