import SwiftUI
import AVFoundation
import LoomKit

/// Voice → event capture: record → on-device Whisper transcription →
/// on-device intent parsing → editable confirmation → create. Everything
/// stays local; the privacy line below the mic is the product's standing
/// reassurance beat.
struct VoiceCaptureSheet: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss

    enum Phase: Equatable {
        case idle
        case denied
        case recording
        case working(String)
        case review
        case failed(String)
    }

    @State private var phase: Phase = .idle
    @State private var recorder = VoiceRecorder()
    @State private var transcript = ""
    @State private var title = ""
    @State private var start: Date = .now
    @State private var end: Date = .now
    @State private var parserSource: EventDraft.Source = .dateDetector

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(LoomColor.border)
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            if phase == .review { footer }
        }
        .background(LoomColor.bgPanel)
        .presentationDetents([.medium, .large])
        .presentationCornerRadius(LoomRadius.xxl)
        .onDisappear { recorder.stop() }
    }

    private var header: some View {
        HStack {
            Text("Voice capture")
                .font(LoomFont.title)
                .foregroundStyle(LoomColor.textMain)
            Spacer()
            // FLAGGED: SF Symbol approximation of the stroke-set × glyph
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(LoomColor.textMuted)
                    .frame(width: LoomSpace.minTapTarget, height: LoomSpace.minTapTarget)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, LoomSpace.s7)
        .padding(.vertical, LoomSpace.s4)
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .idle, .denied, .recording:
            VStack(spacing: LoomSpace.s6) {
                Button(action: toggleRecording) {
                    // FLAGGED: SF Symbol approximation of the stroke-set mic glyph
                    Image(systemName: phase == .recording ? "stop.fill" : "mic.fill")
                        .font(.system(size: 28, weight: .medium))
                        .foregroundStyle(LoomColor.onAccent)
                        .frame(width: 88, height: 88)
                        .background(phase == .recording ? LoomColor.error : LoomColor.accent)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)

                Text(phase == .recording
                     ? "Listening — tap to finish"
                     : #"Try: "Lunch with Sam on Friday at noon""#)
                    .font(LoomFont.secondary)
                    .foregroundStyle(LoomColor.textMuted)

                if phase == .denied {
                    Text("Microphone access is off. Enable it in Settings to capture by voice.")
                        .font(LoomFont.secondary)
                        .foregroundStyle(LoomColor.error)
                        .multilineTextAlignment(.center)
                }

                Text("Nothing about your calendar leaves this device.")
                    .font(LoomFont.monoSmall)
                    .foregroundStyle(LoomColor.textDim)
            }
            .padding(LoomSpace.s7)

        case .working(let status):
            VStack(spacing: LoomSpace.s5) {
                ProgressView().tint(LoomColor.accent)
                Text(status)
                    .font(LoomFont.secondary)
                    .foregroundStyle(LoomColor.textMuted)
            }

        case .review:
            ScrollView {
                VStack(alignment: .leading, spacing: LoomSpace.s7) {
                    VStack(alignment: .leading, spacing: LoomSpace.s3) {
                        Text("Heard").loomLabelStyle()
                        Text("“\(transcript)”")
                            .font(LoomFont.secondary)
                            .foregroundStyle(LoomColor.textMuted)
                    }
                    field("Title") {
                        TextField("Event title", text: $title)
                            .font(LoomFont.body)
                            .foregroundStyle(LoomColor.textMain)
                            .padding(12)
                            .frame(minHeight: LoomSpace.minTapTarget)
                            .background(LoomColor.bgSubtle)
                            .clipShape(RoundedRectangle(cornerRadius: LoomRadius.md, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: LoomRadius.md, style: .continuous)
                                    .stroke(LoomColor.border, lineWidth: 1)
                            )
                    }
                    field("Starts") {
                        DatePicker("", selection: $start).labelsHidden().tint(LoomColor.accent)
                    }
                    field("Ends") {
                        DatePicker("", selection: $end, in: start...).labelsHidden().tint(LoomColor.accent)
                    }
                    Text(parserSource == .appleIntelligence
                         ? "Parsed with on-device intelligence"
                         : "Parsed with basic date detection")
                        .font(LoomFont.monoSmall)
                        .foregroundStyle(LoomColor.textDim)
                }
                .padding(LoomSpace.s7)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

        case .failed(let message):
            VStack(spacing: LoomSpace.s5) {
                Text(message)
                    .font(LoomFont.secondary)
                    .foregroundStyle(LoomColor.error)
                    .multilineTextAlignment(.center)
                Button("Try again") { phase = .idle }
                    .font(LoomFont.control)
                    .foregroundStyle(LoomColor.accent)
                    .frame(minHeight: LoomSpace.minTapTarget)
            }
            .padding(LoomSpace.s7)
        }
    }

    private var footer: some View {
        HStack {
            Button("Discard") { dismiss() }
                .font(LoomFont.control.weight(.medium))
                .foregroundStyle(LoomColor.textMuted)
                .frame(minHeight: LoomSpace.minTapTarget)
                .buttonStyle(.plain)
            Spacer()
            Button {
                store.createEvent(title: title, start: start, end: end)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                dismiss()
            } label: {
                Text("Add event")
                    .font(LoomFont.control)
                    .foregroundStyle(LoomColor.onAccent)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(LoomColor.accent)
                    .clipShape(RoundedRectangle(cornerRadius: LoomRadius.lg, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(.horizontal, LoomSpace.s7)
        .padding(.vertical, LoomSpace.s5)
        .background(LoomColor.bgSubtle)
        .overlay(alignment: .top) { Rectangle().fill(LoomColor.border).frame(height: 1) }
    }

    @ViewBuilder
    private func field(_ label: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: LoomSpace.s3) {
            Text(label).loomLabelStyle()
            content()
        }
    }

    private func toggleRecording() {
        if phase == .recording {
            recorder.stop()
            transcribeAndParse()
        } else {
            Task {
                if await recorder.start() {
                    phase = .recording
                } else {
                    phase = .denied
                }
            }
        }
    }

    private func transcribeAndParse() {
        phase = .working("Transcribing…")
        Task {
            do {
                let text = try await store.transcriber.transcribe(
                    audioPath: recorder.fileURL.path
                ) { status in
                    Task { @MainActor in phase = .working(status) }
                }
                guard !text.isEmpty else {
                    phase = .failed("Didn't catch that — try again a little louder.")
                    return
                }
                transcript = text
                phase = .working("Understanding…")
                guard let draft = await VoiceEventParser.parse(text) else {
                    phase = .failed("Couldn't make an event out of “\(text)”.")
                    return
                }
                title = draft.title
                start = draft.start
                end = draft.end
                parserSource = draft.source
                phase = .review
            } catch {
                phase = .failed("Transcription failed: \(error.localizedDescription)")
            }
        }
    }
}

/// 16 kHz mono PCM recorder — the format Whisper models expect.
final class VoiceRecorder {
    private var recorder: AVAudioRecorder?
    let fileURL = FileManager.default.temporaryDirectory
        .appendingPathComponent("loom_voice_capture.wav")

    func start() async -> Bool {
        guard await AVAudioApplication.requestRecordPermission() else { return false }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .spokenAudio)
            try session.setActive(true)
            recorder = try AVAudioRecorder(url: fileURL, settings: [
                AVFormatIDKey: Int(kAudioFormatLinearPCM),
                AVSampleRateKey: 16_000.0,
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false,
            ])
            return recorder?.record() ?? false
        } catch {
            return false
        }
    }

    func stop() {
        recorder?.stop()
        recorder = nil
        try? AVAudioSession.sharedInstance().setActive(false)
    }
}
