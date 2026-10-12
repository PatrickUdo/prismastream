// Settings: profiles, sources (demo, Xtream Codes, M3U), appearance and about/legal.

import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        HStack(alignment: .top, spacing: 80) {
            VStack(alignment: .leading, spacing: 40) {
                Wordmark(size: 44)
                VStack(alignment: .leading, spacing: 18) {
                    AvatarView(name: app.profile.name, preset: app.profile.avatar, size: 150)
                    Text(app.profile.name).font(Theme.title2)
                    Text(app.profile.audioLangs.map(Lang.name).joined(separator: " · "))
                        .font(Theme.callout).foregroundStyle(Theme.text2)
                }
                statusCard
                Spacer()
            }
            .frame(width: 560, alignment: .leading)
            .padding(.top, 40)

            List {
                Section {
                    NavigationLink { ProfilesView() } label: {
                        SettingsRow(icon: "person.2.fill", title: "Profielen", value: "\(app.user.profiles.count)")
                    }
                    .accessibilityIdentifier("settings.profiles")
                } header: { Text("Profiel") }

                Section {
                    ForEach(app.sources.sources.filter { $0.type != .sample }) { source in
                        NavigationLink { SourceDetailView(sourceId: source.id) } label: {
                            SettingsRow(icon: source.type == .xtream ? "server.rack" : "list.bullet.rectangle",
                                        title: LocalizedStringKey(source.name), value: source.enabled ? (source.lastError == nil ? String(localized: "Aan") : String(localized: "Fout")) : String(localized: "Uit"))
                        }
                    }
                    Toggle(isOn: Binding(get: { app.sources.sampleSourcesEnabled }, set: { on in
                        app.sources.setSampleSourcesEnabled(on)
                        Task { await app.start() }
                    })) {
                        SettingsRow(icon: "sparkles", title: "Demobibliotheek", value: nil)
                    }
                    .accessibilityIdentifier("settings.demo")
                    NavigationLink { AddSourceView(type: .xtream) } label: {
                        SettingsRow(icon: "plus.circle.fill", title: "Xtream Codes-bron toevoegen", value: nil)
                    }
                    NavigationLink { AddSourceView(type: .m3u) } label: {
                        SettingsRow(icon: "plus.circle.fill", title: "M3U-afspeellijst toevoegen", value: nil)
                    }
                    Button {
                        Task { await app.start(force: true) }
                    } label: {
                        SettingsRow(icon: "arrow.clockwise", title: "Alle bronnen vernieuwen", value: nil)
                    }
                } header: { Text("Bronnen") }

                Section {
                    NavigationLink { AccentPicker() } label: {
                        HStack {
                            SettingsRow(icon: "paintpalette.fill", title: "Accentkleur", value: nil)
                            Circle().fill(Color(hex: app.user.settings.accent)).frame(width: 34, height: 34)
                        }
                    }
                    Toggle(isOn: Binding(get: { app.user.settings.autoplayNext }, set: { app.user.settings.autoplayNext = $0 })) {
                        SettingsRow(icon: "forward.end.alt.fill", title: "Volgende aflevering automatisch", value: nil)
                    }
                } header: { Text("Weergave") }

                Section {
                    NavigationLink { AboutView() } label: {
                        SettingsRow(icon: "info.circle.fill", title: "Over PrismaStream", value: nil)
                    }
                }
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, Theme.gutter)
        .background(AmbientBackground())
    }

    @ViewBuilder
    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Eyebrow("Catalogus")
            switch app.catalog.phase {
            case .ready:
                Text("\(app.catalog.titles.count) titels · \(app.catalog.channels.count) zenders").font(Theme.callout)
            case .loading(let m):
                Text(m).font(Theme.callout)
            case .failed(let m):
                Text(m).font(Theme.callout).foregroundStyle(Theme.live).lineLimit(4)
            case .idle:
                Text("Nog niet geladen").font(Theme.callout)
            }
            ForEach(Array(app.catalog.sourceErrors.keys.sorted()), id: \.self) { id in
                Text("\(app.sources.sourceNames[id] ?? id): \(app.catalog.sourceErrors[id] ?? "")")
                    .font(Theme.caption).foregroundStyle(Theme.live).lineLimit(2)
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Theme.elev1))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(Theme.line))
    }
}

struct SettingsRow: View {
    let icon: String
    let title: LocalizedStringKey
    let value: String?
    var body: some View {
        HStack(spacing: 22) {
            Image(systemName: icon).frame(width: 40)
            Text(title)
            Spacer()
            if let value { Text(value).foregroundStyle(.secondary) }
        }
    }
}

// MARK: - Profiles

struct ProfilesView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 40) {
                Text("Wie kijkt er?").font(Theme.title1)
                HStack(spacing: 50) {
                    ForEach(app.user.profiles) { p in
                        NavigationLink { ProfileEditView(profileId: p.id) } label: {
                            VStack(spacing: 18) {
                                AvatarView(name: p.name, preset: p.avatar, size: 190)
                                Text(p.name).font(Theme.headline)
                                Text(p.id == app.user.activeProfileId ? "Actief" : " ")
                                    .font(Theme.caption).foregroundStyle(.secondary)
                            }
                            .padding(24)
                        }
                        .buttonStyle(.borderless)
                    }
                    Button {
                        let p = app.user.createProfile(name: String(localized: "Profiel \(app.user.profiles.count + 1)"), avatar: AvatarPalette.presets[app.user.profiles.count % AvatarPalette.presets.count].id, audioLangs: ["nl", "en"])
                        app.user.selectProfile(p.id)
                        Task { await app.profileChanged() }
                    } label: {
                        VStack(spacing: 18) {
                            ZStack {
                                Circle().strokeBorder(.white.opacity(0.3), style: StrokeStyle(lineWidth: 3, dash: [10, 8]))
                                Image(systemName: "plus").font(.system(size: 60, weight: .light))
                            }
                            .frame(width: 190, height: 190)
                            Text("Nieuw profiel").font(Theme.headline)
                            Text(" ").font(Theme.caption)
                        }
                        .padding(24)
                    }
                    .buttonStyle(.borderless)
                }
                .focusSection()
            }
            .padding(Theme.gutter)
        }
        .background(AmbientBackground())
    }
}

struct ProfileEditView: View {
    let profileId: String
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var draft: Profile?

    var body: some View {
        Group {
            if let draft {
                editor(draft)
            } else {
                ProgressView()
            }
        }
        .background(AmbientBackground())
        .onAppear { draft = app.user.profiles.first { $0.id == profileId } }
        .onDisappear { commit() }
    }

    private func commit() {
        guard let draft else { return }
        app.user.updateProfile(draft)
        if draft.id == app.user.activeProfileId { Task { await app.profileChanged() } }
    }

    private func editor(_ p: Profile) -> some View {
        let binding = Binding<Profile>(get: { draft ?? p }, set: { draft = $0 })
        return ScrollView {
            VStack(alignment: .leading, spacing: 46) {
                HStack(spacing: 40) {
                    AvatarView(name: p.name, preset: p.avatar, size: 170)
                    VStack(alignment: .leading, spacing: 16) {
                        TextField("Naam", text: binding.name).font(Theme.title2).frame(width: 700)
                        HStack(spacing: 20) {
                            Button {
                                app.user.updateProfile(binding.wrappedValue)
                                app.user.selectProfile(p.id)
                                Task { await app.profileChanged() }
                            } label: {
                                Label(p.id == app.user.activeProfileId ? "Actief profiel" : "Dit profiel gebruiken", systemImage: "checkmark.circle")
                            }
                            .buttonStyle(PillStyle(prominent: true))
                            if app.user.profiles.count > 1 {
                                Button(role: .destructive) {
                                    draft = nil
                                    app.user.deleteProfile(p.id)
                                    dismiss()
                                } label: { Label("Verwijderen", systemImage: "trash") }
                                .buttonStyle(PillStyle())
                            }
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 18) {
                    Eyebrow("Avatar")
                    HStack(spacing: 26) {
                        ForEach(AvatarPalette.presets, id: \.id) { preset in
                            Button { draft?.avatar = preset.id } label: {
                                AvatarView(name: p.name, preset: preset.id, size: 96)
                                    .overlay(Circle().strokeBorder(.white, lineWidth: p.avatar == preset.id ? 5 : 0))
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                }
                .focusSection()

                VStack(alignment: .leading, spacing: 18) {
                    Eyebrow("Audiotalen (op volgorde van voorkeur)")
                    Text(p.audioLangs.isEmpty ? String(localized: "Geen voorkeur") : p.audioLangs.enumerated().map { "\($0.offset + 1). \(Lang.name($0.element))" }.joined(separator: "   "))
                        .font(Theme.callout).foregroundStyle(Theme.text2)
                    FlowRow(spacing: 14) {
                        ForEach(Lang.known, id: \.self) { code in
                            Chip(label: Lang.name(code), detail: p.audioLangs.firstIndex(of: code).map { "\($0 + 1)" }, selected: p.audioLangs.contains(code)) {
                                if let i = draft?.audioLangs.firstIndex(of: code) { draft?.audioLangs.remove(at: i) } else { draft?.audioLangs.append(code) }
                            }
                        }
                    }
                }
                .focusSection()

                VStack(alignment: .leading, spacing: 18) {
                    Eyebrow("Ondertitels")
                    HStack(spacing: 14) {
                        Chip(label: String(localized: "Uit"), selected: !p.subtitlesOn) { draft?.subtitlesOn = false }
                        ForEach(["nl", "en", "de", "fr", "es", "tr", "ar"], id: \.self) { code in
                            Chip(label: Lang.name(code), selected: p.subtitlesOn && p.subtitleLangs.first == code) {
                                draft?.subtitlesOn = true
                                draft?.subtitleLangs = [code] + (draft?.subtitleLangs.filter { $0 != code } ?? [])
                            }
                        }
                    }
                }
                .focusSection()
            }
            .padding(Theme.gutter)
        }
    }
}

// MARK: - Sources

struct AddSourceView: View {
    let type: SourceType
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var server = ""
    @State private var username = ""
    @State private var password = ""
    @State private var playlist = ""
    @State private var epg = ""
    @State private var status: String?
    @State private var busy = false
    @State private var ok = false

    var body: some View {
        HStack(alignment: .top, spacing: 80) {
            VStack(alignment: .leading, spacing: 24) {
                Image(systemName: type == .xtream ? "server.rack" : "list.bullet.rectangle").font(.system(size: 90, weight: .light))
                Text(type == .xtream ? "Xtream Codes" : "M3U-afspeellijst").font(Theme.title1)
                Text(type == .xtream
                     ? "Vul de gegevens van je IPTV-abonnement in. Het wachtwoord wordt alleen in de sleutelhanger van deze Apple TV bewaard."
                     : "Plak de url van je M3U- of M3U8-afspeellijst. Een gids (XMLTV) is optioneel; vaak staat die al in de afspeellijst.")
                    .font(Theme.body).foregroundStyle(Theme.text2)
                if let status {
                    Label(status, systemImage: ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .font(Theme.callout)
                        .foregroundStyle(ok ? Theme.success : Theme.live)
                }
            }
            .frame(width: 640, alignment: .leading)

            Form {
                Section {
                    TextField("Naam (optioneel)", text: $name)
                    if type == .xtream {
                        TextField("Server, bijv. http://provider.tv:8080", text: $server)
                            .keyboardType(.URL).textContentType(.URL)
                        TextField("Gebruikersnaam", text: $username).textContentType(.username)
                        SecureField("Wachtwoord", text: $password).textContentType(.password)
                    } else {
                        TextField("Afspeellijst-url", text: $playlist).keyboardType(.URL).textContentType(.URL)
                    }
                    TextField("EPG-url (optioneel)", text: $epg).keyboardType(.URL)
                }
                Section {
                    Button { Task { await test() } } label: { Label(busy ? "Bezig…" : "Testen", systemImage: "bolt.horizontal.circle") }
                        .disabled(busy || !isComplete)
                    Button { Task { await save() } } label: { Label("Opslaan", systemImage: "checkmark") }
                        .disabled(busy || !isComplete)
                }
            }
        }
        .padding(.horizontal, Theme.gutter)
        .background(AmbientBackground())
    }

    private var isComplete: Bool {
        type == .xtream ? (!server.isEmpty && !username.isEmpty && !password.isEmpty) : URL(string: playlist)?.scheme != nil
    }

    private func makeSource() -> SourceConfig {
        let fallbackName = type == .xtream ? (URL(string: Xtream.normalizeServer(server))?.host() ?? "Xtream") : (URL(string: playlist)?.host() ?? "M3U")
        return SourceConfig(name: name.isEmpty ? fallbackName : name, type: type,
                            serverUrl: type == .xtream ? Xtream.normalizeServer(server) : nil,
                            username: type == .xtream ? username.trimmingCharacters(in: .whitespaces) : nil,
                            playlistUrl: type == .m3u ? playlist.trimmingCharacters(in: .whitespaces) : nil,
                            epgUrl: epg.isEmpty ? nil : epg)
    }

    private func test() async {
        busy = true
        defer { busy = false }
        let source = makeSource()
        let loader = SourceLoader(engine: app.engine)
        do {
            if type == .xtream {
                let info = try await loader.testXtream(XtreamCredentials(serverUrl: source.serverUrl ?? "", username: source.username ?? "", password: password), sourceId: source.id)
                var text = String(localized: "Verbonden")
                if let exp = info.expiresAt, exp > 0 {
                    text += " · " + String(localized: "geldig tot \(Date(timeIntervalSince1970: exp / 1000).formatted(date: .abbreviated, time: .omitted))")
                }
                status = text
            } else {
                let json = try await loader.loadM3U(source)
                let raw = try? JSONDecoder.core.decode(RawCatalog.self, from: Data(json.utf8))
                status = String(localized: "\(raw?.movies.count ?? 0) films, \(raw?.series.count ?? 0) series, \(raw?.channels.count ?? 0) zenders gevonden")
            }
            ok = true
        } catch {
            ok = false
            status = error.localizedDescription
        }
    }

    private func save() async {
        do {
            try app.sources.add(makeSource(), password: type == .xtream ? password : nil)
            password = ""
            dismiss()
            await app.start(force: true)
        } catch {
            ok = false
            status = error.localizedDescription
        }
    }
}

struct SourceDetailView: View {
    let sourceId: String
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var confirmDelete = false
    @State private var status: String?

    var body: some View {
        if let source = app.sources.sources.first(where: { $0.id == sourceId }) {
            HStack(alignment: .top, spacing: 80) {
                VStack(alignment: .leading, spacing: 20) {
                    Image(systemName: source.type == .xtream ? "server.rack" : "list.bullet.rectangle").font(.system(size: 90, weight: .light))
                    Text(source.name).font(Theme.title1)
                    Text(source.detail).font(Theme.body).foregroundStyle(Theme.text2)
                    if let last = source.lastSyncAt {
                        Text("Laatst vernieuwd: \(Date(timeIntervalSince1970: last / 1000).formatted(date: .abbreviated, time: .shortened))")
                            .font(Theme.callout).foregroundStyle(Theme.text3)
                    }
                    if let err = source.lastError { Text(err).font(Theme.callout).foregroundStyle(Theme.live) }
                    if let status { Text(status).font(Theme.callout).foregroundStyle(Theme.text2) }
                }
                .frame(width: 640, alignment: .leading)

                List {
                    Toggle(isOn: Binding(get: { source.enabled }, set: { on in
                        app.sources.setEnabled(source.id, on)
                        Task { await app.start() }
                    })) { SettingsRow(icon: "power", title: "Ingeschakeld", value: nil) }
                    Button {
                        Task {
                            status = String(localized: "Bezig met vernieuwen…")
                            await app.start(force: true)
                            status = app.catalog.sourceErrors[source.id] ?? String(localized: "Vernieuwd")
                        }
                    } label: { SettingsRow(icon: "arrow.clockwise", title: "Nu vernieuwen", value: nil) }
                    if source.type == .xtream && !app.sources.hasPassword(source.id) {
                        Text("Het wachtwoord ontbreekt in de sleutelhanger. Verwijder de bron en voeg hem opnieuw toe.").foregroundStyle(Theme.live)
                    }
                    Button(role: .destructive) { confirmDelete = true } label: {
                        SettingsRow(icon: "trash", title: "Bron verwijderen", value: nil)
                    }
                }
            }
            .padding(.horizontal, Theme.gutter)
            .background(AmbientBackground())
            .confirmationDialog("Bron verwijderen?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Verwijderen", role: .destructive) {
                    app.sources.remove(source.id)
                    dismiss()
                    Task { await app.start() }
                }
                Button("Annuleren", role: .cancel) {}
            } message: {
                Text("De bron, de cache en het wachtwoord worden van deze Apple TV verwijderd.")
            }
        } else {
            EmptyStateView(systemImage: "questionmark", title: "Bron niet gevonden", message: "")
        }
    }
}

// MARK: - Appearance & about

struct AccentPicker: View {
    @Environment(AppModel.self) private var app
    var body: some View {
        VStack(alignment: .leading, spacing: 40) {
            Text("Accentkleur").font(Theme.title1)
            HStack(spacing: 40) {
                ForEach(Theme.accentChoices, id: \.hex) { choice in
                    Button { app.user.settings.accent = choice.hex } label: {
                        VStack(spacing: 16) {
                            Circle().fill(Color(hex: choice.hex)).frame(width: 140, height: 140)
                                .overlay(Circle().strokeBorder(.white, lineWidth: app.user.settings.accent == choice.hex ? 6 : 0))
                            Text(choice.name).font(Theme.callout)
                        }
                        .padding(20)
                    }
                    .buttonStyle(.borderless)
                }
            }
            Spacer()
        }
        .padding(Theme.gutter)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AmbientBackground())
    }
}

struct AboutView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 36) {
                Wordmark(size: 56)
                SpectrumLine().frame(width: 420)
                Text("Versie \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0") · kern \(app.catalog.coreVersion ?? "–")")
                    .font(Theme.callout).foregroundStyle(Theme.text3)
                Text("Alle IPTV-bronnen en talen samengevoegd tot één catalogus. Eén titel, alle versies: kies zelf de taal, ondertitels, kwaliteit en bron.")
                    .font(Theme.body).foregroundStyle(Theme.text2).frame(maxWidth: 1200, alignment: .leading)
                VStack(alignment: .leading, spacing: 14) {
                    Eyebrow("Juridisch")
                    Text("PrismaStream is een speler. De app levert zelf geen films, series of zenders en bevat geen content behalve fictieve demodata. Gebruik alleen bronnen waarvoor je de rechten hebt; jij bent verantwoordelijk voor de bronnen die je toevoegt.")
                        .font(Theme.body).foregroundStyle(Theme.text2).frame(maxWidth: 1200, alignment: .leading)
                }
                .padding(36)
                .background(RoundedRectangle(cornerRadius: 28, style: .continuous).fill(Theme.elev1))
                .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).strokeBorder(Theme.line))
                VStack(alignment: .leading, spacing: 14) {
                    Eyebrow("Privacy")
                    Text("Wachtwoorden staan alleen in de sleutelhanger van deze Apple TV. Profielen, favorieten en voortgang blijven op dit apparaat.")
                        .font(Theme.body).foregroundStyle(Theme.text2).frame(maxWidth: 1200, alignment: .leading)
                }
                .focusable()
            }
            .padding(Theme.gutter)
        }
        .background(AmbientBackground())
    }
}
