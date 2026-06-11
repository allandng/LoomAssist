import Foundation
import WhisperKit

/// On-device speech-to-text via WhisperKit — the iOS counterpart of the
/// desktop's Faster-Whisper (base.en) usage. The CoreML model (~150 MB)
/// downloads on first use and is cached by WhisperKit; keep one instance
/// alive so the model loads once per process.
public final class WhisperTranscriber {
    public static let defaultModel = "base.en"

    private var whisperKit: WhisperKit?
    private let modelName: String

    public init(model: String = WhisperTranscriber.defaultModel) {
        self.modelName = model
    }

    public var isModelLoaded: Bool { whisperKit != nil }

    /// Transcribe a local audio file. `onStatus` receives coarse progress
    /// strings for the capture UI ("Preparing model…", "Transcribing…").
    public func transcribe(
        audioPath: String,
        onStatus: (@Sendable (String) -> Void)? = nil
    ) async throws -> String {
        if whisperKit == nil {
            onStatus?("Preparing transcription model…")
            whisperKit = try await WhisperKit(model: modelName)
        }
        onStatus?("Transcribing…")
        let results = try await whisperKit!.transcribe(audioPath: audioPath)
        return results
            .map(\.text)
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
