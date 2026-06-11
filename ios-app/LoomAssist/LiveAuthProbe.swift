#if DEBUG
import Foundation
import LoomKit

/// Live-verification harness for Cognito SRP sign-in, run inside the real
/// app because Amplify's keychain credential store needs an application
/// identity that bare `swift test` / xctest runners don't have.
///
///     SIMCTL_CHILD_LOOM_LIVE_AUTH=1 xcrun simctl launch --console booted com.loomassist.ios
///
/// Prints `LOOM_LIVE_AUTH RESULT: PASS|FAIL ...` and exits so the launch
/// command returns. Uses the same smoke-test user as infra/smoke_test.py
/// (overridable via LOOM_SMOKE_EMAIL / LOOM_SMOKE_PASSWORD).
enum LiveAuthProbe {
    static func runIfRequested() {
        let env = ProcessInfo.processInfo.environment
        guard env["LOOM_LIVE_AUTH"] == "1" else { return }
        let email = env["LOOM_SMOKE_EMAIL"] ?? "allanthedab+loomsync-smoke@gmail.com"
        let password = env["LOOM_SMOKE_PASSWORD"] ?? "smoke-test-passw0rd-2026"

        Task {
            do {
                try CloudAuth.configure()

                // Wrong password must be rejected before the real sign-in.
                do {
                    try await CloudAuth.signIn(email: email, password: "definitely-wrong")
                    print("LOOM_LIVE_AUTH RESULT: FAIL wrong password was accepted")
                    exit(1)
                } catch {}

                let signedIn = try await CloudAuth.signIn(email: email, password: password)
                let token = try await CloudAuth.idToken()
                let user = try await CloudAuth.currentUser()
                let parts = token.split(separator: ".")

                var payloadB64 = String(parts.count == 3 ? parts[1] : "")
                    .replacingOccurrences(of: "-", with: "+")
                    .replacingOccurrences(of: "_", with: "/")
                while payloadB64.count % 4 != 0 { payloadB64 += "=" }
                let payload = (try? JSONSerialization.jsonObject(
                    with: Data(base64Encoded: payloadB64) ?? Data()
                )) as? [String: Any] ?? [:]
                let issuer = payload["iss"] as? String ?? "?"

                let ok = signedIn
                    && parts.count == 3
                    && issuer == "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_aZaXEizfw"
                    && payload["sub"] as? String == user.sub
                    && user.email == email

                await CloudAuth.signOut()
                let signedOut = await !CloudAuth.isSignedIn()

                if ok && signedOut {
                    print("LOOM_LIVE_AUTH RESULT: PASS sub=\(user.sub) iss=\(issuer)")
                    exit(0)
                } else {
                    print("LOOM_LIVE_AUTH RESULT: FAIL signedIn=\(signedIn) parts=\(parts.count) iss=\(issuer) signedOut=\(signedOut)")
                    exit(1)
                }
            } catch {
                print("LOOM_LIVE_AUTH RESULT: FAIL \(error)")
                exit(1)
            }
        }
    }
}
#endif
