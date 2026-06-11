import Foundation

/// Pure transport for the deployed sync API (infra/lambda/sync_api) — the
/// Swift counterpart of backend-api/services/cloudsync/aws_client.py.
/// No crypto, no DB. `tokenProvider` returns a fresh Cognito id token so the
/// client stays testable with a fake.

public struct ServerRecord: Codable, Equatable, Sendable {
    public var recordId: String
    public var recordType: String
    public var version: Int
    public var lastModified: Int64
    public var tombstone: Bool
    public var ciphertext: String?
    public var nonce: String?

    enum CodingKeys: String, CodingKey {
        case recordId = "record_id"
        case recordType = "record_type"
        case version
        case lastModified = "last_modified"
        case tombstone
        case ciphertext
        case nonce
    }

    public init(recordId: String, recordType: String, version: Int,
                lastModified: Int64, tombstone: Bool = false,
                ciphertext: String? = nil, nonce: String? = nil) {
        self.recordId = recordId
        self.recordType = recordType
        self.version = version
        self.lastModified = lastModified
        self.tombstone = tombstone
        self.ciphertext = ciphertext
        self.nonce = nonce
    }
}

public struct VaultInfo: Codable, Equatable, Sendable {
    public var wrappedDek: String
    public var salt: String
    public var kdfParams: Vault.KDFParams

    enum CodingKeys: String, CodingKey {
        case wrappedDek = "wrapped_dek"
        case salt
        case kdfParams = "kdf_params"
    }

    public init(wrappedDek: String, salt: String, kdfParams: Vault.KDFParams) {
        self.wrappedDek = wrappedDek
        self.salt = salt
        self.kdfParams = kdfParams
    }
}

public struct PutResult: Codable, Equatable, Sendable {
    public var version: Int
    public init(version: Int) { self.version = version }
}

public enum SyncAPIError: Error {
    /// PUT rejected by the server's optimistic-concurrency check.
    case versionConflict(recordId: String, currentVersion: Int?)
    case http(status: Int, body: String)
    case invalidResponse
}

public protocol SyncAPIClient: Sendable {
    /// nil when the vault has never been initialized.
    func vaultInfo() async throws -> VaultInfo?
    /// true when this call created the vault (201); false when it already existed (409).
    func vaultInit(wrappedDek: String, salt: String,
                   kdfParams: Vault.KDFParams, deviceId: String) async throws -> Bool
    /// All records modified after `sinceMs`, across pages.
    func recordsSince(_ sinceMs: Int64) async throws -> [ServerRecord]
    func getRecord(_ recordId: String) async throws -> ServerRecord?
    func putRecord(_ recordId: String, ciphertext: String, nonce: String,
                   recordType: String, expectedVersion: Int,
                   deviceId: String) async throws -> PutResult
    func deleteRecord(_ recordId: String) async throws -> PutResult
}

public final class CloudAPIClient: SyncAPIClient {
    public static let productionBaseURL = URL(string: "https://03ouv0xgzb.execute-api.us-east-1.amazonaws.com")!

    private let baseURL: URL
    private let tokenProvider: @Sendable () async throws -> String
    private let session: URLSession

    public init(
        baseURL: URL = CloudAPIClient.productionBaseURL,
        session: URLSession = .shared,
        tokenProvider: @escaping @Sendable () async throws -> String
    ) {
        self.baseURL = baseURL
        self.session = session
        self.tokenProvider = tokenProvider
    }

    private func request(
        _ method: String, _ path: String,
        query: [URLQueryItem]? = nil, body: [String: Any]? = nil
    ) async throws -> (Int, Data) {
        var components = URLComponents(
            url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false
        )!
        if let query { components.queryItems = query }
        var req = URLRequest(url: components.url!, timeoutInterval: 20)
        req.httpMethod = method
        req.setValue("Bearer \(try await tokenProvider())", forHTTPHeaderField: "Authorization")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw SyncAPIError.invalidResponse }
        return (http.statusCode, data)
    }

    public func vaultInfo() async throws -> VaultInfo? {
        let (status, data) = try await request("GET", "/vault/info")
        if status == 404 { return nil }
        guard status == 200 else {
            throw SyncAPIError.http(status: status, body: String(decoding: data, as: UTF8.self))
        }
        return try JSONDecoder().decode(VaultInfo.self, from: data)
    }

    public func vaultInit(wrappedDek: String, salt: String,
                          kdfParams: Vault.KDFParams, deviceId: String) async throws -> Bool {
        let (status, data) = try await request("POST", "/vault/init", body: [
            "wrapped_dek": wrappedDek,
            "salt": salt,
            "kdf_params": ["n": kdfParams.n, "r": kdfParams.r, "p": kdfParams.p],
            "device_id": deviceId,
        ])
        guard status == 201 || status == 409 else {
            throw SyncAPIError.http(status: status, body: String(decoding: data, as: UTF8.self))
        }
        return status == 201
    }

    public func recordsSince(_ sinceMs: Int64) async throws -> [ServerRecord] {
        struct Page: Codable {
            var records: [ServerRecord]
            var nextCursor: String?
            enum CodingKeys: String, CodingKey {
                case records
                case nextCursor = "next_cursor"
            }
        }
        var all: [ServerRecord] = []
        var cursor: String? = nil
        repeat {
            var query = [
                URLQueryItem(name: "since", value: String(sinceMs)),
                URLQueryItem(name: "limit", value: "200"),
            ]
            if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
            let (status, data) = try await request("GET", "/records", query: query)
            guard status == 200 else {
                throw SyncAPIError.http(status: status, body: String(decoding: data, as: UTF8.self))
            }
            let page = try JSONDecoder().decode(Page.self, from: data)
            all.append(contentsOf: page.records)
            cursor = page.nextCursor
        } while cursor != nil
        return all
    }

    public func getRecord(_ recordId: String) async throws -> ServerRecord? {
        let (status, data) = try await request("GET", "/records/\(recordId)")
        if status == 404 { return nil }
        guard status == 200 else {
            throw SyncAPIError.http(status: status, body: String(decoding: data, as: UTF8.self))
        }
        return try JSONDecoder().decode(ServerRecord.self, from: data)
    }

    public func putRecord(_ recordId: String, ciphertext: String, nonce: String,
                          recordType: String, expectedVersion: Int,
                          deviceId: String) async throws -> PutResult {
        let (status, data) = try await request("PUT", "/records/\(recordId)", body: [
            "ciphertext": ciphertext,
            "nonce": nonce,
            "type": recordType,
            "expected_version": expectedVersion,
            "device_id": deviceId,
        ])
        if status == 409 {
            let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw SyncAPIError.versionConflict(
                recordId: recordId, currentVersion: body?["current_version"] as? Int
            )
        }
        guard status == 200 else {
            throw SyncAPIError.http(status: status, body: String(decoding: data, as: UTF8.self))
        }
        return try JSONDecoder().decode(PutResult.self, from: data)
    }

    public func deleteRecord(_ recordId: String) async throws -> PutResult {
        let (status, data) = try await request("DELETE", "/records/\(recordId)")
        guard status == 200 else {
            throw SyncAPIError.http(status: status, body: String(decoding: data, as: UTF8.self))
        }
        return try JSONDecoder().decode(PutResult.self, from: data)
    }
}
