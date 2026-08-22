package com.ozamachess.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "OzamaSecureStorage")
public class OzamaSecureStoragePlugin extends Plugin {

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "ozama_session_aes_v1";
    private static final String PREFS = "ozama_secure_session";
    private static final String TOKEN_ENTRY = "encrypted_token";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final byte[] AAD = "com.ozamachess.app:session:v1".getBytes(StandardCharsets.UTF_8);

    private SecretKey sessionKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        }

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public synchronized void writeToken(PluginCall call) {
        String value = call.getString("value");
        if (value == null || value.trim().isEmpty()) {
            call.reject("Token requerido.");
            return;
        }

        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, sessionKey());
            cipher.updateAAD(AAD);
            byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            String payload = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)
                    + "."
                    + Base64.encodeToString(encrypted, Base64.NO_WRAP);
            if (!preferences().edit().putString(TOKEN_ENTRY, payload).commit()) {
                call.reject("No se pudo guardar la sesion segura.");
                return;
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("No se pudo cifrar la sesion.", error);
        }
    }

    @PluginMethod
    public synchronized void readToken(PluginCall call) {
        String payload = preferences().getString(TOKEN_ENTRY, "");
        JSObject result = new JSObject();
        if (payload == null || payload.isEmpty()) {
            result.put("value", "");
            call.resolve(result);
            return;
        }

        try {
            String[] parts = payload.split("\\.", 2);
            if (parts.length != 2) throw new IllegalStateException("Formato de sesion invalido.");
            byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
            byte[] encrypted = Base64.decode(parts[1], Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, sessionKey(), new GCMParameterSpec(128, iv));
            cipher.updateAAD(AAD);
            String value = new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
            result.put("value", value);
            call.resolve(result);
        } catch (Exception error) {
            preferences().edit().remove(TOKEN_ENTRY).commit();
            call.reject("La sesion segura no se pudo recuperar.", error);
        }
    }

    @PluginMethod
    public synchronized void removeToken(PluginCall call) {
        preferences().edit().remove(TOKEN_ENTRY).commit();
        call.resolve();
    }
}
