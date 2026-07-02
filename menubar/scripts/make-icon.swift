// make-icon.swift - renders the BattCal app icon (1024px master) with CoreGraphics.
// Usage: swift make-icon.swift <output.png>
import AppKit

let size = CGFloat(1024)
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon-1024.png"

let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size),
                              bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                              colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
let nsCtx = NSGraphicsContext(bitmapImageRep: bitmap)!
NSGraphicsContext.current = nsCtx
let ctx = nsCtx.cgContext

func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: a)
}

// macOS icon plate: 824x824 rounded rect centered, radius 185.
let plate = CGRect(x: 100, y: 100, width: 824, height: 824)
let platePath = CGPath(roundedRect: plate, cornerWidth: 185, cornerHeight: 185, transform: nil)

// Soft shadow under the plate
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 36, color: rgb(0x000000, 0.35))
ctx.addPath(platePath)
ctx.setFillColor(rgb(0x0d366b))
ctx.fillPath()
ctx.restoreGState()

// Vertical gradient fill (light top -> deep bottom)
ctx.saveGState()
ctx.addPath(platePath)
ctx.clip()
let grad = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                      colors: [rgb(0x3987e5), rgb(0x1c5cab), rgb(0x0d366b)] as CFArray,
                      locations: [0, 0.55, 1])!
ctx.drawLinearGradient(grad, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])

// Subtle top sheen
let sheen = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                       colors: [rgb(0xffffff, 0.18), rgb(0xffffff, 0.0)] as CFArray,
                       locations: [0, 1])!
ctx.drawLinearGradient(sheen, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 620), options: [])
ctx.restoreGState()

// Battery body (white outline)
let body = CGRect(x: 248, y: 372, width: 500, height: 280)
let bodyPath = CGPath(roundedRect: body, cornerWidth: 62, cornerHeight: 62, transform: nil)
ctx.addPath(bodyPath)
ctx.setStrokeColor(rgb(0xffffff))
ctx.setLineWidth(36)
ctx.strokePath()

// Battery terminal cap
let cap = CGRect(x: 766, y: 452, width: 52, height: 120)
ctx.addPath(CGPath(roundedRect: cap, cornerWidth: 20, cornerHeight: 20, transform: nil))
ctx.setFillColor(rgb(0xffffff))
ctx.fillPath()

// Liquid fill inside the battery: ~2/3 full with a wave on its right edge
let inner = body.insetBy(dx: 40, dy: 40)
let fillX = inner.minX + inner.width * 0.62
let wave = CGMutablePath()
wave.move(to: CGPoint(x: inner.minX, y: inner.minY))
wave.addLine(to: CGPoint(x: fillX - 26, y: inner.minY))
var y = inner.minY
let amp: CGFloat = 22
while y < inner.maxY {
    let t = (y - inner.minY) / inner.height
    let x = fillX + sin(t * .pi * 2) * amp
    wave.addLine(to: CGPoint(x: x, y: y))
    y += 4
}
wave.addLine(to: CGPoint(x: fillX - 26, y: inner.maxY))
wave.addLine(to: CGPoint(x: inner.minX, y: inner.maxY))
wave.closeSubpath()
ctx.saveGState()
ctx.addPath(CGPath(roundedRect: inner, cornerWidth: 34, cornerHeight: 34, transform: nil))
ctx.clip()
ctx.addPath(wave)
ctx.setFillColor(rgb(0xffffff, 0.92))
ctx.fillPath()
ctx.restoreGState()

// Band markers: two ticks under the battery marking the 10-90 band
ctx.setFillColor(rgb(0xffffff, 0.55))
for fx in [0.10, 0.90] {
    let x = inner.minX + inner.width * CGFloat(fx)
    ctx.fill(CGRect(x: x - 5, y: 310, width: 10, height: 34))
}
ctx.setFillColor(rgb(0xffffff, 0.30))
ctx.fill(CGRect(x: inner.minX + inner.width * 0.10, y: 322, width: inner.width * 0.80, height: 10))

NSGraphicsContext.restoreGraphicsState()
let png = bitmap.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: out))
print("wrote \(out)")
