import Foundation
import CryptoKit
import Clibsodium

/// KEK/DEK primitives + per-record AES-256-GCM. Byte-compatible port of the
/// desktop's backend-api/services/crypto/vault.py:
///
///     password ──scrypt(salt)──▶ KEK ──AES-GCM──▶ wraps DEK (stored on server)
///                                                        │
///                                                        └─AES-GCM──▶ each record
///
/// Wire conventions shared with the desktop:
/// - GCM ciphertext carries the 16-byte tag APPENDED (Python `cryptography`
///   layout). CryptoKit keeps ciphertext/tag separate; we join and split here.
/// - Nonces are 12 random bytes, fresh per encrypt call. No base64 here —
///   raw bytes in, raw bytes out; the sync layer owns encoding.
/// - Decrypt failures throw `VaultError.decryptFailed` (the counterpart of
///   vault.py translating InvalidTag to ValueError).
///
/// scrypt comes from libsodium's `crypto_pwhash_scryptsalsa208sha256_ll` —
/// standard scrypt with explicit N/r/p. CryptoKit has no scrypt; this is the
/// CryptoKit-plus-libsodium split the Stage 3 plan called out.
public enum Vault {
    public static let keyLength = 32
    public static let dekLength = 32
    public static let nonceLength = 12
    public static let gcmTagLength = 16
    public static let minSaltLength = 16

    /// KDF parameters. These travel with the vault (`GET /vault/info` returns
    /// `kdf_params`), so the client honors whatever the vault was created
    /// with rather than assuming the current defaults.
    public struct KDFParams: Codable, Equatable, Sendable {
        public var n: UInt64
        public var r: UInt32
        public var p: UInt32

        public init(n: UInt64 = 1 << 17, r: UInt32 = 8, p: UInt32 = 1) {
            self.n = n
            self.r = r
            self.p = p
        }
    }

    public enum VaultError: Error, Equatable {
        case saltTooShort(minimum: Int)
        case badKeyLength(expected: Int)
        case badNonceLength(expected: Int)
        case kdfFailed
        case decryptFailed
    }

    // MARK: - KDF

    public static func deriveKEK(
        password: String, salt: Data, params: KDFParams = KDFParams()
    ) throws -> Data {
        guard salt.count >= minSaltLength else {
            throw VaultError.saltTooShort(minimum: minSaltLength)
        }
        let passwordBytes = Array(password.utf8)
        var kek = Data(count: keyLength)
        let rc = kek.withUnsafeMutableBytes { kekPtr in
            salt.withUnsafeBytes { saltPtr in
                crypto_pwhash_scryptsalsa208sha256_ll(
                    passwordBytes, passwordBytes.count,
                    saltPtr.bindMemory(to: UInt8.self).baseAddress!, salt.count,
                    params.n, params.r, params.p,
                    kekPtr.bindMemory(to: UInt8.self).baseAddress!, keyLength
                )
            }
        }
        guard rc == 0 else { throw VaultError.kdfFailed }
        return kek
    }

    // MARK: - Random material

    public static func generateSalt() -> Data {
        Data(SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) })
    }

    public static func generateDEK() -> Data {
        Data(SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) })
    }

    // MARK: - DEK wrap

    public static func wrapDEK(_ dek: Data, kek: Data) throws -> (wrapped: Data, nonce: Data) {
        guard dek.count == dekLength else { throw VaultError.badKeyLength(expected: dekLength) }
        return try encrypt(plaintext: dek, key: kek)
    }

    public static func unwrapDEK(wrapped: Data, nonce: Data, kek: Data) throws -> Data {
        try decrypt(ciphertext: wrapped, nonce: nonce, key: kek)
    }

    // MARK: - Records

    public static func encryptRecord(_ plaintext: Data, dek: Data) throws -> (ciphertext: Data, nonce: Data) {
        try encrypt(plaintext: plaintext, key: dek)
    }

    public static func decryptRecord(ciphertext: Data, nonce: Data, dek: Data) throws -> Data {
        try decrypt(ciphertext: ciphertext, nonce: nonce, key: dek)
    }

    // MARK: - AES-256-GCM core (tag appended, desktop layout)

    private static func encrypt(plaintext: Data, key: Data) throws -> (Data, Data) {
        guard key.count == keyLength else { throw VaultError.badKeyLength(expected: keyLength) }
        var nonceBytes = Data(count: nonceLength)
        nonceBytes.withUnsafeMutableBytes { ptr in
            randombytes_buf(ptr.baseAddress!, nonceLength)
        }
        let nonce = try AES.GCM.Nonce(data: nonceBytes)
        let box = try AES.GCM.seal(plaintext, using: SymmetricKey(data: key), nonce: nonce)
        return (box.ciphertext + box.tag, nonceBytes)
    }

    private static func decrypt(ciphertext: Data, nonce: Data, key: Data) throws -> Data {
        guard key.count == keyLength else { throw VaultError.badKeyLength(expected: keyLength) }
        guard nonce.count == nonceLength else { throw VaultError.badNonceLength(expected: nonceLength) }
        guard ciphertext.count >= gcmTagLength else { throw VaultError.decryptFailed }
        let tag = ciphertext.suffix(gcmTagLength)
        let body = ciphertext.prefix(ciphertext.count - gcmTagLength)
        do {
            let box = try AES.GCM.SealedBox(
                nonce: AES.GCM.Nonce(data: nonce), ciphertext: body, tag: tag
            )
            return try AES.GCM.open(box, using: SymmetricKey(data: key))
        } catch {
            throw VaultError.decryptFailed
        }
    }
}
