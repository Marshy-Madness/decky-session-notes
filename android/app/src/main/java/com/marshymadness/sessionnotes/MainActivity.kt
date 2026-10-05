package com.marshymadness.sessionnotes

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
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
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject

/**
 * Thin native shell around the Session Notes website (served by your own server), with a second tab for the
 * public Bookstore. Native extras: remembers the server, microphone access for voice notes, the file/photo picker,
 * the Android back button, "Share to Session Notes" from other apps, "Save to my notes" from the Bookstore, and
 * speech to text with the phone's own recognizer (live words, works offline).
 */
class MainActivity : Activity() {
    private lateinit var webView: WebView // Notes tab (your server)
    private lateinit var storeView: WebView // Bookstore tab
    private lateinit var notesTab: LinearLayout
    private lateinit var storeTab: LinearLayout
    private lateinit var tabBar: LinearLayout
    private lateinit var progress: ProgressBar
    private var lastBackPress = 0L
    private var storeLoaded = false
    private val prefs by lazy { getSharedPreferences("session-notes", MODE_PRIVATE) }

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermission: PermissionRequest? = null
    private var pendingShare: String? = null
    private var pageReady = false
    private var recognizer: SpeechRecognizer? = null
    private var pendingDictationLang: String? = null // waiting for the microphone permission

    private val server: String? get() = prefs.getString("server", null)
    /** The server has loaded at least once, so a failure later means "offline", not "wrong address". */
    private var serverWorked: Boolean
        get() = prefs.getBoolean("serverWorked", true)
        set(v) = prefs.edit().putBoolean("serverWorked", v).apply()
    private val bookstore: String get() = prefs.getString("bookstore", null) ?: DEFAULT_BOOKSTORE
    private val current: WebView get() = if (storeView.visibility == View.VISIBLE) storeView else webView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CookieManager.getInstance().setAcceptCookie(true)
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        webView = newWebView(Client(store = false)).apply { addJavascriptInterface(Bridge(), "SessionNotesApp") }
        storeView = newWebView(Client(store = true)).apply { addJavascriptInterface(StoreBridge(), "SessionNotesApp") }

        // A thin loading bar along the top of the page while it loads.
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progressTintList = android.content.res.ColorStateList.valueOf(getColor(R.color.accent))
            progressBackgroundTintList = android.content.res.ColorStateList.valueOf(android.graphics.Color.TRANSPARENT)
            visibility = View.GONE
        }
        val pages = FrameLayout(this).apply {
            addView(webView); addView(storeView)
            addView(progress, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, dp(3), Gravity.TOP))
        }
        notesTab = tabButton("📝", "My notes") { if (current === webView) scrollToTop() else showTab(store = false) }
        storeTab = tabButton("📚", "Bookstore") { if (current === storeView) scrollToTop() else showTab(store = true) }
        tabBar = LinearLayout(this).apply {
            setBackgroundColor(getColor(R.color.panel))
            addView(notesTab, LinearLayout.LayoutParams(0, dp(60), 1f))
            addView(storeTab, LinearLayout.LayoutParams(0, dp(60), 1f))
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(pages, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(View(context).apply { setBackgroundColor(0xFF2A2F38.toInt()) }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 1))
            addView(tabBar, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        setContentView(root)
        // Hide the tabs while the keyboard is up, so there's more room to write.
        root.viewTreeObserver.addOnGlobalLayoutListener {
            val visible = android.graphics.Rect().also { root.getWindowVisibleDisplayFrame(it) }
            val keyboardUp = root.rootView.height - visible.bottom > root.rootView.height / 5
            tabBar.visibility = if (keyboardUp) View.GONE else View.VISIBLE
        }

        handleShareIntent(intent)
        askForPermissionsOnce()
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

    /** A bottom tab: an accent line on top when selected, then the icon and a label. */
    private fun tabButton(icon: String, label: String, onClick: () -> Unit) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        contentDescription = label
        isClickable = true
        isFocusable = true
        background = TypedValue().let { tv ->
            context.theme.resolveAttribute(android.R.attr.selectableItemBackground, tv, true)
            getDrawable(tv.resourceId)
        }
        setOnClickListener { onClick() }
        addView(View(context).apply { tag = "line" }, LinearLayout.LayoutParams(dp(48), dp(3)))
        addView(TextView(context).apply {
            text = icon
            gravity = Gravity.CENTER
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, 0, 1f).apply { topMargin = dp(4) })
        addView(TextView(context).apply {
            tag = "label"
            text = label
            gravity = Gravity.CENTER
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(6) })
    }

    /** The microphone and media permissions the app needs, for this Android version. */
    private fun neededPermissions(): Array<String> {
        val media = when {
            Build.VERSION.SDK_INT >= 34 -> listOf(
                Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO,
                Manifest.permission.READ_MEDIA_AUDIO, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED,
            )
            Build.VERSION.SDK_INT >= 33 -> listOf(
                Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO, Manifest.permission.READ_MEDIA_AUDIO,
            )
            else -> listOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
        return (listOf(Manifest.permission.RECORD_AUDIO) + media)
            .filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }.toTypedArray()
    }

    /** Ask for the microphone and photos/media on first launch, so voice notes and screenshots just work later. */
    private fun askForPermissionsOnce() {
        if (prefs.getBoolean("askedPermissions", false)) return
        prefs.edit().putBoolean("askedPermissions", true).apply()
        val missing = neededPermissions()
        if (missing.isNotEmpty()) requestPermissions(missing, REQ_START)
    }

    private fun scrollToTop() = current.evaluateJavascript("window.scrollTo({top: 0, behavior: 'smooth'})", null)

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun showTab(store: Boolean) {
        if (store && !storeLoaded) {
            storeLoaded = true
            storeView.loadUrl("$bookstore/")
        }
        storeView.visibility = if (store) View.VISIBLE else View.GONE
        webView.visibility = if (store) View.GONE else View.VISIBLE
        for ((tab, on) in listOf(notesTab to !store, storeTab to store)) {
            tab.findViewWithTag<View>("line").setBackgroundColor(if (on) getColor(R.color.accent) else android.graphics.Color.TRANSPARENT)
            tab.findViewWithTag<TextView>("label").apply {
                setTextColor(if (on) getColor(R.color.accent) else 0xFF9AA3B2.toInt())
                setTypeface(null, if (on) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL)
            }
            tab.isSelected = on
        }
        progress.visibility = View.GONE
    }

    /** "Can't reach the server" page with Try again, instead of a raw WebView error. */
    private fun showOffline(view: WebView, store: Boolean, error: String?) {
        val url = if (store) bookstore else server ?: ""
        view.loadUrl("file:///android_asset/offline.html?which=${if (store) "store" else "notes"}&url=${Uri.encode(url)}&error=${Uri.encode(error ?: "")}")
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
        if (recognizer != null) {
            endDictation()
            dictationEvent("end")
        }
    }

    override fun onDestroy() {
        endDictation()
        super.onDestroy()
    }

    // ---------- speech to text (window.snDictation receives the events) ----------

    private fun dictationEvent(type: String, text: String = "") {
        val json = JSONObject().put("type", type).put("text", text).toString()
        webView.evaluateJavascript("window.snDictation && window.snDictation($json)", null)
    }

    private fun beginDictation(lang: String) {
        endDictation()
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingDictationLang = lang
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_DICTATE)
            return
        }
        val r = SpeechRecognizer.createSpeechRecognizer(this)
        r.setRecognitionListener(object : RecognitionListener {
            private fun best(results: Bundle?) =
                results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()

            override fun onPartialResults(partialResults: Bundle?) {
                best(partialResults).takeIf { it.isNotBlank() }?.let { dictationEvent("partial", it) }
            }

            override fun onResults(results: Bundle?) {
                endDictation()
                dictationEvent("final", best(results))
            }

            override fun onError(error: Int) {
                endDictation()
                val message = when (error) {
                    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Didn't catch anything. Try again."
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "The app needs microphone permission."
                    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
                        "The phone's speech service needs the internet. Switch to the server engine under Account → Speech."
                    SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ->
                        "The phone can't recognise that language. Pick another under Account → Speech."
                    SpeechRecognizer.ERROR_CLIENT -> "" // cancelled
                    else -> "Speech recognition failed (error $error)."
                }
                dictationEvent("error", message)
            }

            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        recognizer = r
        r.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            if (lang.isNotBlank()) putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
            // Give people a moment to think mid-sentence before it stops listening.
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L)
        })
    }

    private fun endDictation() {
        recognizer?.let {
            it.cancel()
            it.destroy()
        }
        recognizer = null
    }

    @Deprecated("Simple back handling; the website closes its own dialogs first.")
    override fun onBackPressed() {
        val view = current
        view.evaluateJavascript("window.snBack ? window.snBack() : false") { handled ->
            if (handled == "true") return@evaluateJavascript
            when {
                view.canGoBack() -> view.goBack()
                view === storeView -> showTab(store = false)
                System.currentTimeMillis() - lastBackPress < 2000 -> finish()
                else -> {
                    lastBackPress = System.currentTimeMillis()
                    Toast.makeText(this, "Press back again to close Session Notes", Toast.LENGTH_SHORT).show()
                }
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
            prefs.edit().putString("server", url).putBoolean("serverWorked", false).apply()
            runOnUiThread { webView.clearHistory(); webView.loadUrl("$url/") }
        }

        @JavascriptInterface
        fun changeServer() = runOnUiThread { showSetup() }

        /** "Try again" on the offline page. */
        @JavascriptInterface
        fun retry() = runOnUiThread { loadHome() }

        /** Called by the website once it's logged in and loaded, so a pending share can be delivered. */
        @JavascriptInterface
        fun ready() = runOnUiThread { pageReady = true; deliverShare() }

        @JavascriptInterface
        fun version(): String = BuildConfig.VERSION_NAME

        /** Lets the website know the Bookstore is a tab here (so it doesn't show its own link). */
        @JavascriptInterface
        fun openBookstore() = runOnUiThread { showTab(store = true) }

        /** The phone has a speech recognizer the website can use instead of the server's. */
        @JavascriptInterface
        fun hasNativeSpeech(): Boolean = SpeechRecognizer.isRecognitionAvailable(this@MainActivity)

        /** lang: a language code like "en", or "" for the phone's default. */
        @JavascriptInterface
        fun startDictation(lang: String) = runOnUiThread { beginDictation(lang) }

        /** Stop listening and deliver what was heard so far. */
        @JavascriptInterface
        fun stopDictation() = runOnUiThread { recognizer?.stopListening() }

        @JavascriptInterface
        fun cancelDictation() = runOnUiThread { endDictation() }
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

        /** Offline page buttons. */
        @JavascriptInterface
        fun retry() = runOnUiThread { storeView.loadUrl("$bookstore/") }

        @JavascriptInterface
        fun backToNotes() = runOnUiThread { showTab(store = false) }
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

        private var failed = false

        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
            if (!store) pageReady = false
            failed = false
        }

        override fun onPageFinished(view: WebView, url: String) {
            if (url.startsWith("file:") || failed) return
            if (!store) serverWorked = true
            // Don't let Back return to the offline/setup page after a successful retry.
            val history = view.copyBackForwardList()
            if (history.currentIndex > 0 && history.getItemAtIndex(history.currentIndex - 1).url.startsWith("file:")) view.clearHistory()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame || request.url.scheme == "file") return
            failed = true
            val msg = error.description?.toString()
            // A server that never worked probably has a typo in its address, so go back to setup to fix it.
            if (!store && !serverWorked) return showSetup(msg)
            if (store) storeLoaded = false // try again next time the tab is opened
            showOffline(view, store, msg)
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            if (view !== current) return
            progress.progress = newProgress
            progress.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
        }

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
            val imagesOnly = params.acceptTypes.any { it.isNotBlank() } && params.acceptTypes.all { it.isBlank() || it.startsWith("image/") }
            val intent = if (imagesOnly && Build.VERSION.SDK_INT >= 33) {
                // Android's photo picker: recent photos and screenshots up front.
                Intent(MediaStore.ACTION_PICK_IMAGES).apply {
                    type = "image/*"
                    if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, MediaStore.getPickImagesMaxLimit().coerceAtMost(20))
                }
            } else params.createIntent()
            return try {
                startActivityForResult(intent, REQ_FILES)
                true
            } catch (e: Exception) {
                fileCallback = null
                false
            }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        if (requestCode == REQ_DICTATE) {
            val lang = pendingDictationLang ?: return
            pendingDictationLang = null
            if (results.firstOrNull() == PackageManager.PERMISSION_GRANTED) beginDictation(lang)
            else dictationEvent("error", "The app needs microphone permission to listen.")
            return
        }
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
        private const val REQ_DICTATE = 3
        private const val REQ_START = 4
        private const val DEFAULT_BOOKSTORE = "https://bookstore.marshymadness.com"
    }
}
