package com.openmusic.app

import android.Manifest
import android.content.ContentValues
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.File
import java.io.InputStream
import java.io.OutputStream

/**
 * Hand-written, local Capacitor plugin (NO npm/git dependency — T-999.1-07 mitigation) that writes
 * downloaded audio into the PUBLIC `Music/OpenMusic/` collection so it is visible to file managers
 * and other audio apps (D-11, resolved `public-music-mediastore` 2026-06-12).
 *
 * Android version branch (RESEARCH Pitfall 2 / scoped storage):
 *  - API 29+ (Android 10+, >95% install base): MediaStore.Audio.Media with RELATIVE_PATH +
 *    IS_PENDING. Writing the app's OWN MediaStore entries needs NO runtime permission.
 *  - API <=28 (Android 9 and older): legacy Environment.getExternalStoragePublicDirectory(
 *    DIRECTORY_MUSIC) + MediaScannerConnection; WRITE_EXTERNAL_STORAGE is declared in the manifest
 *    with maxSdkVersion="28" (a no-op on modern Android — T-999.1-18 mitigation).
 *
 * Both `saveToMusic` and `deleteFromMusic` wrap their bodies in try/catch -> call.reject(message);
 * the TS side maps a reject to the blob-store never-throws sentinel (put->false / del->void), so a
 * failed public-Music write degrades to CDN playback and never crashes the player (T-999.1-19).
 */
@CapacitorPlugin(
    name = "MediaStoreSaver",
    permissions = [
        // CR-03: WRITE_EXTERNAL_STORAGE is a runtime (dangerous) permission on API 23–28 and is the
        // ONLY way the legacy (API <=28) public-Music write can succeed. minSdk is 24, so API 24–28
        // devices are supported and MUST be able to request this at call time. API 29+ writes the
        // app's OWN MediaStore entries with NO runtime permission, so this alias is only consulted on
        // the legacy branch. (Declared with maxSdkVersion="28" in AndroidManifest.xml.)
        Permission(strings = [Manifest.permission.WRITE_EXTERNAL_STORAGE], alias = "publicMusic")
    ]
)
class MediaStoreSaverPlugin : Plugin() {

    private val relativePath = "${Environment.DIRECTORY_MUSIC}/OpenMusic/"

    /** Infer an audio MIME type from the file extension; default audio/mpeg. */
    private fun mimeForFileName(fileName: String): String {
        return when (fileName.substringAfterLast('.', "").lowercase()) {
            "mp3" -> "audio/mpeg"
            "flac" -> "audio/flac"
            "m4a", "aac" -> "audio/mp4"
            "ogg" -> "audio/ogg"
            "wav" -> "audio/wav"
            else -> "audio/mpeg"
        }
    }

    /** Open the caller-supplied source file (a file:// URI of the app-private offline copy). */
    private fun openSource(sourcePath: String): InputStream? {
        val srcUri = Uri.parse(sourcePath)
        return when (srcUri.scheme) {
            "content" -> context.contentResolver.openInputStream(srcUri)
            // file:// (the @capacitor/filesystem getUri result) or a bare path.
            else -> {
                val path = srcUri.path ?: sourcePath
                val f = File(path)
                if (f.exists()) f.inputStream() else null
            }
        }
    }

    /** Stream all bytes from `input` to `output` in chunks (no whole-file buffering). WR-02. */
    private fun streamCopy(input: InputStream, output: OutputStream) {
        input.use { src ->
            output.use { dst ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val read = src.read(buffer)
                    if (read < 0) break
                    dst.write(buffer, 0, read)
                }
                dst.flush()
            }
        }
    }

    @PluginMethod
    fun saveToMusic(call: PluginCall) {
        val fileName = call.getString("fileName")
        if (fileName.isNullOrBlank()) {
            call.reject("fileName is required")
            return
        }
        val sourcePath = call.getString("sourcePath")
        if (sourcePath.isNullOrEmpty()) {
            call.reject("sourcePath is required")
            return
        }

        // CR-03: the legacy (API <=28) branch writes to public external storage, which requires the
        // WRITE_EXTERNAL_STORAGE runtime grant. Request it at call time before writing; on API 29+
        // no runtime permission is needed (app-owned MediaStore entry), so proceed directly.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            getPermissionState("publicMusic") != PermissionState.GRANTED
        ) {
            requestPermissionForAlias("publicMusic", call, "publicMusicPermsCallback")
            return
        }

        performSave(call, fileName, sourcePath)
    }

    @PermissionCallback
    private fun publicMusicPermsCallback(call: PluginCall) {
        if (getPermissionState("publicMusic") != PermissionState.GRANTED) {
            call.reject("WRITE_EXTERNAL_STORAGE permission denied")
            return
        }
        val fileName = call.getString("fileName")
        val sourcePath = call.getString("sourcePath")
        if (fileName.isNullOrBlank() || sourcePath.isNullOrEmpty()) {
            call.reject("fileName and sourcePath are required")
            return
        }
        performSave(call, fileName, sourcePath)
    }

    private fun performSave(call: PluginCall, fileName: String, sourcePath: String) {
        try {
            val mime = mimeForFileName(fileName)
            val input = openSource(sourcePath)
                ?: run {
                    call.reject("source file not found: $sourcePath")
                    return
                }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // API 29+: MediaStore RELATIVE_PATH + IS_PENDING write pattern. Stream the source
                // file straight into the entry (WR-02 — no whole-blob buffering).
                val resolver = context.contentResolver
                val collection =
                    MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                val values = ContentValues().apply {
                    put(MediaStore.Audio.Media.DISPLAY_NAME, fileName)
                    put(MediaStore.Audio.Media.MIME_TYPE, mime)
                    put(MediaStore.Audio.Media.RELATIVE_PATH, relativePath)
                    put(MediaStore.Audio.Media.IS_PENDING, 1)
                }
                val uri: Uri = resolver.insert(collection, values)
                    ?: run {
                        input.close()
                        call.reject("MediaStore insert returned null")
                        return
                    }
                val output = resolver.openOutputStream(uri)
                if (output == null) {
                    input.close()
                    resolver.delete(uri, null, null)
                    call.reject("Could not open output stream for the MediaStore entry")
                    return
                }
                streamCopy(input, output)
                values.clear()
                values.put(MediaStore.Audio.Media.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                call.resolve(JSObject().put("uri", uri.toString()))
            } else {
                // API <=28: legacy public-Music write + media scan so it is indexed.
                @Suppress("DEPRECATION")
                val musicDir =
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC)
                val targetDir = File(musicDir, "OpenMusic")
                if (!targetDir.exists()) targetDir.mkdirs()
                val outFile = File(targetDir, fileName)
                streamCopy(input, outFile.outputStream())
                // Index it so file managers / other audio apps see it immediately.
                MediaScannerConnection.scanFile(
                    context,
                    arrayOf(outFile.absolutePath),
                    arrayOf(mime),
                    null
                )
                call.resolve(JSObject().put("uri", Uri.fromFile(outFile).toString()))
            }
        } catch (e: Exception) {
            call.reject(e.message ?: "saveToMusic failed")
        }
    }

    @PluginMethod
    fun deleteFromMusic(call: PluginCall) {
        try {
            val uriString = call.getString("uri")
            if (uriString.isNullOrBlank()) {
                // Nothing to delete — never crash the caller.
                call.resolve()
                return
            }
            val uri = Uri.parse(uriString)
            when (uri.scheme) {
                "content" -> {
                    // MediaStore content URI (API 29+ branch) — delete the entry the app created.
                    context.contentResolver.delete(uri, null, null)
                }
                "file" -> {
                    // Legacy file:// URI (API <=28 branch) — remove the file and re-scan.
                    uri.path?.let { path ->
                        val f = File(path)
                        if (f.exists()) f.delete()
                        MediaScannerConnection.scanFile(context, arrayOf(path), null, null)
                    }
                }
            }
            call.resolve()
        } catch (e: Exception) {
            // Not-found / any failure swallowed into resolve — parity with del() never-throws.
            call.resolve()
        }
    }
}
