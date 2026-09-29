// Offline OCR of an already captured screenshot. No screen capture or input.
import Foundation
import Vision

guard CommandLine.arguments.count == 2 else { exit(2) }
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US"]
do {
    try VNImageRequestHandler(url: url).perform([request])
    let rows: [[String: Any]] = (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        return ["text": candidate.string, "confidence": candidate.confidence,
                "x": box.minX, "y": 1 - box.maxY,
                "width": box.width, "height": box.height]
    }
    let data = try JSONSerialization.data(withJSONObject: rows)
    FileHandle.standardOutput.write(data)
} catch {
    FileHandle.standardError.write(Data("Screenshot OCR failed: \(error)\n".utf8))
    exit(1)
}
