/// LoomKit — all non-UI logic for the LoomAssist iOS client.
///
/// The app target stays a thin SwiftUI shell; local store, vault crypto,
/// Cognito auth, and the sync engine all live here so they can be unit-tested
/// with `swift test` on macOS without booting a simulator.
public enum LoomKit {
    public static let version = "0.1.0"

    /// Wire-protocol dialect this client speaks. Must match
    /// `SCHEMA_VERSION` in backend-api/services/cloudsync/engine.py —
    /// records with a different schema_version are skipped, not guessed at.
    public static let syncSchemaVersion = 2
}
