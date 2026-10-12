#!/usr/bin/env swift
// Generates the layered tvOS app icons and top-shelf images in the PrismaStream style
// (prism logo on near-black with spectral light). Run from tvos/: `swift Scripts/make-assets.swift`.

import AppKit
import CoreGraphics
import Foundation

let root = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "PrismaStream/Resources/Assets.xcassets")
let brand = root.appendingPathComponent("App Icon & Top Shelf Image.brandassets")
let info: [String: Any] = ["author": "xcode", "version": 1]

func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: a)
}

let spectrum: [UInt32] = [0xff6b8b, 0xffad6b, 0xffe58a, 0x7dffc4, 0x6bc8ff, 0x8f7bff, 0xe57bff]

func writeJSON(_ obj: Any, _ url: URL) throws {
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let data = try JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: url)
}

func render(_ w: Int, _ h: Int, opaque: Bool, _ draw: (CGContext, CGFloat, CGFloat) -> Void) -> Data {
    let cs = CGColorSpace(name: CGColorSpace.sRGB)!
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                        bitmapInfo: opaque ? CGImageAlphaInfo.noneSkipLast.rawValue : CGImageAlphaInfo.premultipliedLast.rawValue)!
    // Flip to a top-left origin.
    ctx.translateBy(x: 0, y: CGFloat(h))
    ctx.scaleBy(x: 1, y: -1)
    draw(ctx, CGFloat(w), CGFloat(h))
    let image = ctx.makeImage()!
    let rep = NSBitmapImageRep(cgImage: image)
    return rep.representation(using: .png, properties: [:])!
}

func background(_ c: CGContext, _ w: CGFloat, _ h: CGFloat, glowAt: CGPoint) {
    let cs = CGColorSpace(name: CGColorSpace.sRGB)!
    let g = CGGradient(colorsSpace: cs, colors: [rgb(0x07070b), rgb(0x120d26)] as CFArray, locations: [0, 1])!
    c.drawLinearGradient(g, start: .zero, end: CGPoint(x: w * 0.4, y: h), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    let glow = CGGradient(colorsSpace: cs, colors: [rgb(0x7c5cff, 0.55), rgb(0x7c5cff, 0)] as CFArray, locations: [0, 1])!
    c.drawRadialGradient(glow, startCenter: glowAt, startRadius: 0, endCenter: glowAt, endRadius: max(w, h) * 0.6, options: [])
    let teal = CGGradient(colorsSpace: cs, colors: [rgb(0x4fd1c5, 0.16), rgb(0x4fd1c5, 0)] as CFArray, locations: [0, 1])!
    c.drawRadialGradient(teal, startCenter: CGPoint(x: 0, y: h), startRadius: 0, endCenter: CGPoint(x: 0, y: h), endRadius: max(w, h) * 0.5, options: [])
}

/// Logo geometry (Logo.svelte, 40×40) mapped into a square of `size` at `origin`.
struct Mark {
    var origin: CGPoint
    var size: CGFloat
    func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: origin.x + x * size / 40, y: origin.y + y * size / 40) }
    var k: CGFloat { size / 40 }
}

func drawFan(_ c: CGContext, _ m: Mark, extendTo: CGFloat? = nil) {
    let cs = CGColorSpace(name: CGColorSpace.sRGB)!
    let tip = m.p(25, 18.5)
    let x1 = extendTo ?? m.p(39, 0).x
    let topY = m.p(0, 11).y, botY = m.p(0, 29).y
    let spread = extendTo == nil ? 1 : (x1 - tip.x) / (m.p(39, 0).x - tip.x)
    let top = tip.y + (topY - tip.y) * spread
    let bottom = tip.y + (botY - tip.y) * spread
    for (i, hex) in spectrum.enumerated() {
        let y0 = top + (bottom - top) * CGFloat(i) / CGFloat(spectrum.count)
        let y1 = top + (bottom - top) * CGFloat(i + 1) / CGFloat(spectrum.count)
        c.saveGState()
        c.beginPath()
        c.move(to: tip)
        c.addLine(to: CGPoint(x: x1, y: y0))
        c.addLine(to: CGPoint(x: x1, y: y1 + 0.5))
        c.closePath()
        c.clip()
        let g = CGGradient(colorsSpace: cs, colors: [rgb(hex, 0.3), rgb(hex, 0.78)] as CFArray, locations: [0, 1])!
        c.drawLinearGradient(g, start: tip, end: CGPoint(x: x1, y: tip.y), options: [.drawsAfterEndLocation])
        c.restoreGState()
    }
    // Exit glow.
    let glow = CGGradient(colorsSpace: cs, colors: [rgb(0xffffff, 0.85), rgb(0xffffff, 0)] as CFArray, locations: [0, 1])!
    c.drawRadialGradient(glow, startCenter: tip, startRadius: 0, endCenter: tip, endRadius: m.k * 4.5, options: [])
}

func drawBeam(_ c: CGContext, _ m: Mark, from x0: CGFloat? = nil) {
    c.setStrokeColor(rgb(0xffffff, 0.92))
    c.setLineWidth(1.6 * m.k)
    c.setLineCap(.round)
    let a = m.p(2, 21.5), b = m.p(15, 19.6)
    var start = a
    if let x0 { start = CGPoint(x: x0, y: a.y + (a.x - x0) * (a.y - b.y) / (b.x - a.x)) }
    c.move(to: start)
    c.addLine(to: b)
    c.strokePath()
}

func drawPrism(_ c: CGContext, _ m: Mark) {
    let cs = CGColorSpace(name: CGColorSpace.sRGB)!
    let path = CGMutablePath()
    path.move(to: m.p(20, 6))
    path.addLine(to: m.p(30.5, 27))
    path.addLine(to: m.p(9.5, 27))
    path.closeSubpath()
    // Glass body.
    c.saveGState()
    c.addPath(path)
    c.clip()
    let body = CGGradient(colorsSpace: cs, colors: [rgb(0xffffff, 0.16), rgb(0x8f7bff, 0.08)] as CFArray, locations: [0, 1])!
    c.drawLinearGradient(body, start: m.p(20, 6), end: m.p(20, 27), options: [])
    c.restoreGState()
    // Outline with a gradient stroke.
    c.saveGState()
    c.addPath(path)
    c.setLineWidth(2.2 * m.k)
    c.setLineJoin(.round)
    c.replacePathWithStrokedPath()
    c.clip()
    let stroke = CGGradient(colorsSpace: cs, colors: [rgb(0xffffff, 0.98), rgb(0xffffff, 0.6)] as CFArray, locations: [0, 1])!
    c.drawLinearGradient(stroke, start: m.p(0, 0), end: m.p(40, 40), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    c.restoreGState()
}

func imageset(_ dir: URL, _ files: [(String, String)], idiom: String = "tv") throws {
    var images: [[String: Any]] = []
    for (scale, name) in files { images.append(["filename": name, "idiom": idiom, "scale": scale]) }
    try writeJSON(["images": images, "info": info], dir.appendingPathComponent("Contents.json"))
}

func stack(_ name: String, w: Int, h: Int, scales: [Int], idiom: String) throws {
    let dir = brand.appendingPathComponent("\(name).imagestack")
    try writeJSON(["info": info, "layers": [["filename": "Front.imagestacklayer"], ["filename": "Middle.imagestacklayer"], ["filename": "Back.imagestacklayer"]]],
                  dir.appendingPathComponent("Contents.json"))
    for layer in ["Back", "Middle", "Front"] {
        let layerDir = dir.appendingPathComponent("\(layer).imagestacklayer")
        try writeJSON(["info": info], layerDir.appendingPathComponent("Contents.json"))
        let setDir = layerDir.appendingPathComponent("Content.imageset")
        var files: [(String, String)] = []
        for s in scales {
            let W = w * s, H = h * s
            let file = "\(layer.lowercased())\(s > 1 ? "@\(s)x" : "").png"
            let size = CGFloat(H) * 0.78
            let mark = Mark(origin: CGPoint(x: (CGFloat(W) - size) / 2, y: (CGFloat(H) - size) / 2 + CGFloat(H) * 0.02), size: size)
            let data = render(W, H, opaque: layer == "Back") { c, cw, ch in
                switch layer {
                case "Back":
                    background(c, cw, ch, glowAt: CGPoint(x: cw * 0.5, y: ch * 0.42))
                case "Middle":
                    drawFan(c, mark, extendTo: cw + 2)
                    drawBeam(c, mark, from: -2)
                default:
                    drawPrism(c, mark)
                }
            }
            try FileManager.default.createDirectory(at: setDir, withIntermediateDirectories: true)
            try data.write(to: setDir.appendingPathComponent(file))
            files.append(("\(s)x", file))
        }
        try imageset(setDir, files, idiom: idiom)
    }
}

func topShelf(_ name: String, w: Int, h: Int) throws {
    let dir = brand.appendingPathComponent("\(name).imageset")
    var files: [(String, String)] = []
    for s in [1, 2] {
        let W = w * s, H = h * s
        let file = "\(name.lowercased().replacingOccurrences(of: " ", with: "-"))\(s > 1 ? "@\(s)x" : "").png"
        let data = render(W, H, opaque: true) { c, cw, ch in
            background(c, cw, ch, glowAt: CGPoint(x: cw * 0.62, y: ch * 0.3))
            let size = ch * 0.7
            let mark = Mark(origin: CGPoint(x: cw * 0.6 - size / 2, y: (ch - size) / 2), size: size)
            drawFan(c, mark, extendTo: cw + 2)
            drawBeam(c, mark, from: cw * 0.38)
            drawPrism(c, mark)
            // Wordmark + tagline.
            NSGraphicsContext.saveGraphicsState()
            c.saveGState()
            c.translateBy(x: 0, y: ch)
            c.scaleBy(x: 1, y: -1)
            NSGraphicsContext.current = NSGraphicsContext(cgContext: c, flipped: false)
            let big = ch * 0.13
            let word = NSMutableAttributedString(string: "Prisma", attributes: [.font: NSFont.systemFont(ofSize: big, weight: .heavy), .foregroundColor: NSColor.white, .kern: -big * 0.02])
            word.append(NSAttributedString(string: "Stream", attributes: [.font: NSFont.systemFont(ofSize: big, weight: .regular), .foregroundColor: NSColor(white: 1, alpha: 0.72), .kern: -big * 0.02]))
            word.draw(at: CGPoint(x: cw * 0.065, y: ch * 0.5))
            let tag = NSAttributedString(string: "Alle bronnen. Alle talen. Eén catalogus.", attributes: [.font: NSFont.systemFont(ofSize: ch * 0.045, weight: .medium), .foregroundColor: NSColor(white: 1, alpha: 0.6)])
            tag.draw(at: CGPoint(x: cw * 0.067, y: ch * 0.4))
            c.restoreGState()
            NSGraphicsContext.restoreGraphicsState()
        }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try data.write(to: dir.appendingPathComponent(file))
        files.append(("\(s)x", file))
    }
    try imageset(dir, files)
}

try? FileManager.default.removeItem(at: brand)
try writeJSON(["info": info, "assets": [
    ["filename": "App Icon - App Store.imagestack", "idiom": "tv", "role": "primary-app-icon", "size": "1280x768"],
    ["filename": "App Icon.imagestack", "idiom": "tv", "role": "primary-app-icon", "size": "400x240"],
    ["filename": "Top Shelf Image Wide.imageset", "idiom": "tv", "role": "top-shelf-image-wide", "size": "2320x720"],
    ["filename": "Top Shelf Image.imageset", "idiom": "tv", "role": "top-shelf-image", "size": "1920x720"]
]], brand.appendingPathComponent("Contents.json"))
try stack("App Icon", w: 400, h: 240, scales: [1, 2], idiom: "tv")
try stack("App Icon - App Store", w: 1280, h: 768, scales: [1], idiom: "tv")
try topShelf("Top Shelf Image", w: 1920, h: 720)
try topShelf("Top Shelf Image Wide", w: 2320, h: 720)

// Colors.
func colorset(_ name: String, _ r: Double, _ g: Double, _ b: Double) throws {
    try writeJSON(["info": info, "colors": [["idiom": "universal", "color": ["color-space": "srgb", "components": ["red": String(format: "%.3f", r), "green": String(format: "%.3f", g), "blue": String(format: "%.3f", b), "alpha": "1.000"]]]]],
                  root.appendingPathComponent("\(name).colorset/Contents.json"))
}
try colorset("AccentColor", 124 / 255.0, 92 / 255.0, 255 / 255.0)
try colorset("LaunchBackground", 7 / 255.0, 7 / 255.0, 11 / 255.0)
try writeJSON(["info": info], root.appendingPathComponent("Contents.json"))
print("Assets written to \(root.path)")
