// Live TV: channel list with a live preview/detail panel, and an EPG grid (timeline with a now
// line and focusable programme blocks). Favorite channels sort first and have their own filter.

import SwiftUI

struct LiveTVView: View {
    enum Mode: Hashable { case list, guide }

    @Environment(AppModel.self) private var app
    @State private var mode: Mode = UserDefaults.standard.string(forKey: "liveMode") == "guide" ? .guide : .list
    @State private var group: String = "__all"
    @State private var previewId: String?
    @FocusState private var focusedChannel: String?

    private var channels: [Channel] {
        let favs = Set(app.user.data.favoriteChannels)
        let all = app.catalog.channels
        let filtered: [Channel]
        switch group {
        case "__all": filtered = all
        case "__fav": filtered = all.filter { favs.contains($0.id) }
        default: filtered = all.filter { $0.group == group }
        }
        return filtered.sorted { a, b in
            let fa = favs.contains(a.id), fb = favs.contains(b.id)
            if fa != fb { return fa }
            return (a.number ?? Int.max, a.name) < (b.number ?? Int.max, b.name)
        }
    }

    var body: some View {
        let list = channels
        VStack(alignment: .leading, spacing: 28) {
            header(count: app.catalog.channels.count)
            if app.catalog.channels.isEmpty {
                EmptyStateView(systemImage: "antenna.radiowaves.left.and.right", title: "Geen zenders",
                               message: "Voeg een Xtream- of M3U-bron toe in Instellingen om live tv te kijken.")
            } else if list.isEmpty {
                EmptyStateView(systemImage: "star", title: "Nog geen favorieten", message: "Markeer zenders met de ster om ze hier te zien.")
            } else if mode == .list {
                HStack(alignment: .top, spacing: 50) {
                    channelList(list)
                        .frame(width: 720)
                    if let ch = list.first(where: { $0.id == previewId }) ?? list.first {
                        ScrollView(.vertical) {
                            ChannelPreview(channel: ch, list: list)
                                .padding(.vertical, 20)
                        }
                        .scrollClipDisabled()
                    }
                }
                .frame(maxHeight: .infinity, alignment: .top)
            } else {
                EPGGridView(channels: list)
            }
        }
        .padding(.horizontal, Theme.gutter)
        .padding(.top, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(AmbientBackground())
        .onChange(of: focusedChannel) { _, new in if let new { previewId = new } }
    }

    private func header(count: Int) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 6) {
                    Eyebrow("\(count) zenders")
                    Text("Live TV").font(Theme.title1)
                }
                Spacer()
                HStack(spacing: 16) {
                    Chip(label: String(localized: "Lijst"), selected: mode == .list, systemImage: "list.bullet") { mode = .list }
                        .accessibilityIdentifier("live.mode.list")
                    Chip(label: String(localized: "Gids"), selected: mode == .guide, systemImage: "calendar") { mode = .guide }
                        .accessibilityIdentifier("live.mode.guide")
                }
            }
            ScrollView(.horizontal) {
                HStack(spacing: 16) {
                    Chip(label: String(localized: "Alle"), detail: "\(app.catalog.channels.count)", selected: group == "__all") { group = "__all" }
                    Chip(label: String(localized: "Favorieten"), detail: "\(app.user.data.favoriteChannels.count)", selected: group == "__fav", systemImage: "star.fill") { group = "__fav" }
                    ForEach(groups, id: \.name) { g in
                        Chip(label: g.name, detail: "\(g.count)", selected: group == g.name) { group = g.name }
                    }
                }
                .padding(.vertical, 14)
                .padding(.horizontal, 6)
            }
            .scrollClipDisabled()
        }
        .focusSection()
    }

    private var groups: [(name: String, count: Int)] {
        var counts: [String: Int] = [:]
        for c in app.catalog.channels where !c.group.isEmpty { counts[c.group, default: 0] += 1 }
        return counts.map { ($0.key, $0.value) }.sorted { $0.name < $1.name }
    }

    private func channelList(_ list: [Channel]) -> some View {
        ScrollView(.vertical) {
            LazyVStack(spacing: 14) {
                ForEach(list) { ch in
                    ChannelRow(channel: ch, isFavorite: app.user.isFavoriteChannel(ch.id)) {
                        app.playChannel(ch, in: list)
                    }
                    .focused($focusedChannel, equals: ch.id)
                    .accessibilityIdentifier("channel.\(ch.id)")
                }
            }
            .padding(.vertical, 20)
            .padding(.horizontal, 16)
        }
        .scrollClipDisabled()
        .focusSection()
    }
}

struct ChannelRow: View {
    let channel: Channel
    let isFavorite: Bool
    let action: () -> Void
    @Environment(AppModel.self) private var app

    var body: some View {
        let nn = app.catalog.nowNext(channel)
        Button(action: action) {
            HStack(spacing: 22) {
                ChannelLogo(channel: channel, size: 62)
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 10) {
                        if let n = channel.number { Text("\(n)").font(.system(size: 22, weight: .bold)).opacity(0.5).monospacedDigit() }
                        Text(channel.name).font(.system(size: 26, weight: .bold)).lineLimit(1)
                        if isFavorite { Image(systemName: "star.fill").font(.system(size: 18)).foregroundStyle(Theme.rating) }
                    }
                    Text(nn.now?.title ?? String(localized: "Geen gidsinformatie"))
                        .font(.system(size: 22))
                        .opacity(0.7)
                        .lineLimit(1)
                    if let now = nn.now { ProgressLine(fraction: now.progress(at: Date()), height: 4).frame(width: 300) }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(TileStyle(cornerRadius: 20))
    }
}

struct ChannelPreview: View {
    let channel: Channel
    let list: [Channel]
    @Environment(AppModel.self) private var app
    @Environment(\.accent) private var accent

    var body: some View {
        let nn = app.catalog.nowNext(channel)
        let upcoming = app.catalog.programmes(for: channel).filter { $0.stopDate > Date() }.prefix(5)
        VStack(alignment: .leading, spacing: 30) {
            ZStack(alignment: .topLeading) {
                GenerativeCanvas(spec: ArtSpec(seed: channel.id, genres: [channel.group]), poster: false)
                LinearGradient(colors: [.clear, .black.opacity(0.65)], startPoint: .top, endPoint: .bottom)
                ChannelLogo(channel: channel, size: 120).frame(maxWidth: .infinity, maxHeight: .infinity)
                LiveDot().padding(22)
            }
            .frame(height: 360)
            .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).strokeBorder(Theme.line))

            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 14) {
                    if let n = channel.number { Text("\(n)").foregroundStyle(Theme.text3) }
                    Text(channel.name)
                    QualityBadge(quality: channel.variants.map(\.quality).min())
                    ForEach(channel.languages.prefix(3), id: \.self) { l in
                        Text(l.uppercased()).font(.system(size: 18, weight: .heavy)).padding(.horizontal, 8).padding(.vertical, 4)
                            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.white.opacity(0.3)))
                    }
                    if channel.variants.count > 1 {
                        Text("· \(Set(channel.variants.map(\.sourceId)).count) bronnen").foregroundStyle(Theme.text3)
                    }
                }
                .font(Theme.callout)
                .foregroundStyle(Theme.text2)

                Eyebrow("Nu live", color: accent)
                Text(nn.now?.title ?? channel.name).font(Theme.title2).lineLimit(2)
                if let now = nn.now {
                    HStack(spacing: 18) {
                        Text(Format.time(now.startDate)).monospacedDigit()
                        ProgressLine(fraction: now.progress(at: Date()), height: 6)
                        Text(Format.time(now.stopDate)).monospacedDigit()
                    }
                    .font(Theme.caption)
                    .foregroundStyle(Theme.text3)
                    if let desc = now.desc { Text(desc).font(Theme.body).foregroundStyle(Theme.text2).lineLimit(3) }
                }
                if let next = nn.next {
                    (Text("Straks  ").bold().foregroundColor(Theme.text) + Text("\(next.title)  ") + Text("\(Format.time(next.startDate)) – \(Format.time(next.stopDate))").foregroundColor(Theme.text3))
                        .font(Theme.callout)
                        .foregroundStyle(Theme.text2)
                        .lineLimit(1)
                }
            }

            HStack(spacing: 24) {
                Button { app.playChannel(channel, in: list) } label: { Label("Kijk live", systemImage: "play.fill") }
                    .buttonStyle(PillStyle(prominent: true))
                    .accessibilityIdentifier("live.watch")
                Button { app.user.toggleFavoriteChannel(channel.id) } label: {
                    Image(systemName: app.user.isFavoriteChannel(channel.id) ? "star.fill" : "star")
                }
                .buttonStyle(RoundIconStyle())
                .accessibilityLabel(Text("Favoriete zender"))
            }

            if upcoming.count > 1 {
                VStack(alignment: .leading, spacing: 10) {
                    Eyebrow("Programma")
                    ForEach(Array(upcoming.dropFirst())) { p in
                        HStack(spacing: 20) {
                            Text(Format.time(p.startDate)).monospacedDigit().foregroundStyle(Theme.text3).frame(width: 90, alignment: .leading)
                            Text(p.title).foregroundStyle(Theme.text2).lineLimit(1)
                        }
                        .font(Theme.callout)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .focusSection()
    }
}

// MARK: - EPG grid

struct EPGGridView: View {
    let channels: [Channel]
    @Environment(AppModel.self) private var app
    @Environment(\.accent) private var accent
    @State private var offsetHours: Double = 0
    @State private var focused: EpgProgramme?
    @State private var now = Date()

    private let perMinute: CGFloat = 6
    private let channelColumn: CGFloat = 300
    private let rowHeight: CGFloat = 104
    private let hours: Double = 4

    private var windowStart: Date {
        let base = Date(timeIntervalSince1970: (now.timeIntervalSince1970 / 1800).rounded(.down) * 1800 - 1800)
        return base.addingTimeInterval(offsetHours * 3600)
    }
    private var windowEnd: Date { windowStart.addingTimeInterval(hours * 3600) }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            detailHeader
            HStack {
                Text(windowStart.formatted(.dateTime.weekday(.wide).day().month(.wide)))
                    .font(Theme.headline)
                Spacer()
                HStack(spacing: 14) {
                    Chip(label: String(localized: "Eerder"), systemImage: "chevron.left") { offsetHours -= 2 }
                    Chip(label: String(localized: "Nu"), selected: offsetHours == 0) { offsetHours = 0; now = Date() }
                    Chip(label: String(localized: "Later"), systemImage: "chevron.right") { offsetHours += 2 }
                }
            }
            .focusSection()

            ruler
            ScrollView(.vertical) {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(channels) { ch in row(ch) }
                }
                .padding(.vertical, 12)
                .overlay(alignment: .topLeading) { nowLine }
            }
            .scrollClipDisabled()
            .focusSection()
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                now = Date()
            }
        }
    }

    private var detailHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let p = focused, let ch = channels.first(where: { $0.epgId == p.channelId }) {
                Text("\(ch.name)  ·  \(Format.time(p.startDate)) – \(Format.time(p.stopDate))").font(Theme.callout).foregroundStyle(Theme.text3)
                Text(p.title).font(Theme.title2).lineLimit(1)
                Text(p.desc ?? " ").font(Theme.callout).foregroundStyle(Theme.text2).lineLimit(1)
            } else {
                Text(" ").font(Theme.callout)
                Text("Gids").font(Theme.title2)
                Text("Kies een programma om meer te zien.").font(Theme.callout).foregroundStyle(Theme.text2)
            }
        }
        .frame(height: 150, alignment: .topLeading)
    }

    private func x(_ date: Date) -> CGFloat {
        CGFloat(date.timeIntervalSince(windowStart) / 60) * perMinute
    }

    private var ruler: some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: channelColumn)
            ZStack(alignment: .topLeading) {
                ForEach(0..<Int(hours * 2), id: \.self) { i in
                    let t = windowStart.addingTimeInterval(Double(i) * 1800)
                    let nearNow = abs(t.timeIntervalSince(now)) < 12 * 60 && now > windowStart && now < windowEnd
                    VStack(alignment: .leading, spacing: 6) {
                        Text(Format.time(t)).font(Theme.caption).foregroundStyle(Theme.text2).monospacedDigit()
                            .opacity(nearNow ? 0 : 1)
                        Rectangle().fill(Theme.lineStrong).frame(width: 1.5, height: 12)
                    }
                    .offset(x: x(t))
                }
                if now > windowStart && now < windowEnd {
                    Text(Format.time(now))
                        .font(.system(size: 19, weight: .heavy)).monospacedDigit()
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Theme.live, in: RoundedRectangle(cornerRadius: 7))
                        .offset(x: x(now) - 36, y: -4)
                }
            }
            .frame(width: CGFloat(hours * 60) * perMinute, height: 46, alignment: .topLeading)
        }
    }

    @ViewBuilder
    private var nowLine: some View {
        if now > windowStart && now < windowEnd {
            Rectangle().fill(Theme.live).frame(width: 3)
                .frame(maxHeight: .infinity)
                .offset(x: channelColumn + x(now))
                .allowsHitTesting(false)
        }
    }

    private func row(_ ch: Channel) -> some View {
        let programmes = app.catalog.programmes(for: ch).filter { $0.stopDate > windowStart && $0.startDate < windowEnd }
        return HStack(spacing: 0) {
            Button { app.playChannel(ch, in: channels) } label: {
                HStack(spacing: 16) {
                    ChannelLogo(channel: ch, size: 50)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(ch.name).font(.system(size: 23, weight: .bold)).lineLimit(1)
                        if let n = ch.number { Text("\(n)").font(.system(size: 19)).opacity(0.55) }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14)
                .frame(width: channelColumn - 14, height: rowHeight)
            }
            .buttonStyle(TileStyle(cornerRadius: 16, scale: 1.02))
            .padding(.trailing, 14)

            if programmes.isEmpty {
                Text("Geen gidsinformatie")
                    .font(Theme.callout).foregroundStyle(Theme.text3)
                    .padding(.horizontal, 24)
                    .frame(width: CGFloat(hours * 60) * perMinute, height: rowHeight, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 16).fill(.white.opacity(0.03)))
            } else {
                HStack(spacing: 0) {
                    ForEach(Array(segments(programmes).enumerated()), id: \.offset) { _, seg in
                        switch seg {
                        case .gap(let w):
                            Color.clear.frame(width: w, height: rowHeight)
                        case .programme(let p, let w):
                            ProgrammeBlock(programme: p, width: w, height: rowHeight, isLive: p.isOn(at: now), isPast: p.stopDate <= now) {
                                if p.isOn(at: Date()) { app.playChannel(ch, in: channels) }
                                else { app.toast = String(localized: "\(p.title) begint om \(Format.time(p.startDate)).") }
                            } onFocus: { focused = p }
                        }
                    }
                }
                .frame(width: CGFloat(hours * 60) * perMinute, alignment: .leading)
            }
        }
    }

    private enum Segment {
        case gap(CGFloat)
        case programme(EpgProgramme, CGFloat)
    }

    private func segments(_ list: [EpgProgramme]) -> [Segment] {
        var out: [Segment] = []
        var cursor = windowStart
        for p in list.sorted(by: { $0.start < $1.start }) {
            let start = max(p.startDate, windowStart, cursor)
            let end = min(p.stopDate, windowEnd)
            guard end > start else { continue }
            if start > cursor { out.append(.gap(x(start) - x(cursor))) }
            out.append(.programme(p, x(end) - x(start)))
            cursor = end
        }
        return out
    }
}

struct ProgrammeBlock: View {
    let programme: EpgProgramme
    let width: CGFloat
    let height: CGFloat
    let isLive: Bool
    let isPast: Bool
    let action: () -> Void
    let onFocus: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                Text(programme.title).font(.system(size: 23, weight: .semibold)).lineLimit(1)
                if width > 150 {
                    Text("\(Format.time(programme.startDate)) – \(Format.time(programme.stopDate))")
                        .font(.system(size: 19)).monospacedDigit().opacity(0.6)
                }
            }
            .padding(.horizontal, 16)
            .frame(width: max(width - 6, 10), height: height, alignment: .leading)
            .overlay(alignment: .bottomLeading) {
                if isLive && !focused {
                    ProgressLine(fraction: programme.progress(at: Date()), height: 4).padding(.horizontal, 2)
                }
            }
        }
        .buttonStyle(TileStyle(cornerRadius: 14, selected: isLive, scale: 1.03))
        .opacity(isPast && !focused ? 0.5 : 1)
        .focused($focused)
        .onChange(of: focused) { _, f in if f { onFocus() } }
        .padding(.trailing, 6)
    }
}
