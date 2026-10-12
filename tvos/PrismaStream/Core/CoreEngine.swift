// Swift bridge to the shared TypeScript core (Resources/prisma-core.js, global `PrismaCore`).
//
// One JSContext lives on one private serial queue; every touch of the context (calls, timers,
// promise settlement) happens on that queue. The public API is async and speaks Swift types;
// arguments and results cross the boundary as JSON strings, exactly as docs/TVOS.md specifies.
// A missing or broken bundle never crashes the app: every call then throws a CoreError that the
// UI shows as a friendly error state.

import Foundation
import JavaScriptCore
import os

public enum CoreError: LocalizedError, Equatable, Sendable {
    case bundleMissing
    case loadFailed(String)
    case missingFunction(String)
    case js(function: String, message: String)
    case decoding(function: String, message: String)

    public var errorDescription: String? {
        switch self {
        case .bundleMissing:
            String(localized: "De app-kern (prisma-core.js) ontbreekt in deze build.")
        case .loadFailed(let m):
            String(localized: "De app-kern kon niet worden geladen: \(m)")
        case .missingFunction(let f):
            String(localized: "De app-kern mist de functie \(f).")
        case .js(let f, let m):
            String(localized: "Fout in \(f): \(m)")
        case .decoding(let f, let m):
            String(localized: "Onverwachte gegevens van \(f): \(m)")
        }
    }
}

/// An argument for a core function. JSON arguments are encoded before they reach the JS queue.
public enum JSArg: Sendable {
    case string(String)
    case number(Double)
    case null

    public static func json<T: Encodable>(_ value: T) throws -> JSArg {
        let data = try JSONEncoder.core.encode(value)
        return .string(String(decoding: data, as: UTF8.self))
    }
}

extension JSONEncoder {
    static let core: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.withoutEscapingSlashes]
        return e
    }()
}

extension JSONDecoder {
    static let core = JSONDecoder()
}

/// Wraps a non-Sendable value that is only ever touched on the engine queue.
private struct QueueBound<T>: @unchecked Sendable {
    let value: T
}

public final class CoreEngine: @unchecked Sendable {
    public static let shared = CoreEngine()

    static let log = Logger(subsystem: "nl.tuwi.prismastream.tv", category: "core")

    private let queue = DispatchQueue(label: "nl.tuwi.prismastream.core", qos: .userInitiated)
    private let scriptURL: URL?

    // Everything below is confined to `queue`.
    private var context: JSContext?
    private var loadResult: Result<Void, CoreError>?
    private var timers: [Int: DispatchWorkItem] = [:]
    private var nextTimerId = 1
    private var pending: [Int: CheckedContinuation<String, Error>] = [:]
    private var nextCallId = 1
    private var catalogJSON: String?

    /// - Parameter scriptURL: the core bundle; `nil` simulates a build without the bundle.
    public init(scriptURL: URL? = CoreEngine.defaultScriptURL) {
        self.scriptURL = scriptURL
    }

    public static var defaultScriptURL: URL? {
        Bundle.main.url(forResource: "prisma-core", withExtension: "js")
            ?? Bundle(for: CoreEngine.self).url(forResource: "prisma-core", withExtension: "js")
    }

    // MARK: - Loading

    /// Loads the bundle (once). Returns the load error, if any.
    public func load() async -> CoreError? {
        await withCheckedContinuation { cont in
            queue.async {
                if case .failure(let e) = self.ensureLoaded() { cont.resume(returning: e) } else { cont.resume(returning: nil) }
            }
        }
    }

    private func ensureLoaded() -> Result<Void, CoreError> {
        dispatchPrecondition(condition: .onQueue(queue))
        if let loadResult { return loadResult }
        let result = loadContext()
        loadResult = result
        return result
    }

    private func loadContext() -> Result<Void, CoreError> {
        guard let scriptURL, let source = try? String(contentsOf: scriptURL, encoding: .utf8) else {
            Self.log.error("prisma-core.js ontbreekt in de bundle")
            return .failure(.bundleMissing)
        }
        guard let vm = JSVirtualMachine(), let ctx = JSContext(virtualMachine: vm) else {
            return .failure(.loadFailed("JSContext"))
        }
        ctx.name = "PrismaCore"
        ctx.exceptionHandler = { ctx, exception in
            let message = exception?.toString() ?? "unknown"
            let stack = exception?.forProperty("stack")?.toString() ?? ""
            CoreEngine.log.error("JS-uitzondering: \(message, privacy: .public) \(stack, privacy: .private)")
            ctx?.exception = exception
        }
        installShims(in: ctx)

        ctx.exception = nil
        ctx.evaluateScript(source, withSourceURL: scriptURL)
        if let ex = ctx.exception {
            let message = ex.toString() ?? "?"
            ctx.exception = nil
            return .failure(.loadFailed(message))
        }
        ctx.evaluateScript(Self.helperScript, withSourceURL: URL(string: "prisma-bridge.js"))
        if let ex = ctx.exception {
            return .failure(.loadFailed(ex.toString() ?? "bridge"))
        }
        let defined = ctx.evaluateScript("typeof globalThis.PrismaCore === 'object' || typeof globalThis.PrismaCore === 'function'")?.toBool() ?? false
        guard defined else { return .failure(.loadFailed("global PrismaCore ontbreekt")) }
        context = ctx
        Self.log.info("PrismaCore geladen")
        return .success(())
    }

    private func installShims(in ctx: JSContext) {
        // console.* → os_log. Messages may contain user data, so they are logged as private.
        let console = JSValue(newObjectIn: ctx)
        for level in ["log", "info", "debug", "warn", "error"] {
            let block: @convention(block) () -> Void = {
                let args = JSContext.currentArguments() as? [JSValue] ?? []
                let text = args.map { $0.toString() ?? "" }.joined(separator: " ")
                switch level {
                case "error": CoreEngine.log.error("[js] \(text, privacy: .private)")
                case "warn": CoreEngine.log.warning("[js] \(text, privacy: .private)")
                case "debug": CoreEngine.log.debug("[js] \(text, privacy: .private)")
                default: CoreEngine.log.info("[js] \(text, privacy: .private)")
                }
            }
            console?.setObject(block, forKeyedSubscript: level as NSString)
        }
        ctx.setObject(console, forKeyedSubscript: "console" as NSString)

        // setTimeout / clearTimeout / setInterval / clearInterval on the engine queue.
        let setTimer: @convention(block) (JSValue, JSValue) -> Int = { [weak self] fn, ms in
            guard let self else { return 0 }
            let extra = Array((JSContext.currentArguments() as? [JSValue] ?? []).dropFirst(2))
            return self.schedule(fn, delayMs: ms.isNumber ? ms.toDouble() : 0, args: extra, repeats: false)
        }
        let setRepeating: @convention(block) (JSValue, JSValue) -> Int = { [weak self] fn, ms in
            guard let self else { return 0 }
            let extra = Array((JSContext.currentArguments() as? [JSValue] ?? []).dropFirst(2))
            return self.schedule(fn, delayMs: ms.isNumber ? ms.toDouble() : 0, args: extra, repeats: true)
        }
        let clearTimer: @convention(block) (JSValue) -> Void = { [weak self] id in
            guard let self, id.isNumber else { return }
            let key = Int(id.toInt32())
            self.timers[key]?.cancel()
            self.timers[key] = nil
        }
        ctx.setObject(setTimer, forKeyedSubscript: "setTimeout" as NSString)
        ctx.setObject(clearTimer, forKeyedSubscript: "clearTimeout" as NSString)
        ctx.setObject(setRepeating, forKeyedSubscript: "setInterval" as NSString)
        ctx.setObject(clearTimer, forKeyedSubscript: "clearInterval" as NSString)

        // Settlement of promise-returning core functions.
        let settle: @convention(block) (Int, Bool, String) -> Void = { [weak self] id, ok, value in
            guard let self, let cont = self.pending.removeValue(forKey: id) else { return }
            if ok { cont.resume(returning: value) } else { cont.resume(throwing: CoreError.js(function: "async", message: value)) }
        }
        ctx.setObject(settle, forKeyedSubscript: "__prismaSettle" as NSString)

        ctx.evaluateScript(Self.polyfillScript, withSourceURL: URL(string: "prisma-polyfills.js"))
    }

    private func schedule(_ fn: JSValue, delayMs: Double, args: [JSValue], repeats: Bool) -> Int {
        dispatchPrecondition(condition: .onQueue(queue))
        let id = nextTimerId
        nextTimerId += 1
        let bound = QueueBound(value: (fn, args))
        let delay = max(0, delayMs.isFinite ? delayMs : 0) / 1000
        let item = DispatchWorkItem { [weak self] in
            guard let self else { return }
            if !repeats { self.timers[id] = nil }
            let (fn, args) = bound.value
            if fn.isObject {
                fn.call(withArguments: args)
            } else if let code = fn.toString() {
                fn.context.evaluateScript(code)
            }
            if repeats, self.timers[id] != nil {
                _ = self.reschedule(id: id, fn: fn, args: args, delay: delay)
            }
        }
        timers[id] = item
        queue.asyncAfter(deadline: .now() + delay, execute: item)
        return id
    }

    private func reschedule(id: Int, fn: JSValue, args: [JSValue], delay: Double) -> Int {
        let bound = QueueBound(value: (fn, args))
        let item = DispatchWorkItem { [weak self] in
            guard let self, self.timers[id] != nil else { return }
            bound.value.0.call(withArguments: bound.value.1)
            _ = self.reschedule(id: id, fn: bound.value.0, args: bound.value.1, delay: delay)
        }
        timers[id] = item
        queue.asyncAfter(deadline: .now() + max(delay, 0.001), execute: item)
        return id
    }

    // MARK: - Generic invocation

    /// Calls `PrismaCore[name](...args)` and returns the result as a string (JSON or plain).
    /// `pick` extracts one property of a JSON object result (still JSON).
    func invoke(_ name: String, _ args: [JSArg] = [], pick: String? = nil) async throws -> String {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<String, Error>) in
            queue.async {
                switch self.ensureLoaded() {
                case .failure(let e):
                    cont.resume(throwing: e)
                case .success:
                    self.invokeOnQueue(name, args, pick: pick, cont: cont)
                }
            }
        }
    }

    private func invokeOnQueue(_ name: String, _ args: [JSArg], pick: String?, cont: CheckedContinuation<String, Error>) {
        guard let ctx = context, let helper = ctx.objectForKeyedSubscript("__prismaInvoke") else {
            cont.resume(throwing: CoreError.bundleMissing)
            return
        }
        let id = nextCallId
        nextCallId += 1
        let jsArgs: [Any] = args.map {
            switch $0 {
            case .string(let s): s
            case .number(let n): n
            case .null: NSNull()
            }
        }
        ctx.exception = nil
        guard let envelope = helper.call(withArguments: [id, name, jsArgs, pick ?? NSNull()]), envelope.isObject else {
            let message = ctx.exception?.toString() ?? "geen resultaat"
            ctx.exception = nil
            cont.resume(throwing: CoreError.js(function: name, message: message))
            return
        }
        if envelope.forProperty("missing")?.toBool() == true {
            cont.resume(throwing: CoreError.missingFunction("PrismaCore.\(name)"))
        } else if envelope.forProperty("async")?.toBool() == true {
            pending[id] = cont
        } else if envelope.forProperty("ok")?.toBool() == true {
            cont.resume(returning: envelope.forProperty("value")?.toString() ?? "null")
        } else {
            let message = envelope.forProperty("error")?.toString() ?? "onbekende fout"
            CoreEngine.log.error("PrismaCore.\(name, privacy: .public) faalde: \(message, privacy: .private)")
            cont.resume(throwing: CoreError.js(function: name, message: message))
        }
    }

    func decode<T: Decodable>(_ type: T.Type, _ json: String, function: String) throws -> T {
        do {
            return try JSONDecoder.core.decode(T.self, from: Data(json.utf8))
        } catch {
            throw CoreError.decoding(function: function, message: String(describing: error))
        }
    }

    func call<T: Decodable>(_ name: String, _ args: [JSArg] = [], as type: T.Type) async throws -> T {
        try decode(T.self, try await invoke(name, args), function: name)
    }

    /// For functions that return a plain string (which may or may not be JSON-quoted).
    func callPlain(_ name: String, _ args: [JSArg] = []) async throws -> String {
        Self.plain(try await invoke(name, args))
    }

    static func plain(_ s: String) -> String {
        if s.hasPrefix("\""), let decoded = try? JSONDecoder.core.decode(String.self, from: Data(s.utf8)) { return decoded }
        return s == "null" ? "" : s
    }

    private func onQueue<T: Sendable>(_ work: @escaping @Sendable () throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { cont in
            queue.async {
                if case .failure(let e) = self.ensureLoaded() {
                    cont.resume(throwing: e)
                    return
                }
                cont.resume(with: Result { try work() })
            }
        }
    }

    // MARK: - Contract API (docs/TVOS.md)

    public func version() async throws -> String {
        try await callPlain("version")
    }

    /// The three demo sources' raw catalogs, as a JSON array string (passed through losslessly).
    public func sampleCatalogsJSON() async throws -> String {
        try await invoke("sampleCatalogs")
    }

    /// The raw demo catalogs split per source: `[sourceId: RawCatalog JSON]`.
    public func sampleCatalogsBySource() async throws -> [String: String] {
        let json = try await invoke("sampleCatalogs")
        return try await onQueue {
            guard let ctx = self.context,
                  let fn = ctx.evaluateScript("(function(s){var a=JSON.parse(s);var o={};for(var i=0;i<a.length;i++){o[a[i].sourceId]=JSON.stringify(a[i]);}return JSON.stringify(o);})"),
                  let out = fn.call(withArguments: [json])?.toString() else { return [:] }
            return (try? JSONDecoder.core.decode([String: String].self, from: Data(out.utf8))) ?? [:]
        }
    }

    public func sampleSources() async throws -> [SampleSourceInfo] {
        try await call("sampleSources", as: [SampleSourceInfo].self)
    }

    public struct BuildOptions: Encodable, Sendable {
        public var sourceNames: [String: String]
        public var preferLang: String?
        public init(sourceNames: [String: String] = [:], preferLang: String? = nil) {
            self.sourceNames = sourceNames
            self.preferLang = preferLang
        }
    }

    /// Builds the merged catalog from raw catalog JSON strings, keeps it in the engine for
    /// search / recommend, and builds the search index.
    public func buildCatalog(rawJSON: [String], options: BuildOptions) async throws -> Catalog {
        let raws = "[" + rawJSON.joined(separator: ",") + "]"
        let json = try await invoke("buildCatalog", [.string(raws), try .json(options)])
        let catalog = try decode(Catalog.self, json, function: "buildCatalog")
        try await onQueue {
            self.catalogJSON = json
            let set = self.context?.objectForKeyedSubscript("__prismaSetCatalog")
            set?.call(withArguments: [json])
        }
        do {
            _ = try await invoke("searchIndex")
        } catch {
            CoreEngine.log.error("searchIndex faalde: \(error.localizedDescription, privacy: .public)")
        }
        return catalog
    }

    public func mergeSeasons(title: Title, episodesBySource: [RawEpisodesBySource]) async throws -> Title {
        try await call("mergeSeasons", [try .json(title), try .json(episodesBySource)], as: Title.self)
    }

    /// mergeSeasons with source items given as raw JSON (`{sourceId, providerId, langs, episodes, info?}`).
    public func mergeSeasons(title: Title, sourcesJSON: [String], preferLang: String?) async throws -> Title {
        let opts = preferLang.map { "{\"preferLang\":\"\($0)\"}" } ?? "{}"
        return try await call("mergeSeasons", [try .json(title), .string("[" + sourcesJSON.joined(separator: ",") + "]"), .string(opts)], as: Title.self)
    }

    /// Builds one mergeSeasons source item from a raw ref and xtreamMap('seriesDetails') output.
    public func seriesSourceItem(ref: RawRef, detailsJSON: String) async throws -> String {
        let refJSON = String(decoding: try JSONEncoder.core.encode(ref), as: UTF8.self)
        return try await onQueue { () -> String in
            guard let fn = self.context?.evaluateScript("(function(r,d){var o=JSON.parse(r);var x=JSON.parse(d)||{};if(Array.isArray(x)){o.episodes=x;}else{o.info=x.info||undefined;o.episodes=x.episodes||[];}return JSON.stringify(o);})"),
                  let out = fn.call(withArguments: [refJSON, detailsJSON])?.toString() else { return refJSON }
            return out
        }
    }

    /// Parses M3U text. Returns the RawCatalog as JSON plus the playlist's EPG url, if any.
    public func parseM3U(text: String, sourceId: String) async throws -> (catalogJSON: String, epgUrl: String?) {
        let json = try await invoke("parseM3U", [.string(text), .string(sourceId)])
        let catalogJSON = try await onQueue { () -> String in
            guard let fn = self.context?.evaluateScript("(function(s){var o=JSON.parse(s);return JSON.stringify(o&&o.catalog?o.catalog:o);})") else { return "null" }
            return fn.call(withArguments: [json])?.toString() ?? "null"
        }
        struct Envelope: Decodable { var epgUrl: String? }
        let epg = (try? JSONDecoder.core.decode(Envelope.self, from: Data(json.utf8)))?.epgUrl
        return (catalogJSON, epg)
    }

    public struct XtreamContext: Sendable {
        public var sourceId: String
        public var serverUrl: String
        public var username: String
        public var password: String
        /// Category map JSON (as returned by xtreamMap('vodCategories', ...)).
        public var categoriesJSON: String?
        public var seriesId: String?

        func json() -> String {
            var parts: [String] = []
            func q(_ s: String) -> String {
                (try? String(decoding: JSONEncoder.core.encode(s), as: UTF8.self)) ?? "\"\""
            }
            parts.append("\"sourceId\":\(q(sourceId))")
            parts.append("\"serverUrl\":\(q(serverUrl))")
            parts.append("\"username\":\(q(username))")
            parts.append("\"password\":\(q(password))")
            if let categoriesJSON, !categoriesJSON.isEmpty { parts.append("\"categories\":\(categoriesJSON)") }
            if let seriesId { parts.append("\"seriesId\":\(q(seriesId))") }
            return "{" + parts.joined(separator: ",") + "}"
        }
    }

    /// Maps raw Xtream API JSON. Returns the mapped JSON untouched (array or object).
    public func xtreamMap(kind: String, json: String, context: XtreamContext) async throws -> String {
        try await invoke("xtreamMap", [.string(kind), .string(json), .string(context.json())])
    }

    public struct XmltvOptions: Encodable, Sendable {
        public var windowStart: Double?
        public var windowEnd: Double?
        public var channelIds: [String]?
        public init(windowStart: Double? = nil, windowEnd: Double? = nil, channelIds: [String]? = nil) {
            self.windowStart = windowStart
            self.windowEnd = windowEnd
            self.channelIds = channelIds
        }
    }

    /// Parses XMLTV text into an EpgProgramme[] JSON string.
    public func parseXmltv(text: String, options: XmltvOptions) async throws -> String {
        try await invoke("parseXmltv", [.string(text), try .json(options)])
    }

    /// Appends EpgProgramme[] JSON to a RawCatalog JSON (both stay JSON; nothing is lost).
    public func spliceEpg(catalogJSON: String, epgJSON: String) async throws -> String {
        try await onQueue { () -> String in
            guard let fn = self.context?.evaluateScript("(function(c,e){var o=JSON.parse(c);var a=JSON.parse(e);if(Array.isArray(a)){o.epg=(o.epg||[]).concat(a);}return JSON.stringify(o);})"),
                  let out = fn.call(withArguments: [catalogJSON, epgJSON])?.toString(), out != "undefined" else { return catalogJSON }
            return out
        }
    }

    public func pickVariant(_ variants: [StreamVariant], prefs: LangPrefs, title: Title? = nil) async throws -> StreamVariant? {
        guard !variants.isEmpty else { return nil }
        var args: [JSArg] = [try .json(variants), try .json(prefs)]
        if let title { args.append(try .json(title)) }
        let json = try await invoke("pickVariant", args)
        if json == "null" || json.isEmpty { return nil }
        return try decode(StreamVariant.self, json, function: "pickVariant")
    }

    public func groupVariantsByLanguage(_ variants: [StreamVariant], audioLangs: [LangCode] = []) async throws -> [LanguageGroup] {
        guard !variants.isEmpty else { return [] }
        struct Prefs: Encodable { var audioLangs: [LangCode] }
        return try await call("groupVariantsByLanguage", [try .json(variants), try .json(Prefs(audioLangs: audioLangs))], as: [LanguageGroup].self)
    }

    public func summarizeLanguages(_ title: Title) async throws -> String {
        try await callPlain("summarizeLanguages", [try .json(title)])
    }

    public func displayTitle(_ title: Title, prefs: DisplayPrefs) async throws -> String {
        try await callPlain("displayTitle", [try .json(title), try .json(prefs)])
    }

    /// displayTitle and summarizeLanguages for every title of the current catalog in one pass.
    public func batchTitleTexts(prefs: DisplayPrefs) async throws -> (display: [String: String], languages: [String: String]) {
        let prefsJSON = String(decoding: try JSONEncoder.core.encode(prefs), as: UTF8.self)
        let display = try await invokeBatch("displayTitle", extra: prefsJSON)
        let langs = try await invokeBatch("summarizeLanguages", extra: prefsJSON)
        return (display, langs)
    }

    private func invokeBatch(_ name: String, extra: String?) async throws -> [String: String] {
        let out = try await onQueue { () -> String in
            guard let fn = self.context?.objectForKeyedSubscript("__prismaBatch") else { return "{}" }
            return fn.call(withArguments: [name, extra ?? NSNull()])?.toString() ?? "{}"
        }
        return (try? JSONDecoder.core.decode([String: String].self, from: Data(out.utf8))) ?? [:]
    }

    public func search(_ query: String, limit: Int = 40) async throws -> SearchResults {
        try await call("search", [.string(query), .number(Double(limit))], as: SearchResults.self)
    }

    /// Recommended title ids for the current catalog.
    public func recommend(history: [String], favorites: [String]) async throws -> [String] {
        try await call("recommend", [.null, try .json(history), try .json(favorites)], as: [String].self)
    }

    // MARK: - JS helpers

    private static let polyfillScript = """
    (function(g){
      if (typeof g.globalThis === 'undefined') { g.globalThis = g; }
      if (typeof g.self === 'undefined') { g.self = g; }
      if (typeof g.queueMicrotask !== 'function') { g.queueMicrotask = function(f){ Promise.resolve().then(f); }; }
      if (typeof g.performance === 'undefined') { var t0 = Date.now(); g.performance = { now: function(){ return Date.now() - t0; } }; }
      if (typeof g.crypto === 'undefined') {
        g.crypto = {
          getRandomValues: function(a){ for (var i = 0; i < a.length; i++) { a[i] = Math.floor(Math.random() * 4294967296); } return a; },
          randomUUID: function(){ return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){ var r = Math.random()*16|0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); }
        };
      }
    })(this);
    """

    private static let helperScript = """
    (function(g){
      function norm(v){ if (v === undefined) return 'null'; if (typeof v === 'string') return v; return JSON.stringify(v); }
      function msg(e){ return (e && e.message) ? String(e.message) : String(e); }
      function pick(s, path){
        if (!path) return s;
        var o = JSON.parse(s);
        var v = (o === null || o === undefined) ? undefined : o[path];
        return v === undefined ? 'null' : JSON.stringify(v);
      }
      g.__prismaInvoke = function(id, name, args, path){
        var core = g.PrismaCore;
        if (!core || typeof core[name] !== 'function') return { missing: true };
        try {
          var r = core[name].apply(core, args);
          if (r && typeof r.then === 'function') {
            r.then(function(v){ try { g.__prismaSettle(id, true, pick(norm(v), path)); } catch (e) { g.__prismaSettle(id, false, msg(e)); } },
                   function(e){ g.__prismaSettle(id, false, msg(e)); });
            return { async: true };
          }
          return { ok: true, value: pick(norm(r), path) };
        } catch (e) {
          return { ok: false, error: msg(e) };
        }
      };
      g.__prismaSetCatalog = function(json){ try { g.__prismaCatalog = JSON.parse(json); } catch (e) { g.__prismaCatalog = null; } };
      g.__prismaBatch = function(name, extra){
        var out = {};
        var cat = g.__prismaCatalog;
        var core = g.PrismaCore;
        if (!cat || !cat.titles || !core || typeof core[name] !== 'function') return JSON.stringify(out);
        for (var i = 0; i < cat.titles.length; i++) {
          var t = cat.titles[i];
          try {
            var r = extra === null || extra === undefined ? core[name](JSON.stringify(t)) : core[name](JSON.stringify(t), extra);
            if (typeof r === 'string' && r.charAt(0) === '"') { try { r = JSON.parse(r); } catch (e) {} }
            if (r !== undefined && r !== null) out[t.id] = String(r);
          } catch (e) {}
        }
        return JSON.stringify(out);
      };
    })(this);
    """
}
