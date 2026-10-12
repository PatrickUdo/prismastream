// Full-screen live playback with zapping: swipe/click up or down to change channel, select for
// the channel list overlay, Menu to close. A HUD shows the channel and now/next on every zap.

import AVFoundation
import AVKit
import SwiftUI

@MainActor
@Observable
final class LivePlayerModel {
    let player = AVPlayer()
    private(set) var channel: Channel?
    private(set) var error: String?
    private var urls: [URL] = []
    private var urlIndex = 0
    private var observation: NSKeyValueObservation?

    func tune(_ channel: Channel, engine: CoreEngine, prefs: LangPrefs) async {
        self.channel = channel
        error = nil
        let variant = (try? await engine.pickVariant(channel.variants, prefs: prefs)) ?? channel.variants.first
        guard let variant, self.channel?.id == channel.id else {
            if channel.variants.isEmpty { error = String(localized: "Deze zender heeft geen stream.") }
            return
        }
        urls = ([variant.url] + (variant.altUrls ?? [])).compactMap(URL.init(string:))
        // Other sources of the same channel are fallbacks too.
        urls += channel.variants.filter { $0.id != variant.id }.compactMap { URL(string: $0.url) }
        start(at: 0)
    }

    private func start(at index: Int) {
        guard index < urls.count else {
            error = String(localized: "Deze zender is nu niet beschikbaar. MPEG-TS-streams zonder HLS kan Apple TV niet afspelen.")
            player.replaceCurrentItem(with: nil)
            return
        }
        urlIndex = index
        let item = AVPlayerItem(url: urls[index])
        item.preferredForwardBufferDuration = 4
        observation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            let failed = item.status == .failed
            Task { @MainActor [weak self] in
                guard let self, failed, self.player.currentItem === item else { return }
                self.start(at: self.urlIndex + 1)
            }
        }
        player.replaceCurrentItem(with: item)
        player.play()
    }

    func stop() {
        observation = nil
        player.pause()
        player.replaceCurrentItem(with: nil)
    }
}

struct PlayerLayerView: UIViewRepresentable {
    let player: AVPlayer

    final class LayerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer? { layer as? AVPlayerLayer }
    }

    func makeUIView(context: Context) -> LayerView {
        let v = LayerView()
        v.backgroundColor = .black
        v.playerLayer?.player = player
        v.playerLayer?.videoGravity = .resizeAspect
        return v
    }

    func updateUIView(_ view: LayerView, context: Context) {
        view.playerLayer?.player = player
    }
}

struct LivePlayerScreen: View {
    let session: LiveSession
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var model = LivePlayerModel()
    @State private var index = 0
    @State private var hudVisible = true
    @State private var listVisible = false
    @State private var hudToken = 0
    @FocusState private var listFocus: String?

    private var channels: [Channel] { session.channelIds.compactMap(app.catalog.channel) }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            PlayerLayerView(player: model.player).ignoresSafeArea()

            // Full-screen focus target: zapping and opening the list.
            Button { toggleList() } label: { Color.clear.frame(maxWidth: .infinity, maxHeight: .infinity) }
                .buttonStyle(InvisibleButtonStyle())
                .disabled(listVisible)
                .onMoveCommand { direction in
                    switch direction {
                    case .up: zap(-1)
                    case .down: zap(1)
                    default: showHUD()
                    }
                }
                .accessibilityIdentifier("live.player")

            if let error = model.error {
                VStack(spacing: 18) {
                    Image(systemName: "antenna.radiowaves.left.and.right.slash").font(.system(size: 64))
                    Text(error).font(Theme.body).multilineTextAlignment(.center).frame(maxWidth: 1000)
                }
                .foregroundStyle(Theme.text2)
            }

            if hudVisible && !listVisible, let ch = model.channel {
                hud(ch).transition(.move(edge: .bottom).combined(with: .opacity))
            }

            if listVisible {
                channelList.transition(.move(edge: .leading).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: 0.25), value: hudVisible)
        .animation(.easeOut(duration: 0.25), value: listVisible)
        .onPlayPauseCommand {
            if model.player.timeControlStatus == .paused { model.player.play() } else { model.player.pause() }
        }
        .onExitCommand {
            if listVisible { listVisible = false } else { close() }
        }
        .task {
            index = max(0, session.channelIds.firstIndex(of: session.channelId) ?? 0)
            await tuneCurrent()
        }
        .onDisappear { model.stop() }
    }

    private func close() {
        model.stop()
        app.live = nil
        dismiss()
    }

    private func tuneCurrent() async {
        guard channels.indices.contains(index) else { return }
        let ch = channels[index]
        app.user.setLastChannel(ch.id)
        showHUD()
        await model.tune(ch, engine: app.engine, prefs: app.profile.langPrefs)
    }

    private func zap(_ delta: Int) {
        guard !channels.isEmpty else { return }
        index = (index + delta + channels.count) % channels.count
        Task { await tuneCurrent() }
    }

    private func toggleList() {
        listVisible.toggle()
        if listVisible { listFocus = model.channel?.id }
    }

    private func showHUD() {
        hudVisible = true
        hudToken += 1
        let token = hudToken
        Task {
            try? await Task.sleep(for: .seconds(5))
            if token == hudToken { hudVisible = false }
        }
    }

    private func hud(_ ch: Channel) -> some View {
        let nn = app.catalog.nowNext(ch)
        return VStack {
            Spacer()
            HStack(alignment: .center, spacing: 34) {
                ChannelLogo(channel: ch, size: 96)
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 14) {
                        if let n = ch.number { Text("\(n)").foregroundStyle(Theme.text3).monospacedDigit() }
                        Text(ch.name)
                        LiveDot()
                    }
                    .font(Theme.headline)
                    Text(nn.now?.title ?? String(localized: "Geen gidsinformatie")).font(Theme.title2).lineLimit(1)
                    if let now = nn.now {
                        HStack(spacing: 16) {
                            Text(Format.time(now.startDate)).monospacedDigit().fixedSize()
                            ProgressLine(fraction: now.progress(at: Date()), height: 6).frame(width: 520)
                            Text(Format.time(now.stopDate)).monospacedDigit().fixedSize()
                        }
                        .font(Theme.caption).foregroundStyle(Theme.text3)
                    }
                    if let next = nn.next {
                        Text("Straks: \(next.title) · \(Format.time(next.startDate))").font(Theme.callout).foregroundStyle(Theme.text2).lineLimit(1)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 10) {
                    Label("Omhoog/omlaag: zappen", systemImage: "arrow.up.arrow.down")
                    Label("Selecteer: zenderlijst", systemImage: "list.bullet")
                }
                .font(Theme.caption)
                .foregroundStyle(Theme.text3)
            }
            .padding(40)
            .foregroundStyle(Theme.text)
            .background(
                RoundedRectangle(cornerRadius: 34, style: .continuous)
                    .fill(Color.black.opacity(0.55))
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 34, style: .continuous))
            )
            .environment(\.colorScheme, .dark)
            .padding(.horizontal, Theme.gutter)
            .padding(.bottom, 60)
        }
    }

    private var channelList: some View {
        HStack {
            VStack(alignment: .leading, spacing: 20) {
                Text("Zenders").font(Theme.title2).padding(.horizontal, 30)
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(Array(channels.enumerated()), id: \.element.id) { i, ch in
                                ChannelRow(channel: ch, isFavorite: app.user.isFavoriteChannel(ch.id)) {
                                    index = i
                                    listVisible = false
                                    Task { await tuneCurrent() }
                                }
                                .focused($listFocus, equals: ch.id)
                                .id(ch.id)
                            }
                        }
                        .padding(.horizontal, 30)
                        .padding(.vertical, 20)
                    }
                    .onAppear { proxy.scrollTo(model.channel?.id, anchor: .center) }
                }
            }
            .padding(.vertical, 50)
            .frame(width: 800)
            .background(.ultraThickMaterial)
            Spacer()
        }
        .ignoresSafeArea()
    }
}

struct InvisibleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { configuration.label }
}
