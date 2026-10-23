# AndroidX Test references these optional static-analysis annotations only.
# Scope the suppression to the test APK; do not hide missing runtime application classes.
-dontwarn com.google.errorprone.annotations.CanIgnoreReturnValue
-dontwarn com.google.errorprone.annotations.MustBeClosed
