// The versions panel: the core feature. One title, many streams (languages, subtitles,
// qualities, sources); the profile's languages pick the default via PrismaCore.pickVariant and
// the viewer can override every dimension.

import SwiftUI

struct VersionSelection: Equatable {
    var audio: LangCode = "und"
    var subtitle: LangCode?
    var quality: Quality?
    var sourceId: String?

    /// Variants that match the selection, best first.
    func candidates(in variants: [StreamVariant]) -> [StreamVariant] {
        var list = variants.filter { $0.audioLangs.contains(audio) || ($0.audioLangs.isEmpty && audio == "und") }
        if list.isEmpty { list = variants }
        if let quality {
            let q = list.filter { $0.quality == quality }
            if !q.isEmpty { list = q }
        }
        if let sourceId {
            let s = list.filter { $0.sourceId == sourceId }
            if !s.isEmpty { list = s }
        }
        return list.sorted { a, b in
            if let subtitle {
                let ah = a.subtitleLangs.contains(subtitle), bh = b.subtitleLangs.contains(subtitle)
                if ah != bh { return ah }
            }
            return a.quality.rank < b.quality.rank
        }
    }

    func resolve(in variants: [StreamVariant]) -> StreamVariant? { candidates(in: variants).first }

    init() {}

    init(variant: StreamVariant, prefs: LangPrefs) {
        audio = variant.primaryLang
        quality = variant.quality
        sourceId = variant.sourceId
        if prefs.subtitlesOn {
            subtitle = prefs.subtitleLangs.first { variant.subtitleLangs.contains($0) }
        }
    }

    /// Preferences that steer pickVariant for episodes towards this selection.
    func prefs(base: LangPrefs) -> LangPrefs {
        var p = base
        p.audioLangs = [audio] + base.audioLangs.filter { $0 != audio }
        if let subtitle {
            p.subtitlesOn = true
            p.subtitleLangs = [subtitle] + base.subtitleLangs.filter { $0 != subtitle }
        }
        return p
    }
}

struct VersionsPanel: View {
    let variants: [StreamVariant]
    let groups: [LanguageGroup]
    @Binding var selection: VersionSelection
    var isSeries: Bool = false

    @Environment(AppModel.self) private var app

    var body: some View {
        let inAudio = variants.filter { $0.audioLangs.contains(selection.audio) }
        let subtitleLangs = orderedUnique(inAudio.flatMap(\.subtitleLangs))
        let qualities = Array(Set(inAudio.map(\.quality))).sorted()
        let inQuality = inAudio.filter { selection.quality == nil || $0.quality == selection.quality }
        let sourceIds = orderedUnique(inQuality.map(\.sourceId))
        let resolved = selection.resolve(in: variants)
        let sourceCount = Set(variants.map(\.sourceId)).count

        VStack(alignment: .leading, spacing: 34) {
            HStack(alignment: .lastTextBaseline) {
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("Kies je versie")
                    Text("Talen en versies").font(Theme.title2).foregroundStyle(Theme.text)
                }
                Spacer()
                Text(isSeries ? "\(sourceCount) bronnen" : "\(variants.count) versies · \(sourceCount) bronnen")
                    .font(Theme.callout)
                    .foregroundStyle(Theme.text3)
            }

            row("Audio", systemImage: "globe") {
                ForEach(groups) { g in
                    Chip(label: Lang.name(g.lang), detail: g.variants.count > 1 ? "\(g.variants.count)" : nil, selected: selection.audio == g.lang) {
                        selectAudio(g.lang)
                    }
                    .accessibilityIdentifier("versions.audio.\(g.lang)")
                }
            }

            row("Ondertitels", systemImage: "captions.bubble") {
                if subtitleLangs.isEmpty {
                    Text("Geen ondertitels bekend").font(Theme.callout).foregroundStyle(Theme.text3)
                        .padding(.vertical, 12)
                } else {
                    Chip(label: String(localized: "Uit"), selected: selection.subtitle == nil) { selection.subtitle = nil }
                    ForEach(subtitleLangs, id: \.self) { lang in
                        Chip(label: Lang.name(lang), selected: selection.subtitle == lang) { selection.subtitle = lang }
                    }
                }
            }

            HStack(alignment: .top, spacing: 60) {
                row("Kwaliteit", systemImage: "sparkles.tv") {
                    ForEach(qualities, id: \.self) { q in
                        Chip(label: Format.qualityName(q), selected: selection.quality == q) {
                            selection.quality = q
                            if let s = selection.sourceId, !variants.contains(where: { $0.sourceId == s && $0.quality == q && $0.audioLangs.contains(selection.audio) }) {
                                selection.sourceId = nil
                            }
                        }
                    }
                }
                row("Bron", systemImage: "externaldrive.connected.to.line.below") {
                    ForEach(sourceIds, id: \.self) { id in
                        Chip(label: app.sources.sourceNames[id] ?? id, selected: (selection.sourceId ?? resolved?.sourceId) == id) {
                            selection.sourceId = id
                        }
                    }
                }
            }

            Rectangle().fill(Theme.line).frame(height: 1)

            if let resolved {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 14) {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.success)
                        Text(summary(resolved))
                    }
                    .font(Theme.callout)
                    .foregroundStyle(Theme.text)
                    if !isSeries, !resolved.label.isEmpty {
                        Text(resolved.label)
                            .font(.system(size: 21, design: .monospaced))
                            .foregroundStyle(Theme.text3)
                            .lineLimit(1)
                    }
                }
            }
        }
        .padding(48)
        .background(
            RoundedRectangle(cornerRadius: 34, style: .continuous)
                .fill(LinearGradient(colors: [Theme.elev2, Theme.elev1], startPoint: .topLeading, endPoint: .bottomTrailing))
        )
        .overlay(alignment: .top) {
            SpectrumLine(height: 2).opacity(0.7).padding(.horizontal, 60)
        }
        .overlay(RoundedRectangle(cornerRadius: 34, style: .continuous).strokeBorder(Theme.line, lineWidth: 1.5))
        .focusSection()
        .accessibilityIdentifier("detail.versions")
    }

    private func selectAudio(_ lang: LangCode) {
        selection.audio = lang
        let inLang = variants.filter { $0.audioLangs.contains(lang) }.sorted { $0.quality < $1.quality }
        selection.quality = inLang.first?.quality
        selection.sourceId = inLang.first?.sourceId
        if let s = selection.subtitle, !inLang.contains(where: { $0.subtitleLangs.contains(s) }) { selection.subtitle = nil }
    }

    private func summary(_ v: StreamVariant) -> String {
        var parts = [Lang.name(selection.audio), Format.qualityName(v.quality), app.sources.sourceNames[v.sourceId] ?? v.sourceId]
        if let s = selection.subtitle { parts.append(String(localized: "Ondertitels: \(Lang.name(s))")) }
        return parts.joined(separator: " · ")
    }

    private func orderedUnique(_ list: [String]) -> [String] {
        var seen = Set<String>()
        return list.filter { seen.insert($0).inserted }
    }

    @ViewBuilder
    private func row<Content: View>(_ label: LocalizedStringKey, systemImage: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                Image(systemName: systemImage)
                Text(label).tracking(3).textCase(.uppercase)
            }
            .font(Theme.eyebrow)
            .foregroundStyle(Theme.text3)
            FlowRow(spacing: 16) { content() }
        }
    }
}

/// Wrapping row of chips.
struct FlowRow: Layout {
    var spacing: CGFloat = 16

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0, x + s.width > maxWidth {
                y += rowHeight + spacing
                x = 0
                rowHeight = 0
            }
            x += s.width + spacing
            widest = max(widest, x - spacing)
            rowHeight = max(rowHeight, s.height)
        }
        return CGSize(width: proposal.width ?? widest, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > bounds.minX, x + s.width > bounds.maxX {
                y += rowHeight + spacing
                x = bounds.minX
                rowHeight = 0
            }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            rowHeight = max(rowHeight, s.height)
        }
    }
}
