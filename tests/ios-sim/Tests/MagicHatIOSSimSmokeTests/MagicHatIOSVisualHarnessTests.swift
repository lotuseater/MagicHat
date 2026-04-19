#if canImport(UIKit)
import SwiftUI
import UIKit
import XCTest
import MagicHatIOSCore

@MainActor
final class MagicHatIOSVisualHarnessTests: XCTestCase {
    private let screenshotSize = CGSize(width: 393, height: 852)

    func testCaptureLaunchPairingScreen() async throws {
        let store = await preparedStore(for: .launch)
        try captureScreenshot(named: "01_launch_pairing", store: store, tab: .pair)
    }

    func testCaptureConnectedPairingScreen() async throws {
        let store = await preparedStore(for: .connected)
        try captureScreenshot(named: "02_pairing_connected", store: store, tab: .pair)
    }

    func testCaptureConnectedInstanceShell() async throws {
        let store = await preparedStore(for: .connected)
        try captureScreenshot(named: "03_connected_instances", store: store, tab: .instances)
    }

    func testCapturePromptComposerScreen() async throws {
        let store = await preparedStore(for: .connected) { store in
            await store.submitPrompt("Capture the visual baseline before polishing the iOS flow.")
            await store.submitFollowUp("Highlight the active screenshot harness state.")
        }
        try captureScreenshot(named: "04_prompt_composer", store: store, tab: .prompts)
    }

    func testCaptureTrustPromptStatusScreen() async throws {
        let store = await preparedStore(for: .trustPrompt)
        try captureScreenshot(named: "05_status_trust_prompt", store: store, tab: .status)
    }

    func testCaptureRestoreFlowScreen() async throws {
        let store = await preparedStore(for: .connected) { store in
            await store.restoreSession(sessionID: "restore_alpha")
        }
        try captureScreenshot(named: "06_restore_flow", store: store, tab: .restore)
    }

    func testCaptureErrorBannerScreen() async throws {
        let store = await preparedStore(for: .errorBanner)
        try captureScreenshot(named: "07_error_banner", store: store, tab: .instances)
    }

    private func preparedStore(
        for scenario: PreviewRuntimeClient.Scenario,
        afterBootstrap: ((FeatureStore) async -> Void)? = nil
    ) async -> FeatureStore {
        let store = FeatureStore(runtime: PreviewRuntimeClient(scenario: scenario))
        await store.bootstrap()
        if let afterBootstrap {
            await afterBootstrap(store)
        }
        try? await Task.sleep(nanoseconds: 150_000_000)
        return store
    }

    private func captureScreenshot(named name: String, store: FeatureStore, tab: MagicHatFeatureTab) throws {
        let image = try renderImage(
            MagicHatFeaturesRootView(store: store, selectedTab: tab, bootstrapOnAppear: false)
        )
        try attach(image: image, named: name)
    }

    private func renderImage<V: View>(_ view: V) throws -> UIImage {
        let content = view
            .frame(width: screenshotSize.width, height: screenshotSize.height)
            .background(Color(uiColor: .systemBackground))

        let frame = CGRect(origin: .zero, size: screenshotSize)
        let controller = UIHostingController(rootView: content)
        controller.view.frame = frame
        controller.view.backgroundColor = .systemBackground

        let window = UIWindow(frame: frame)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()

        let renderer = UIGraphicsImageRenderer(size: screenshotSize)
        let image = renderer.image { _ in
            controller.view.drawHierarchy(in: controller.view.bounds, afterScreenUpdates: true)
        }

        window.isHidden = true
        window.rootViewController = nil

        guard image.size != .zero else {
            throw SnapshotError.failedToRender
        }

        return image
    }

    private func attach(image: UIImage, named name: String) throws {
        guard let data = image.pngData() else {
            throw SnapshotError.failedToEncodePNG
        }

        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("MagicHatIOSVisualHarness", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let fileURL = directory.appendingPathComponent(name).appendingPathExtension("png")
        if FileManager.default.fileExists(atPath: fileURL.path) {
            try FileManager.default.removeItem(at: fileURL)
        }
        try data.write(to: fileURL, options: .atomic)

        let attachment = XCTAttachment(contentsOfFile: fileURL)
        attachment.name = "\(name).png"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

private enum SnapshotError: Error {
    case failedToRender
    case failedToEncodePNG
}
#endif
