# Shrink unused dependency code, but keep debug source stepping and readable stacks.
# proguard-android.txt disables optimization; do not rename classes or members either.
-dontobfuscate
-keepattributes SourceFile,LineNumberTable,LocalVariableTable,LocalVariableTypeTable

# Keep application entry points/state intact for the debugger and instrumentation tests.
-keep class dev.forge.nativeapp.** { *; }
# The separate instrumentation APK calls APIs in these shared runtime libraries
# that the app itself may not call (for example CompletableJob.complete()).
# Keep their ABI in the debuggable target too, not only in the test APK.
# Material/Foundation widgets, icons and other unused dependencies still shrink.
-keep class kotlin.** { *; }
-keep class kotlinx.coroutines.** { *; }
-keep class androidx.compose.runtime.** { *; }
-keep class androidx.compose.ui.** { *; }
-keep class androidx.lifecycle.** { *; }
-keep class androidx.activity.** { *; }
-keep class androidx.core.** { *; }
