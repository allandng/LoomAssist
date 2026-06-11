import XCTest
@testable import LoomKit

final class LoomKitTests: XCTestCase {
    func testSyncSchemaVersionMatchesProtocolV2() {
        XCTAssertEqual(LoomKit.syncSchemaVersion, 2)
    }
}
