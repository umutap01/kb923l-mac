// KB923L Pro makro oynatıcı. Uygulama bunu bir kez başlatır, stdin'den satır satır JSON komut alır.
//   {"op":"play","id":1,"times":1,"steps":[{"k":0,"d":1},{"w":30},{"k":0,"d":0},{"t":"merhaba"},{"m":"left","d":1}]}
//     times: kaç kez (0 = "stop" gelene dek tekrar)
//     k: macOS sanal tuş kodu (kVK), d: 1 bas / 0 bırak;  w: bekleme (ms);  t: metin yaz;  m: fare tuşu (left/right/middle)
//   {"op":"stop"}                 oynatmayı keser, basılı kalan tuşları bırakır
//   {"op":"trust","prompt":1}     Erişilebilirlik iznini sorar / denetler
// Çıktı (stdout, satır başına JSON): {"ev":"trust","v":true}  {"ev":"done","id":1}
// Tuş göndermek için Erişilebilirlik izni gerekir; izin uygulamaya (sorumlu süreç) verilir.

import ApplicationServices
import Foundation

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
    let pos = CGEvent(source: nil)?.location ?? .zero
    let (t, btn): (CGEventType, CGMouseButton) =
      b == "right" ? (isDown ? .rightMouseDown : .rightMouseUp, .right)
      : b == "middle" ? (isDown ? .otherMouseDown : .otherMouseUp, .center)
      : (isDown ? .leftMouseDown : .leftMouseUp, .left)
    guard let e = CGEvent(mouseEventSource: src, mouseType: t, mouseCursorPosition: pos, mouseButton: btn) else { return }
    e.flags = flags
    e.post(tap: .cghidEventTap)
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

while let line = readLine() {
  guard let d = line.data(using: .utf8),
    let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
    let op = o["op"] as? String
  else { continue }
  switch op {
  case "play":
    if !trusted(prompt: false) {
      emit(["ev": "trust", "v": false])
      continue
    }
    player.play(o["id"] as? Int ?? 0, o["steps"] as? [[String: Any]] ?? [], o["times"] as? Int ?? 1)
  case "stop":
    player.stop()
  case "trust":
    emit(["ev": "trust", "v": trusted(prompt: (o["prompt"] as? Int ?? 0) != 0)])
  default:
    break
  }
}
