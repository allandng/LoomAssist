#if DEBUG
import Foundation
import LoomKit

/// Live-verification harness for the voice → event pipeline:
/// real WhisperKit transcription of a (synthesized) speech file → intent
/// parsing → event row in the store.
///
///     say -o /tmp/loom_voice.aiff "Schedule lunch with Sam on Friday at noon"
///     afconvert -f WAVE -d LEI16@16000 -c 1 /tmp/loom_voice.aiff /tmp/loom_voice_test.wav
///     SIMCTL_CHILD_LOOM_LIVE_VOICE=1 SIMCTL_CHILD_LOOM_VOICE_AUDIO=/tmp/loom_voice_test.wav \
///         xcrun simctl launch --console booted com.loomassist.ios
///
/// First run downloads the Whisper base.en CoreML model (~150 MB).
/// Prints `LOOM_LIVE_VOICE RESULT: PASS|FAIL` and exits.
enum LiveVoiceProbe {
    static func runIfRequested() {
        let env = ProcessInfo.processInfo.environment
        guard env["LOOM_LIVE_VOICE"] == "1" else { return }
        let audioPath = env["LOOM_VOICE_AUDIO"] ?? "/tmp/loom_voice_test.wav"

        Task {
            do {
                guard FileManager.default.fileExists(atPath: audioPath) else {
                    print("LOOM_LIVE_VOICE RESULT: FAIL no audio at \(audioPath)")
                    exit(1)
                }
                let transcriber = WhisperTranscriber()
                let transcript = try await transcriber.transcribe(audioPath: audioPath) {
                    print("LOOM_LIVE_VOICE: \($0)")
                }
                print("LOOM_LIVE_VOICE: transcript=\"\(transcript)\"")
                guard transcript.lowercased().contains("lunch") else {
                    print("LOOM_LIVE_VOICE RESULT: FAIL transcript missed 'lunch'")
                    exit(1)
                }

                print("LOOM_LIVE_VOICE: smartParserAvailable=\(VoiceEventParser.smartParserAvailable)")
                guard let draft = await VoiceEventParser.parse(transcript) else {
                    print("LOOM_LIVE_VOICE RESULT: FAIL parser returned nil")
                    exit(1)
                }
                print("LOOM_LIVE_VOICE: draft title=\"\(draft.title)\" start=\(draft.start) source=\(draft.source.rawValue)")

                let db = try AppDatabase.inMemory()
                let eventId = try LocalEdits.createEvent(
                    db, title: draft.title,
                    startTime: LocalEdits.localISO(draft.start),
                    endTime: LocalEdits.localISO(draft.end)
                )
                let saved = try await db.writer.read { txn in
                    try LoomEvent.fetchOne(txn, key: eventId)
                }
                let cal = Foundation.Calendar.current
                let titleOK = saved?.title.lowercased().contains("lunch") == true
                let hourOK = cal.component(.hour, from: draft.start) == 12
                // The audio says "Friday" — weekday 6. The smart parser must
                // resolve the name to a real Friday; the fallback detector is
                // held to the same bar (NSDataDetector resolves weekdays).
                let fridayOK = cal.component(.weekday, from: draft.start) == 6
                let futureOK = draft.start > Date()

                if titleOK && hourOK && fridayOK && futureOK {
                    print("LOOM_LIVE_VOICE RESULT: PASS event=\"\(saved!.title)\" start=\(LocalEdits.localISO(draft.start)) parser=\(draft.source.rawValue)")
                    exit(0)
                } else {
                    print("LOOM_LIVE_VOICE RESULT: FAIL title=\(titleOK) noon=\(hourOK) friday=\(fridayOK) future=\(futureOK) start=\(LocalEdits.localISO(draft.start))")
                    exit(1)
                }
            } catch {
                print("LOOM_LIVE_VOICE RESULT: FAIL \(error)")
                exit(1)
            }
        }
    }
}
#endif
