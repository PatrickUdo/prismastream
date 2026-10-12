// Network layer: URLSession with timeouts, retries with backoff, and gzip detection for XMLTV
// (servers often send .xml.gz without Content-Encoding). Urls can contain credentials (Xtream),
// so only the host is ever logged.

import Compression
import Foundation
import os

public enum FetchError: LocalizedError, Equatable {
    case invalidURL
    case http(Int)
    case auth
    case network(String)
    case decoding

    public var errorDescription: String? {
        switch self {
        case .invalidURL: String(localized: "Ongeldig adres.")
        case .http(let code): String(localized: "De server antwoordde met fout \(code).")
        case .auth: String(localized: "Inloggen mislukt: controleer gebruikersnaam en wachtwoord.")
        case .network(let m): String(localized: "Netwerkfout: \(m)")
        case .decoding: String(localized: "De server stuurde onleesbare gegevens.")
        }
    }
}

public struct Fetcher: Sendable {
    static let log = Logger(subsystem: "nl.patrickudo.prismastream.tv", category: "net")

    public var retries: Int
    let session: URLSession

    public init(timeout: TimeInterval = 30, resourceTimeout: TimeInterval = 180, retries: Int = 2) {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = timeout
        config.timeoutIntervalForResource = resourceTimeout
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.httpAdditionalHeaders = [
            "User-Agent": "PrismaStream/1.0 (AppleTV; tvOS)",
            "Accept-Encoding": "gzip, deflate"
        ]
        session = URLSession(configuration: config)
        self.retries = retries
    }

    /// GET with retries for network errors and 5xx responses. 401/403 map to `.auth`.
    public func data(_ url: URL, timeout: TimeInterval? = nil) async throws -> Data {
        var attempt = 0
        while true {
            do {
                var request = URLRequest(url: url)
                if let timeout { request.timeoutInterval = timeout }
                let (data, response) = try await session.data(for: request)
                if let http = response as? HTTPURLResponse {
                    if http.statusCode == 401 || http.statusCode == 403 { throw FetchError.auth }
                    if http.statusCode >= 500, attempt < retries { throw FetchError.http(http.statusCode) }
                    guard (200..<300).contains(http.statusCode) else { throw FetchError.http(http.statusCode) }
                }
                return data
            } catch let error as FetchError where error == .auth {
                throw error
            } catch {
                if error is CancellationError || Task.isCancelled { throw CancellationError() }
                attempt += 1
                let host = url.host() ?? "?"
                Self.log.warning("Ophalen van \(host, privacy: .public) mislukt (poging \(attempt)): \(error.localizedDescription, privacy: .public)")
                if attempt > retries {
                    if let f = error as? FetchError { throw f }
                    throw FetchError.network(error.localizedDescription)
                }
                try await Task.sleep(for: .milliseconds(600 * attempt * attempt))
            }
        }
    }

    /// GET and decode as text; transparently gunzips when the payload starts with the gzip magic.
    public func text(_ url: URL, timeout: TimeInterval? = nil) async throws -> String {
        let raw = try await data(url, timeout: timeout)
        return try Self.decodeText(raw)
    }

    public static func decodeText(_ raw: Data) throws -> String {
        let data = Gzip.isGzip(raw) ? try Gzip.decompress(raw) : raw
        if let s = String(data: data, encoding: .utf8) { return s }
        if let s = String(data: data, encoding: .isoLatin1) { return s }
        throw FetchError.decoding
    }
}

public enum Gzip {
    public static func isGzip(_ data: Data) -> Bool {
        data.count > 18 && data[data.startIndex] == 0x1f && data[data.startIndex + 1] == 0x8b
    }

    /// Decompresses a gzip member (RFC 1952) by skipping its header and inflating the raw
    /// deflate stream with the Compression framework.
    public static func decompress(_ data: Data) throws -> Data {
        let bytes = [UInt8](data)
        guard bytes.count > 18, bytes[0] == 0x1f, bytes[1] == 0x8b, bytes[2] == 8 else { throw FetchError.decoding }
        let flags = bytes[3]
        var offset = 10
        if flags & 0x04 != 0 { // FEXTRA
            guard offset + 2 <= bytes.count else { throw FetchError.decoding }
            offset += 2 + Int(bytes[offset]) + Int(bytes[offset + 1]) << 8
        }
        if flags & 0x08 != 0 { // FNAME
            while offset < bytes.count, bytes[offset] != 0 { offset += 1 }
            offset += 1
        }
        if flags & 0x10 != 0 { // FCOMMENT
            while offset < bytes.count, bytes[offset] != 0 { offset += 1 }
            offset += 1
        }
        if flags & 0x02 != 0 { offset += 2 } // FHCRC
        guard offset < bytes.count - 8 else { throw FetchError.decoding }
        let deflate = Array(bytes[offset..<(bytes.count - 8)])
        return try inflate(deflate)
    }

    static func inflate(_ input: [UInt8]) throws -> Data {
        let stream = UnsafeMutablePointer<compression_stream>.allocate(capacity: 1)
        defer { stream.deallocate() }
        guard compression_stream_init(stream, COMPRESSION_STREAM_DECODE, COMPRESSION_ZLIB) == COMPRESSION_STATUS_OK else {
            throw FetchError.decoding
        }
        defer { compression_stream_destroy(stream) }
        let chunk = 1 << 16
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: chunk)
        defer { buffer.deallocate() }
        var output = Data()
        output.reserveCapacity(input.count * 6)
        return try input.withUnsafeBufferPointer { src -> Data in
            guard let base = src.baseAddress else { throw FetchError.decoding }
            stream.pointee.src_ptr = base
            stream.pointee.src_size = input.count
            while true {
                stream.pointee.dst_ptr = buffer
                stream.pointee.dst_size = chunk
                let status = compression_stream_process(stream, Int32(COMPRESSION_STREAM_FINALIZE.rawValue))
                let produced = chunk - stream.pointee.dst_size
                if produced > 0 { output.append(buffer, count: produced) }
                switch status {
                case COMPRESSION_STATUS_OK:
                    // Truncated input: nothing left to read and nothing produced.
                    if produced == 0, stream.pointee.src_size == 0 { return output }
                    continue
                case COMPRESSION_STATUS_END:
                    return output
                default:
                    throw FetchError.decoding
                }
            }
        }
    }
}
