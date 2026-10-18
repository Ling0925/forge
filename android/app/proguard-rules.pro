# No shrinking is enabled for the mobile client yet. Keep the rules minimal and
# documented so a future release build does not silently break WebView callbacks.
-keepclassmembers class * extends android.webkit.WebViewClient { *; }
-keepclassmembers class * extends android.webkit.WebChromeClient { *; }
