package com.openmusic.app

import android.content.ContentValues
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

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
@CapacitorPlugin(name = "MediaStoreSaver")
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

    @PluginMethod
    fun saveToMusic(call: PluginCall) {
        try {
            val fileName = call.getString("fileName")
            if (fileName.isNullOrBlank()) {
                call.reject("fileName is required")
                return
            }
            val base64 = call.getString("base64")
            if (base64.isNullOrEmpty()) {
                call.reject("base64 is required")
                return
            }
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            val mime = mimeForFileName(fileName)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // API 29+: MediaStore RELATIVE_PATH + IS_PENDING write pattern.
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
                        call.reject("MediaStore insert returned null")
                        return
                    }
                resolver.openOutputStream(uri)?.use { it.write(bytes) }
                    ?: run {
                        resolver.delete(uri, null, null)
                        call.reject("Could not open output stream for the MediaStore entry")
                        return
                    }
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
                outFile.outputStream().use { it.write(bytes) }
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
