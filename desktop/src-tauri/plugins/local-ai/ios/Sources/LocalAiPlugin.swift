import Foundation
import LiteRTLM
import SwiftRs
import Tauri
import UIKit
import WebKit

private let modelName = "gemma-4-E2B-it.litertlm"
private let modelSource = URL(
  string: "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/\(modelName)")!
// ponytail: a size check, not a hash; pin the SHA-256 once this model is settled.
private let smallestModel: Int64 = 2_000_000_000

struct SummarizeArgs: Decodable {
  let id: String
  let prompt: String
}

class LocalAiPlugin: Plugin, URLSessionDownloadDelegate {
  // A background session: 2.6 GB outlasts LAAB being in front.
  private lazy var session = URLSession(
    configuration: .background(withIdentifier: "app.laab.ios.model"),
    delegate: self,
    delegateQueue: nil)
  private var running: Task<Void, Never>?

  private var modelFile: URL {
    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("models", isDirectory: true)
    return dir.appendingPathComponent(modelName)
  }

  override func load(webview: WKWebView) {
    _ = session  // Picks up a download begun before LAAB was last closed.
    // Metal may not be used from the background.
    NotificationCenter.default.addObserver(
      forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
    ) { [weak self] _ in self?.running?.cancel() }
  }

  @objc public func status(_ invoke: Invoke) {
    if FileManager.default.fileExists(atPath: modelFile.path) {
      invoke.resolve(["state": "ready"])
      return
    }
    session.getAllTasks { tasks in
      invoke.resolve(["state": tasks.isEmpty ? "missing" : "downloading"])
    }
  }

  @objc public func download(_ invoke: Invoke) {
    session.getAllTasks { [self] tasks in
      if tasks.isEmpty { session.downloadTask(with: modelSource).resume() }
      invoke.resolve()
    }
  }

  @objc public func summarize(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SummarizeArgs.self)
    guard FileManager.default.fileExists(atPath: modelFile.path) else {
      invoke.reject("the model is not downloaded")
      return
    }
    let path = modelFile.path
    running?.cancel()
    running = Task { [weak self] in
      do {
        // ponytail: loaded per summary and let go, so 1.5 GB of GPU memory
        // isn't held while chatting; keep the engine if the wait annoys.
        // For the token counts shown beside the summary.
        ExperimentalFlags.optIntoExperimentalAPIs()
        ExperimentalFlags.enableBenchmark = true
        let started = Date()
        let config = try EngineConfig(
          modelPath: path, backend: .gpu, cacheDir: NSTemporaryDirectory())
        let engine = Engine(engineConfig: config)
        try await engine.initialize()
        let conversation = try await engine.createConversation()
        let loaded = Date()
        var firstToken: Date?
        var text = ""
        for try await chunk in conversation.sendMessageStream(Message(args.prompt)) {
          try Task.checkCancellation()
          if firstToken == nil { firstToken = Date() }
          text += chunk.toString
          self?.trigger("chunk", data: ["id": args.id, "text": text])
        }
        var result: JSObject = [
          "text": text,
          "loadSeconds": loaded.timeIntervalSince(started),
          "firstTokenSeconds": (firstToken ?? loaded).timeIntervalSince(loaded),
        ]
        if let info = try? conversation.getBenchmarkInfo() {
          result["tokens"] = info.lastDecodeTokenCount
          result["tokensPerSecond"] = info.lastDecodeTokensPerSecond
        }
        invoke.resolve(result)
      } catch {
        invoke.reject(error is CancellationError ? "cancelled" : "\(error)")
      }
    }
  }

  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64
  ) {
    guard totalBytesExpectedToWrite > 0 else { return }
    trigger("progress", data: ["fraction": Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)])
  }

  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL
  ) {
    // The file is gone once this returns, so it moves here.
    do {
      let size = (try FileManager.default.attributesOfItem(atPath: location.path)[.size] as? Int64) ?? 0
      let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
      guard status == 200, size >= smallestModel else {
        throw NSError(domain: "LocalAi", code: status, userInfo: [NSLocalizedDescriptionKey: "HTTP \(status), \(size) bytes"])
      }
      let dir = modelFile.deletingLastPathComponent()
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      try FileManager.default.moveItem(at: location, to: modelFile)
      // Downloadable again, so it stays out of iCloud backups.
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      var file = modelFile
      try file.setResourceValues(values)
      trigger("ready", data: [:])
    } catch {
      trigger("failed", data: ["message": error.localizedDescription])
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let error { trigger("failed", data: ["message": error.localizedDescription]) }
  }
}

@_cdecl("init_plugin_local_ai")
public func initPlugin() -> Plugin {
  return LocalAiPlugin()
}
