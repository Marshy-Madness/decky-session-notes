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
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject

/**
 * Thin native shell around the Session Notes website (served by your own server), with a second tab for the
 * public Bookstore. Native extras: remembers the server, microphone access for voice notes, the file/photo picker,
 * the Android back button, "Share to Session Notes" from other apps, and "Save to my notes" from the Bookstore.
 */
class MainActivity : Activity() {
    private lateinit var webView: WebView // Notes tab (your server)
    private lateinit var storeView: WebView // Bookstore tab
    private lateinit var notesTab: TextView
    private lateinit var storeTab: TextView
    private var storeLoaded = false
    private val prefs by lazy { getSharedPreferences("session-notes", MODE_PRIVATE) }

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermission: PermissionRequest? = null
    private var pendingShare: String? = null
    private var pageReady = false

    private val server: String? get() = prefs.getString("server", null)
    private val bookstore: String get() = prefs.getString("bookstore", null) ?: DEFAULT_BOOKSTORE
    private val current: WebView get() = if (storeView.visibility == View.VISIBLE) storeView else webView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CookieManager.getInstance().setAcceptCookie(true)
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        webView = newWebView(Client(store = false)).apply { addJavascriptInterface(Bridge(), "SessionNotesApp") }
        storeView = newWebView(Client(store = true)).apply { addJavascriptInterface(StoreBridge(), "SessionNotesApp") }

        val pages = FrameLayout(this).apply { addView(webView); addView(storeView) }
        notesTab = tabButton("📝  Notes") { showTab(store = false) }
        storeTab = tabButton("📚  Bookstore") { showTab(store = true) }
        val bar = LinearLayout(this).apply {
            setBackgroundColor(getColor(R.color.panel))
            addView(notesTab, LinearLayout.LayoutParams(0, dp(52), 1f))
            addView(storeTab, LinearLayout.LayoutParams(0, dp(52), 1f))
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(pages, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(bar, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        })

        handleShareIntent(intent)
        if (savedInstanceState != null) {
            savedInstanceState.getBundle("notes")?.let { webView.restoreState(it) } ?: loadHome()
            savedInstanceState.getBundle("store")?.let { storeView.restoreState(it); storeLoaded = true }
            showTab(savedInstanceState.getBoolean("onStore"))
        } else {
            loadHome()
            showTab(store = false)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun newWebView(client: WebViewClient) = WebView(this).apply {
        setBackgroundColor(getColor(R.color.bg))
        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
        }
        webViewClient = client
        webChromeClient = Chrome()
    }

    private fun tabButton(label: String, onClick: () -> Unit) = TextView(this).apply {
        text = label
        gravity = Gravity.CENTER
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        isClickable = true
        setOnClickListener { onClick() }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun showTab(store: Boolean) {
        if (store && !storeLoaded) {
            storeLoaded = true
            storeView.loadUrl("$bookstore/")
        }
        storeView.visibility = if (store) View.VISIBLE else View.GONE
        webView.visibility = if (store) View.GONE else View.VISIBLE
        for ((tab, on) in listOf(notesTab to !store, storeTab to store)) {
            tab.setTextColor(if (on) getColor(R.color.accent) else 0xFF9AA3B2.toInt())
            tab.setTypeface(null, if (on) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL)
        }
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
        outState.putBundle("notes", Bundle().also { webView.saveState(it) })
        if (storeLoaded) outState.putBundle("store", Bundle().also { storeView.saveState(it) })
        outState.putBoolean("onStore", current === storeView)
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    @Deprecated("Simple back handling; the website closes its own dialogs first.")
    override fun onBackPressed() {
        val view = current
        view.evaluateJavascript("window.snBack ? window.snBack() : false") { handled ->
            if (handled == "true") return@evaluateJavascript
            when {
                view.canGoBack() -> view.goBack()
                view === storeView -> showTab(store = false)
                else -> finish()
            }
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
        showTab(store = false)
        webView.evaluateJavascript("window.snReceiveShareNative && window.snReceiveShareNative($share)", null)
    }

    // ---------- JS bridge (window.SessionNotesApp) ----------

    inner class Bridge {
        @JavascriptInterface
        fun bookstoreUrl(): String = bookstore

        @JavascriptInterface
        fun setBookstore(url: String) {
            prefs.edit().putString("bookstore", url.ifBlank { DEFAULT_BOOKSTORE }).apply()
            runOnUiThread { storeLoaded = false; storeView.clearHistory() }
        }

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

        /** Lets the website know the Bookstore is a tab here (so it doesn't show its own link). */
        @JavascriptInterface
        fun openBookstore() = runOnUiThread { showTab(store = true) }
    }

    /** window.SessionNotesApp on Bookstore pages. */
    inner class StoreBridge {
        /** "Save to my notes": the Notes site copies the post (with its media) into your notes and opens it. */
        @JavascriptInterface
        fun saveToNotes(entryId: String) = runOnUiThread {
            if (!Regex("^[A-Za-z0-9_-]{1,64}$").matches(entryId)) return@runOnUiThread
            showTab(store = false)
            val url = server
            if (url == null) showSetup()
            else webView.loadUrl("$url/?import=bookstore:$entryId")
        }

        @JavascriptInterface
        fun version(): String = BuildConfig.VERSION_NAME
    }

    // ---------- WebView plumbing ----------

    private fun sameSite(url: Uri, base: String?): Boolean {
        val home = base?.let { Uri.parse(it) } ?: return false
        return url.host == home.host && url.port == home.port
    }

    /** Steam sign-in pages stay inside the app so the login cookie lands in the right tab. */
    private fun isSteamLogin(url: Uri): Boolean {
        val host = url.host ?: return false
        return listOf("steamcommunity.com", "steampowered.com").any { host == it || host.endsWith(".$it") }
    }

    private inner class Client(private val store: Boolean) : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (url.scheme == "file") return false
            if (sameSite(url, if (store) bookstore else server) || isSteamLogin(url)) return false
            if (!store && sameSite(url, bookstore)) { // a Bookstore link on the Notes site: open it in the Bookstore tab
                storeLoaded = true
                storeView.loadUrl(url.toString())
                showTab(store = true)
                return true
            }
            if (store && sameSite(url, server)) {
                webView.loadUrl(url.toString())
                showTab(store = false)
                return true
            }
            startActivity(Intent(Intent.ACTION_VIEW, url)) // other links open in the browser
            return true
        }

        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
            if (!store) pageReady = false
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame || request.url.scheme == "file") return
            if (!store) return showSetup(error.description?.toString())
            storeLoaded = false // try again next time the tab is opened
            val msg = android.text.Html.escapeHtml(error.description ?: "")
            view.loadDataWithBaseURL(null, """<body style="background:#14171c;color:#e6e9ee;font-family:sans-serif;padding:24px">
                <h2>📚 Bookstore unreachable</h2><p>$msg</p><p style="opacity:.7">${android.text.Html.escapeHtml(bookstore)}</p>
                <p style="opacity:.7">Change the address with the Server button on the Notes tab.</p></body>""", "text/html", "utf-8", null)
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
        private const val DEFAULT_BOOKSTORE = "https://bookstore.marshymadness.com"
    }
}
