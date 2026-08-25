package com.ozamachess.app;

import android.os.CancellationSignal;
import androidx.core.content.ContextCompat;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetGoogleIdOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

@CapacitorPlugin(name = "OzamaGoogleAuth")
public class GoogleAuthPlugin extends Plugin {

    @PluginMethod
    public void signIn(PluginCall call) {
        String webClientId = call.getString("webClientId");
        if (webClientId == null || webClientId.trim().isEmpty()) {
            call.reject("webClientId requerido.");
            return;
        }

        GetGoogleIdOption googleIdOption = new GetGoogleIdOption.Builder()
                .setFilterByAuthorizedAccounts(false)
                .setServerClientId(webClientId.trim())
                .setAutoSelectEnabled(false)
                .build();

        GetCredentialRequest request = new GetCredentialRequest.Builder()
                .addCredentialOption(googleIdOption)
                .build();

        CredentialManager credentialManager = CredentialManager.create(getContext());
        credentialManager.getCredentialAsync(
                getActivity(),
                request,
                new CancellationSignal(),
                ContextCompat.getMainExecutor(getContext()),
                new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                    @Override
                    public void onResult(GetCredentialResponse result) {
                        handleCredential(call, result.getCredential());
                    }

                    @Override
                    public void onError(GetCredentialException error) {
                        if (error instanceof GetCredentialCancellationException) {
                            call.reject("Inicio de sesion cancelado.", "CANCELLED");
                            return;
                        }
                        call.reject("No se pudo continuar con Google.", error);
                    }
                }
        );
    }

    private void handleCredential(PluginCall call, Credential credential) {
        if (!(credential instanceof CustomCredential)) {
            call.reject("Credencial de Google invalida.");
            return;
        }

        CustomCredential custom = (CustomCredential) credential;
        if (!GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(custom.getType())) {
            call.reject("Tipo de credencial no soportado.");
            return;
        }

        try {
            GoogleIdTokenCredential googleIdTokenCredential = GoogleIdTokenCredential.createFrom(custom.getData());
            JSObject result = new JSObject();
            result.put("idToken", googleIdTokenCredential.getIdToken());
            call.resolve(result);
        } catch (RuntimeException error) {
            call.reject("No se pudo interpretar la credencial de Google.", error);
        }
    }
}
