// VOD player: AVPlayerViewController with native HLS, the profile's audio/subtitle languages
// selected via AVMediaSelectionGroup, progress saved every 5 s, a "Taal en bron" transport-bar
// menu to switch StreamVariant while keeping the position, info-panel metadata and a
// "Volgende aflevering" content proposal.

import AVFoundation
import AVKit
import SwiftUI
import os

struct PlayerScreen: UIViewControllerRepresentable {
    let session: PlaybackSession
    @Environment(AppModel.self) private var app

    func makeCoordinator() -> PlayerController {
        PlayerController(session: session, app: app)
    }

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        context.coordinator.makeViewController()
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {}

    static func dismantleUIViewController(_ controller: AVPlayerViewController, coordinator: PlayerController) {
        coordinator.stop()
    }
}

@MainActor
final class PlayerController: NSObject, AVPlayerViewControllerDelegate {
    static let log = Logger(subsystem: "nl.patrickudo.prismastream.tv", category: "player")

    private(set) var session: PlaybackSession
    private let app: AppModel
    private let player = AVPlayer()
    private weak var viewController: AVPlayerViewController?
    private var groups: [LanguageGroup] = []
    private var currentURLIndex = 0
    private var statusObservation: NSKeyValueObservation?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var pendingSeek: Double?
    private var stopped = false
    private var failedVariantIds: Set<String> = []

    private func fallbackVariant() -> StreamVariant? {
        let lang = session.variant.primaryLang
        return session.variants
            .filter { $0.id != session.variant.id && !failedVariantIds.contains($0.id) && $0.audioLangs.contains(lang) }
            .min { $0.quality < $1.quality }
    }

    private var isTrailer: Bool { session.variant.sourceId == "trailer" }

    init(session: PlaybackSession, app: AppModel) {
        self.session = session
        self.app = app
    }

    func makeViewController() -> AVPlayerViewController {
        let vc = AVPlayerViewController()
        vc.delegate = self
        vc.player = player
        vc.appliesPreferredDisplayCriteriaAutomatically = true
        vc.view.accessibilityIdentifier = "player.root"
        viewController = vc
        // The profile's languages decide, not the system defaults.
        player.appliesMediaSelectionCriteriaAutomatically = false
        load(session.variant, at: session.startAt)
        rebuildMenu()
        Task { await loadGroups() }
        startProgressTimer()
        if !isTrailer { app.user.addHistory(titleId: session.title.id, episodeId: session.episode?.id) }
        return vc
    }

    func stop() {
        guard !stopped else { return }
        stopped = true
        saveProgress()
        player.pause()
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        statusObservation = nil
        player.replaceCurrentItem(with: nil)
        Task { await app.catalog.refreshRecommendations(history: app.user.historyIds, favorites: app.user.data.favorites) }
    }

    // MARK: Loading

    private func urls(for v: StreamVariant) -> [URL] {
        ([v.url] + (v.altUrls ?? [])).compactMap { URL(string: $0) }
    }

    private func load(_ variant: StreamVariant, at position: Double, urlIndex: Int = 0) {
        let list = urls(for: variant)
        guard urlIndex < list.count else {
            showError(String(localized: "Deze versie kan niet worden afgespeeld."))
            return
        }
        currentURLIndex = urlIndex
        session.variant = variant
        pendingSeek = position > 1 ? position : nil

        let item = AVPlayerItem(url: list[urlIndex])
        item.externalMetadata = metadataItems()
        item.preferredForwardBufferDuration = 8
        statusObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            let status = item.status
            Task { @MainActor [weak self] in self?.itemStatusChanged(status) }
        }
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.didFinish() }
        }
        player.replaceCurrentItem(with: item)
        player.play()
    }

    private func itemStatusChanged(_ status: AVPlayerItem.Status) {
        guard let item = player.currentItem else { return }
        switch status {
        case .readyToPlay:
            if let seek = pendingSeek {
                pendingSeek = nil
                player.seek(to: CMTime(seconds: seek, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: CMTime(seconds: 1, preferredTimescale: 600))
            }
            Task { await applyMediaSelection(item) }
            Task { await setupNextProposal(item) }
            player.play()
        case .failed:
            Self.log.error("Afspelen mislukt: \(item.error?.localizedDescription ?? "?", privacy: .public)")
            // Try the fallback url (e.g. .ts) of the same stream first.
            let position = player.currentTime().seconds.isFinite ? player.currentTime().seconds : (pendingSeek ?? 0)
            if currentURLIndex + 1 < urls(for: session.variant).count {
                load(session.variant, at: position, urlIndex: currentURLIndex + 1)
            } else if let fallback = fallbackVariant() {
                // Same language from another source or quality: switch quietly.
                failedVariantIds.insert(session.variant.id)
                Self.log.info("Val terug op een andere versie in dezelfde taal")
                load(fallback, at: position)
                rebuildMenu()
            } else {
                showError(item.error?.localizedDescription ?? String(localized: "Deze versie kan niet worden afgespeeld."))
            }
        default:
            break
        }
    }

    /// Selects the audio track and subtitles that match the profile (and the chosen version).
    private func applyMediaSelection(_ item: AVPlayerItem) async {
        let asset = item.asset
        let audioPrefs = [session.variant.primaryLang] + session.prefs.audioLangs
        if let audible = try? await asset.loadMediaSelectionGroup(for: .audible),
           let option = Self.option(in: audible, matching: audioPrefs) {
            item.select(option, in: audible)
        }
        if let legible = try? await asset.loadMediaSelectionGroup(for: .legible) {
            if session.prefs.subtitlesOn, let option = Self.option(in: legible, matching: session.prefs.subtitleLangs) {
                item.select(option, in: legible)
            } else if !session.prefs.subtitlesOn {
                item.select(nil, in: legible)
            }
        }
    }

    static func option(in group: AVMediaSelectionGroup, matching langs: [String]) -> AVMediaSelectionOption? {
        for lang in langs where lang != "und" {
            if let o = group.options.first(where: { opt in
                let tag = (opt.extendedLanguageTag ?? opt.locale?.identifier ?? "").lowercased()
                return tag == lang || tag.hasPrefix(lang + "-") || tag.hasPrefix(lang + "_")
            }) { return o }
        }
        return nil
    }

    // MARK: Progress

    private func startProgressTimer() {
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 5, preferredTimescale: 1), queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.saveProgress() }
        }
    }

    private func saveProgress() {
        guard !isTrailer, let item = player.currentItem else { return }
        let position = player.currentTime().seconds
        let duration = item.duration.seconds
        guard position.isFinite, duration.isFinite, duration > 0, position > 5 else { return }
        app.user.saveProgress(titleId: session.title.id, episodeId: session.episode?.id, variantId: session.variant.id, position: position, duration: duration)
    }

    // MARK: Taal en bron

    private func loadGroups() async {
        let variants = session.variants
        let fetched = (try? await app.engine.groupVariantsByLanguage(variants, audioLangs: session.prefs.audioLangs)) ?? []
        groups = fetched.isEmpty
            ? Dictionary(grouping: variants, by: \.primaryLang).map { LanguageGroup(lang: $0.key, variants: $0.value) }.sorted { $0.lang < $1.lang }
            : fetched
        rebuildMenu()
    }

    private func rebuildMenu() {
        guard let vc = viewController else { return }
        var items: [UIMenuElement] = []
        let names = app.sources.sourceNames
        let current = session.variant.id
        if !isTrailer, session.variants.count > 0 {
            let sections: [UIMenuElement] = groups.map { group in
                let actions = group.variants.map { v in
                    var detail = names[v.sourceId] ?? v.sourceId
                    if !v.subtitleLangs.isEmpty { detail += " · " + String(localized: "Ondertitels: \(v.subtitleLangs.map { $0.uppercased() }.joined(separator: ", "))") }
                    return UIAction(title: Format.qualityName(v.quality), subtitle: detail, image: nil,
                                    identifier: UIAction.Identifier("variant.\(v.id)"),
                                    state: v.id == current ? .on : .off) { [weak self] _ in
                        self?.switchTo(v)
                    }
                }
                return UIMenu(title: Lang.name(group.lang), options: .displayInline, children: actions)
            }
            items.append(UIMenu(title: String(localized: "Taal en bron"), image: UIImage(systemName: "globe"),
                                identifier: UIMenu.Identifier("menu.languageSource"), children: sections))
        }
        if let next = session.upcoming.first {
            items.append(UIAction(title: String(localized: "Volgende aflevering"), subtitle: "A\(next.episode) · \(next.title)",
                                  image: UIImage(systemName: "forward.end.fill")) { [weak self] _ in
                Task { await self?.playNextEpisode() }
            })
        }
        vc.transportBarCustomMenuItems = items
    }

    /// Switches to another version and keeps the playback position.
    func switchTo(_ variant: StreamVariant) {
        guard variant.id != session.variant.id else { return }
        let t = player.currentTime().seconds
        load(variant, at: t.isFinite ? t : 0)
        rebuildMenu()
        saveProgress()
    }

    // MARK: Next episode

    private func setupNextProposal(_ item: AVPlayerItem) async {
        guard let next = session.upcoming.first else {
            item.nextContentProposal = nil
            return
        }
        let duration = (try? await item.asset.load(.duration))?.seconds ?? item.duration.seconds
        guard duration.isFinite, duration > 60 else { return }
        let proposal = AVContentProposal(contentTimeForTransition: CMTime(seconds: duration - 20, preferredTimescale: 600),
                                         title: next.title.isEmpty ? String(localized: "Aflevering \(next.episode)") : next.title,
                                         previewImage: nil)
        proposal.metadata = metadataItems(for: next)
        item.nextContentProposal = proposal
    }

    nonisolated func playerViewController(_ playerViewController: AVPlayerViewController, shouldPresent proposal: AVContentProposal) -> Bool {
        MainActor.assumeIsolated {
            guard let next = session.upcoming.first else { return false }
            playerViewController.contentProposalViewController = NextEpisodeProposalController(episode: next, seriesTitle: app.catalog.displayTitle(session.title))
            return true
        }
    }

    nonisolated func playerViewController(_ playerViewController: AVPlayerViewController, didAccept proposal: AVContentProposal) {
        MainActor.assumeIsolated {
            _ = Task { await self.playNextEpisode() }
        }
    }

    private func didFinish() {
        saveProgress()
        if app.user.settings.autoplayNext, !session.upcoming.isEmpty, viewController?.contentProposalViewController == nil {
            Task { await playNextEpisode() }
        }
    }

    private func playNextEpisode() async {
        guard !session.upcoming.isEmpty else { return }
        saveProgress()
        let next = session.upcoming.removeFirst()
        // Keep the language and, when possible, the source of the current version.
        let lang = session.variant.primaryLang
        let sameLang = next.variants.filter { $0.audioLangs.contains(lang) }
        var variant = sameLang.first { $0.sourceId == session.variant.sourceId } ?? sameLang.min { $0.quality < $1.quality }
        if variant == nil {
            variant = (try? await app.engine.pickVariant(next.variants, prefs: session.prefs, title: session.title)) ?? next.variants.first
        }
        guard let variant else { return }
        session.episode = next
        let resume = app.user.progress(session.title.id, next.id).flatMap { $0.isResumable ? $0.positionSec : nil } ?? 0
        load(variant, at: resume)
        app.user.addHistory(titleId: session.title.id, episodeId: next.id)
        await loadGroups()
    }

    // MARK: Metadata & errors

    private func metadataItems(for episode: Episode? = nil) -> [AVMetadataItem] {
        let ep = episode ?? session.episode
        let seriesName = app.catalog.displayTitle(session.title)
        let title = ep.map { "\(seriesName) · S\($0.season) A\($0.episode) \($0.title)" } ?? seriesName
        let description = ep?.overview ?? session.title.overview ?? ""
        var items = [Self.metadata(.commonIdentifierTitle, title), Self.metadata(.commonIdentifierDescription, description)]
        if let genre = session.title.genres.first { items.append(Self.metadata(.quickTimeMetadataGenre, genre)) }
        if let art = artwork() {
            let m = AVMutableMetadataItem()
            m.identifier = .commonIdentifierArtwork
            m.value = art as NSData
            m.dataType = kCMMetadataBaseDataType_PNG as String
            m.extendedLanguageTag = "und"
            items.append(m)
        }
        return items
    }

    private func artwork() -> Data? {
        let t = session.title
        let renderer = ImageRenderer(content: GenerativeArt(seed: t.id, title: app.catalog.displayTitle(t), subtitle: t.artCaption, genres: t.genres).frame(width: 400, height: 600))
        renderer.scale = 1
        return renderer.uiImage?.pngData()
    }

    private static func metadata(_ id: AVMetadataIdentifier, _ value: String) -> AVMetadataItem {
        let m = AVMutableMetadataItem()
        m.identifier = id
        m.value = value as NSString
        m.extendedLanguageTag = "und"
        return m
    }

    private func showError(_ message: String) {
        guard let vc = viewController, vc.presentedViewController == nil else { return }
        let alert = UIAlertController(title: String(localized: "Afspelen lukt niet"), message: message, preferredStyle: .alert)
        let others = session.variants.filter { $0.id != session.variant.id }
        if let alt = others.first(where: { $0.primaryLang == session.variant.primaryLang }) ?? others.first {
            alert.addAction(UIAlertAction(title: String(localized: "Andere versie proberen"), style: .default) { [weak self] _ in
                self?.switchTo(alt)
            })
        }
        alert.addAction(UIAlertAction(title: String(localized: "Sluiten"), style: .cancel) { [weak self] _ in
            self?.app.playback = nil
        })
        vc.present(alert, animated: true)
    }
}

/// "Volgende aflevering" card shown near the end of an episode.
final class NextEpisodeProposalController: AVContentProposalViewController {
    private let episode: Episode
    private let seriesTitle: String
    private let playButton = UIButton(type: .system)

    init(episode: Episode, seriesTitle: String) {
        self.episode = episode
        self.seriesTitle = seriesTitle
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override var preferredPlayerViewFrame: CGRect {
        CGRect(x: 1060, y: 90, width: 780, height: 439)
    }

    override var preferredFocusEnvironments: [UIFocusEnvironment] { [playButton] }

    override func viewDidLoad() {
        super.viewDidLoad()
        let eyebrow = UILabel()
        eyebrow.text = String(localized: "VOLGENDE AFLEVERING")
        eyebrow.font = .systemFont(ofSize: 24, weight: .bold)
        eyebrow.textColor = UIColor(white: 1, alpha: 0.6)

        let series = UILabel()
        series.text = seriesTitle
        series.font = .systemFont(ofSize: 30, weight: .semibold)
        series.textColor = UIColor(white: 1, alpha: 0.8)

        let title = UILabel()
        title.text = "S\(episode.season) A\(episode.episode) · \(episode.title)"
        title.font = .systemFont(ofSize: 48, weight: .heavy)
        title.textColor = .white
        title.numberOfLines = 2

        let overview = UILabel()
        overview.text = episode.overview
        overview.font = .systemFont(ofSize: 26)
        overview.textColor = UIColor(white: 1, alpha: 0.7)
        overview.numberOfLines = 3

        playButton.setTitle(String(localized: "Nu afspelen"), for: .normal)
        playButton.addAction(UIAction { [weak self] _ in self?.dismissContentProposal(for: .accept, animated: true) }, for: .primaryActionTriggered)
        let laterButton = UIButton(type: .system)
        laterButton.setTitle(String(localized: "Verder kijken"), for: .normal)
        laterButton.addAction(UIAction { [weak self] _ in self?.dismissContentProposal(for: .reject, animated: true) }, for: .primaryActionTriggered)

        let buttons = UIStackView(arrangedSubviews: [playButton, laterButton])
        buttons.spacing = 30
        let stack = UIStackView(arrangedSubviews: [eyebrow, series, title, overview, buttons])
        stack.axis = .vertical
        stack.alignment = .leading
        stack.spacing = 18
        stack.setCustomSpacing(36, after: overview)
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 120),
            stack.widthAnchor.constraint(equalToConstant: 860),
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 110)
        ])
    }
}
