#if DEBUG
import Foundation
import LoomKit

/// Live-verification harness for the sync engine against the deployed AWS
/// API, run inside the real app (same keychain constraint as LiveAuthProbe).
///
///     SIMCTL_CHILD_LOOM_LIVE_SYNC=1 xcrun simctl launch --console booted com.loomassist.ios
///
/// Flow: SRP sign-in → fetch vault info → derive KEK from the smoke
/// password → unwrap DEK (wire format: nonce(12) || ciphertext+tag) →
/// clone A pulls whatever the vault holds → A creates an event → A pushes →
/// fresh clone B pulls and must see A's event → A tombstones it (cleanup) →
/// B pulls the tombstone. Prints `LOOM_LIVE_SYNC RESULT: PASS|FAIL` and exits.
///
/// Three-clone gate hooks (infra/three_clone_test.py drives these):
/// - LOOM_EXPECT_TITLE: clone A must have pulled an event with this title
///   (proves desktop-written records arrive on iOS).
/// - LOOM_KEEP_EVENT=1: skip the tombstone cleanup so the desktop side can
///   assert it sees the iOS-created event. Prints `created_title=…`.
/// - LOOM_EXPECT_ABSENT_TITLE: fresh-clone mode — after one pull, no live
///   event with this title may exist (tombstoned server-side records never
///   materialize on a brand-new device).
enum LiveSyncProbe {
    static func runIfRequested() {
        let env = ProcessInfo.processInfo.environment
        guard env["LOOM_LIVE_SYNC"] == "1" else { return }
        let email = env["LOOM_SMOKE_EMAIL"] ?? "allanthedab+loomsync-smoke@gmail.com"
        let password = env["LOOM_SMOKE_PASSWORD"] ?? "smoke-test-passw0rd-2026"

        Task {
            do {
                try CloudAuth.configure()
                try await CloudAuth.signIn(email: email, password: password)
                let client = CloudAPIClient { try await CloudAuth.idToken() }

                guard let info = try await client.vaultInfo() else {
                    print("LOOM_LIVE_SYNC RESULT: FAIL vault not initialized server-side")
                    exit(1)
                }
                let kek = try Vault.deriveKEK(
                    password: password,
                    salt: Data(base64Encoded: info.salt)!,
                    params: info.kdfParams
                )
                let blob = Data(base64Encoded: info.wrappedDek)!
                let dek = try Vault.unwrapDEK(
                    wrapped: blob.dropFirst(12), nonce: blob.prefix(12), kek: kek
                )
                print("LOOM_LIVE_SYNC: vault unlocked (scrypt n=\(info.kdfParams.n))")

                // Clone A: pull existing state, then create + push a probe event.
                let dbA = try AppDatabase.inMemory()
                let engineA = SyncEngine(db: dbA, client: client, dek: dek,
                                         deviceId: "ios_probe_a")
                let first = try await engineA.run()
                print("LOOM_LIVE_SYNC: A first cycle pull=\(first.pull) push=\(first.push)")

                if let absentTitle = env["LOOM_EXPECT_ABSENT_TITLE"] {
                    let exists = try await dbA.writer.read { db in
                        try Bool.fetchOne(
                            db,
                            sql: "SELECT EXISTS(SELECT 1 FROM event WHERE title = ? AND deleted_at IS NULL)",
                            arguments: [absentTitle]
                        ) ?? false
                    }
                    if exists {
                        print("LOOM_LIVE_SYNC RESULT: FAIL tombstoned record materialized on fresh clone: \(absentTitle)")
                    } else {
                        print("LOOM_LIVE_SYNC RESULT: PASS fresh clone has no live \"\(absentTitle)\"")
                    }
                    exit(exists ? 1 : 0)
                }

                if let expectTitle = env["LOOM_EXPECT_TITLE"] {
                    let seen = try await dbA.writer.read { db in
                        try Bool.fetchOne(
                            db,
                            sql: "SELECT EXISTS(SELECT 1 FROM event WHERE title = ? AND deleted_at IS NULL)",
                            arguments: [expectTitle]
                        ) ?? false
                    }
                    guard seen else {
                        print("LOOM_LIVE_SYNC RESULT: FAIL expected desktop event not pulled: \(expectTitle)")
                        exit(1)
                    }
                    print("LOOM_LIVE_SYNC: pulled expected desktop event \"\(expectTitle)\"")
                }

                let probeTitle = "iOS sync probe \(UUID().uuidString.prefix(8))"
                let nowISO = SyncEngine.isoNow()
                try await dbA.writer.write { db in
                    var calendarId = try Int64.fetchOne(
                        db, sql: "SELECT id FROM calendar WHERE deleted_at IS NULL ORDER BY id LIMIT 1"
                    )
                    if calendarId == nil {
                        var cal = LoomCalendar(name: "iOS Probe", lastModified: nowISO)
                        try cal.insert(db)
                        calendarId = cal.id
                    }
                    var event = LoomEvent(
                        title: probeTitle,
                        startTime: "2026-06-12T09:00:00", endTime: "2026-06-12T10:00:00",
                        calendarId: calendarId!, lastModified: nowISO
                    )
                    try event.insert(db)
                }
                let pushCycle = try await engineA.run()
                print("LOOM_LIVE_SYNC: A push cycle push=\(pushCycle.push)")
                guard (pushCycle.push["pushed"] ?? 0) >= 1 else {
                    print("LOOM_LIVE_SYNC RESULT: FAIL push cycle sent nothing")
                    exit(1)
                }

                // Clone B: fresh DB must receive A's event through the cloud.
                let dbB = try AppDatabase.inMemory()
                let engineB = SyncEngine(db: dbB, client: client, dek: dek,
                                         deviceId: "ios_probe_b")
                _ = try await engineB.run()
                let seenByB = try await dbB.writer.read { db in
                    try Bool.fetchOne(db, sql: "SELECT EXISTS(SELECT 1 FROM event WHERE title = ?)",
                                      arguments: [probeTitle]) ?? false
                }

                if env["LOOM_KEEP_EVENT"] == "1" {
                    if seenByB {
                        print("LOOM_LIVE_SYNC: created_title=\(probeTitle)")
                        print("LOOM_LIVE_SYNC RESULT: PASS kept event for desktop-side assertion")
                        exit(0)
                    } else {
                        print("LOOM_LIVE_SYNC RESULT: FAIL clone B never saw \(probeTitle)")
                        exit(1)
                    }
                }

                // Cleanup: A tombstones the probe event; B applies the tombstone.
                try await dbA.writer.write { db in
                    try db.execute(
                        sql: "UPDATE event SET deleted_at = ?, last_modified = ? WHERE title = ?",
                        arguments: [SyncEngine.isoNow(), SyncEngine.isoNow(), probeTitle]
                    )
                }
                let cleanup = try await engineA.run()
                _ = try await engineB.run()
                let deletedAtB = try await dbB.writer.read { db in
                    try String.fetchOne(db, sql: "SELECT deleted_at FROM event WHERE title = ?",
                                        arguments: [probeTitle])
                }

                if seenByB && (cleanup.push["deleted"] ?? 0) >= 1 && deletedAtB != nil {
                    print("LOOM_LIVE_SYNC RESULT: PASS round-trip + tombstone via live API")
                    exit(0)
                } else {
                    print("LOOM_LIVE_SYNC RESULT: FAIL seenByB=\(seenByB) cleanupDeleted=\(cleanup.push["deleted"] ?? 0) tombstoneAppliedB=\(deletedAtB != nil)")
                    exit(1)
                }
            } catch {
                print("LOOM_LIVE_SYNC RESULT: FAIL \(error)")
                exit(1)
            }
        }
    }
}
#endif
