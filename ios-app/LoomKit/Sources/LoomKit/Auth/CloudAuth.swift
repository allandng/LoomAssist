import Foundation
import Amplify
import AWSCognitoAuthPlugin
import AWSPluginsCore

/// Cognito identity for the sync layer — the Swift counterpart of the
/// desktop's pycognito usage (services/cloudsync/session.py).
///
/// Auth flow is USER_SRP_AUTH: the password never transits, matching the
/// roadmap §4 requirement that Cognito's stored verifier can't derive the
/// vault KEK. Amplify's Cognito plugin persists tokens in the device
/// Keychain and refreshes them transparently, so `idToken()` is always
/// usable as the API `Authorization` bearer.
///
/// Pool/client ids are deploy-time constants (CDK stack outputs), not
/// secrets — same values as session.py.
public enum CloudAuth {
    public struct Config: Sendable, Equatable {
        public var poolId: String
        public var clientId: String
        public var region: String

        public init(poolId: String, clientId: String, region: String) {
            self.poolId = poolId
            self.clientId = clientId
            self.region = region
        }

        public static let production = Config(
            poolId: "us-east-1_aZaXEizfw",
            clientId: "582l8iu4gp700j37p166eihjqb",
            region: "us-east-1"
        )
    }

    public enum CloudAuthError: Error, Equatable {
        case notSignedIn
        case tokensUnavailable
        case service(String)
    }

    private static let configureLock = NSLock()
    private nonisolated(unsafe) static var configured = false

    /// Idempotent — Amplify tolerates exactly one configure per process.
    public static func configure(_ config: Config = .production) throws {
        configureLock.lock()
        defer { configureLock.unlock() }
        guard !configured else { return }

        try Amplify.add(plugin: AWSCognitoAuthPlugin())
        let pluginConfig: JSONValue = [
            "CognitoUserPool": [
                "Default": [
                    "PoolId": .string(config.poolId),
                    "AppClientId": .string(config.clientId),
                    "Region": .string(config.region),
                ],
            ],
            "Auth": [
                "Default": [
                    "authenticationFlowType": "USER_SRP_AUTH",
                ],
            ],
        ]
        let authConfig = AuthCategoryConfiguration(plugins: ["awsCognitoAuthPlugin": pluginConfig])
        try Amplify.configure(AmplifyConfiguration(auth: authConfig))
        configured = true
    }

    // MARK: - Session lifecycle

    /// SRP sign-in. Returns true when fully signed in (no MFA/confirmation
    /// step pending — none are configured on this pool).
    @discardableResult
    public static func signIn(email: String, password: String) async throws -> Bool {
        // A signed-in session (possibly another user's) blocks signIn.
        if await isSignedIn() {
            await signOut()
        }
        do {
            let result = try await Amplify.Auth.signIn(username: email, password: password)
            return result.isSignedIn
        } catch let error as AuthError {
            throw CloudAuthError.service(error.errorDescription)
        }
    }

    public static func signOut() async {
        _ = await Amplify.Auth.signOut()
    }

    public static func isSignedIn() async -> Bool {
        (try? await Amplify.Auth.fetchAuthSession().isSignedIn) ?? false
    }

    // MARK: - Tokens & identity

    /// Fresh Cognito id token for the sync API's `Authorization` header.
    /// Amplify refreshes via the stored refresh token when expired — the
    /// counterpart of pycognito's `check_token()`.
    public static func idToken() async throws -> String {
        let session = try await Amplify.Auth.fetchAuthSession()
        guard session.isSignedIn else { throw CloudAuthError.notSignedIn }
        guard let provider = session as? AuthCognitoTokensProvider,
              let tokens = try? provider.getCognitoTokens().get() else {
            throw CloudAuthError.tokensUnavailable
        }
        return tokens.idToken
    }

    /// Cognito `sub` (stable user id) + email, for CloudSyncConfig.
    public static func currentUser() async throws -> (sub: String, email: String?) {
        guard await isSignedIn() else { throw CloudAuthError.notSignedIn }
        let user = try await Amplify.Auth.getCurrentUser()
        let attributes = (try? await Amplify.Auth.fetchUserAttributes()) ?? []
        let email = attributes.first(where: { $0.key == .email })?.value
        return (sub: user.userId, email: email)
    }
}
