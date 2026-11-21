// KB923L Pro makro oynatıcı. Uygulama bunu bir kez başlatır, stdin'den satır satır JSON komut alır.
//   {"op":"play","id":1,"times":1,"steps":[{"k":0,"d":1},{"w":30},{"k":0,"d":0},{"t":"merhaba"},{"m":"left","d":1}]}
//     times: kaç kez (0 = "stop" gelene dek tekrar)
//     k: macOS sanal tuş kodu (kVK), d: 1 bas / 0 bırak;  w: bekleme (ms);  t: metin yaz;  m: fare tuşu (left/right/middle)
//   {"op":"mouse","b":"left","d":1}   fare tuşu bas / bırak (left/right/middle/back/forward)
//   {"op":"scroll","dy":1,"dx":0}      tekerlek (satır)
//   {"op":"stop"}                 oynatmayı keser, basılı kalan tuşları bırakır
//   {"op":"trust","prompt":1}     Erişilebilirlik iznini sorar / denetler
//   {"op":"listen"}               Giriş İzleme iznini sorar (izin penceresini açar, listeye ekler)
// Çıktı (stdout, satır başına JSON): {"ev":"trust","v":true}  {"ev":"done","id":1}
// Tuş göndermek için Erişilebilirlik izni gerekir; izin uygulamaya (sorumlu süreç) verilir.

import ApplicationServices
import Foundation
import IOKit.hid

let out = FileHandle.standardOutput
func emit(_ o: [String: Any]) {
  if let d = try? JSONSerialization.data(withJSONObject: o) {
    out.write(d)
    out.write("\n".data(using: .utf8)!)
  }
}

func trusted(prompt: Bool) -> Bool {
  let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary
  return AXIsProcessTrustedWithOptions(opts)
}

// Değiştirici tuşlar → bayrak
let modFlag: [Int: CGEventFlags] = [
  55: .maskCommand, 54: .maskCommand, 56: .maskShift, 60: .maskShift,
  58: .maskAlternate, 61: .maskAlternate, 59: .maskControl, 62: .maskControl, 57: .maskAlphaShift,
]

// Fare tuşları ve tekerlek. Tıklama sayısı (çift tık) macOS'un çift tık süresine göre izlenir.
final class Pointer {
  let lock = NSLock()
  let src = CGEventSource(stateID: .hidSystemState)
  var last: (b: String, t: TimeInterval, p: CGPoint, n: Int64)? = nil
  var held = Set<String>()
  let dbl: TimeInterval = {
    let v = UserDefaults(suiteName: ".GlobalPreferences")?.double(forKey: "com.apple.mouse.doubleClickThreshold") ?? 0
    return v > 0 ? v : 0.5
  }()

  static func kind(_ b: String, _ isDown: Bool) -> (CGEventType, CGMouseButton) {
    switch b {
    case "right": return (isDown ? .rightMouseDown : .rightMouseUp, .right)
    case "middle": return (isDown ? .otherMouseDown : .otherMouseUp, .center)
    case "back": return (isDown ? .otherMouseDown : .otherMouseUp, CGMouseButton(rawValue: 3)!)
    case "forward": return (isDown ? .otherMouseDown : .otherMouseUp, CGMouseButton(rawValue: 4)!)
    default: return (isDown ? .leftMouseDown : .leftMouseUp, .left)
    }
  }

  func button(_ b: String, _ isDown: Bool, _ flags: CGEventFlags = []) {
    lock.lock()
    defer { lock.unlock() }
    let pos = CGEvent(source: nil)?.location ?? .zero
    let now = Date().timeIntervalSince1970
    var n: Int64 = 1
    if isDown {
      if let l = last, l.b == b, now - l.t < dbl, abs(l.p.x - pos.x) < 5, abs(l.p.y - pos.y) < 5 { n = l.n + 1 }
      last = (b, now, pos, n)
      held.insert(b)
    } else {
      n = (last?.b == b ? last?.n : nil) ?? 1
      held.remove(b)
    }
    let (t, btn) = Pointer.kind(b, isDown)
    guard let e = CGEvent(mouseEventSource: src, mouseType: t, mouseCursorPosition: pos, mouseButton: btn) else { return }
    e.setIntegerValueField(.mouseEventClickState, value: n)
    e.flags = flags
    e.post(tap: .cghidEventTap)
  }

  // Tuşla tutulan fare tuşu: fiziksel fare hareketi "sürükleme" olarak gitmeli (dragTap)
  func heldButton() -> String? {
    lock.lock()
    defer { lock.unlock() }
    return held.contains("left") ? "left" : held.contains("right") ? "right" : held.first
  }

  func scroll(_ dy: Int32, _ dx: Int32) {
    CGEvent(scrollWheelEvent2Source: src, units: .line, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0)?
      .post(tap: .cghidEventTap)
  }
}

let pointer = Pointer()

final class Player {
  let q = DispatchQueue(label: "play")
  let lock = NSLock()
  var gen = 0
  var down = Set<Int>()
  var mouseDown = Set<String>()
  var flags: CGEventFlags = []
  let src = CGEventSource(stateID: .hidSystemState)

  func current(_ g: Int) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return g == gen
  }

  func key(_ code: Int, _ isDown: Bool) {
    if let f = modFlag[code], code != 57 {
      if isDown { flags.insert(f) } else { flags.remove(f) }
    }
    guard let e = CGEvent(keyboardEventSource: src, virtualKey: CGKeyCode(code), keyDown: isDown) else { return }
    if modFlag[code] != nil && code != 57 { e.type = .flagsChanged }
    e.flags = flags
    e.post(tap: .cghidEventTap)
    if isDown { down.insert(code) } else { down.remove(code) }
  }

  func text(_ s: String) {
    for ch in s {
      let u = Array(String(ch).utf16)
      for isDown in [true, false] {
        guard let e = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: isDown) else { continue }
        e.keyboardSetUnicodeString(stringLength: u.count, unicodeString: u)
        e.flags = []
        e.post(tap: .cghidEventTap)
      }
      usleep(4000)
    }
  }

  func mouse(_ b: String, _ isDown: Bool) {
    pointer.button(b, isDown, flags)
    if isDown { mouseDown.insert(b) } else { mouseDown.remove(b) }
  }

  func releaseAll() {
    for c in down { key(c, false) }
    for b in mouseDown { mouse(b, false) }
    flags = []
  }

  // Beklemeyi küçük parçalara bölerek "stop"a hızlı yanıt ver
  func wait(_ ms: Int, _ g: Int) -> Bool {
    var left = ms
    while left > 0 {
      if !current(g) { return false }
      let s = min(left, 10)
      usleep(useconds_t(s * 1000))
      left -= s
    }
    return current(g)
  }

  func stop() {
    lock.lock()
    gen += 1
    lock.unlock()
    q.async { self.releaseAll() }
  }

  func play(_ id: Int, _ steps: [[String: Any]], _ times: Int) {
    lock.lock()
    gen += 1
    let g = gen
    lock.unlock()
    q.async {
      self.releaseAll()
      var n = 0
      outer: while times == 0 || n < times {
        for s in steps {
          if !self.current(g) { break outer }
          if let k = s["k"] as? Int {
            self.key(k, (s["d"] as? Int ?? 1) != 0)
            usleep(2000)
          } else if let w = s["w"] as? Int {
            if !self.wait(w, g) { break outer }
          } else if let t = s["t"] as? String {
            self.text(t)
          } else if let m = s["m"] as? String {
            self.mouse(m, (s["d"] as? Int ?? 1) != 0)
            usleep(2000)
          }
        }
        n += 1
        // Sonsuz tekrarda adımların hiç beklemesi yoksa işlemciyi boğmamak için küçük ara
        if times == 0 && !self.wait(15, g) { break }
      }
      self.releaseAll()
      if self.current(g) { emit(["ev": "done", "id": id]) }
    }
  }
}

let player = Player()
emit(["ev": "trust", "v": trusted(prompt: false)])

// Fare hareketini, tuşla basılı tutulan fare tuşu varken sürüklemeye çevirir (Erişilebilirlik izni gerekir).
var dragTap: CFMachPort?
func installDragTap() {
  if dragTap != nil || !trusted(prompt: false) { return }
  let mask = CGEventMask(1 << CGEventType.mouseMoved.rawValue)
  dragTap = CGEvent.tapCreate(
    tap: .cghidEventTap, place: .headInsertEventTap, options: .defaultTap, eventsOfInterest: mask,
    callback: { _, type, e, _ in
      if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let t = dragTap { CGEvent.tapEnable(tap: t, enable: true) }
        return Unmanaged.passUnretained(e)
      }
      if type == .mouseMoved, let b = pointer.heldButton() {
        e.type = b == "left" ? .leftMouseDragged : b == "right" ? .rightMouseDragged : .otherMouseDragged
        if b != "left" && b != "right" {
          e.setIntegerValueField(.mouseEventButtonNumber, value: Int64(Pointer.kind(b, true).1.rawValue))
        }
      }
      return Unmanaged.passUnretained(e)
    }, userInfo: nil)
  if let t = dragTap {
    let rl = CFMachPortCreateRunLoopSource(nil, t, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), rl, .commonModes)
    CGEvent.tapEnable(tap: t, enable: true)
  }
}

func handle(_ line: String) {
  guard let d = line.data(using: .utf8),
    let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
    let op = o["op"] as? String
  else { return }
  switch op {
  case "play":
    if !trusted(prompt: false) {
      emit(["ev": "trust", "v": false])
      return
    }
    player.play(o["id"] as? Int ?? 0, o["steps"] as? [[String: Any]] ?? [], o["times"] as? Int ?? 1)
  case "stop":
    player.stop()
  case "mouse":
    DispatchQueue.main.async { installDragTap() }
    if trusted(prompt: false) { pointer.button(o["b"] as? String ?? "left", (o["d"] as? Int ?? 1) != 0) }
  case "scroll":
    if trusted(prompt: false) { pointer.scroll(Int32(o["dy"] as? Int ?? 0), Int32(o["dx"] as? Int ?? 0)) }
  case "listen":
    let ok = IOHIDRequestAccess(kIOHIDRequestTypeListenEvent)
    emit(["ev": "listen", "v": ok])
  case "trust":
    emit(["ev": "trust", "v": trusted(prompt: (o["prompt"] as? Int ?? 0) != 0)])
  default:
    break
  }
}

// stdin ayrı iş parçacığında okunur; ana iş parçacığı olay dinleyicisinin döngüsünü çalıştırır.
Thread.detachNewThread {
  while let line = readLine() { handle(line) }
  exit(0)
}
DispatchQueue.main.async { installDragTap() }
CFRunLoopRun()
