// Yazılım ses denetimi (21 Kas 2026).
// Sorun: Mac'in sesi DisplayPort / HDMI ile monitöre giderken macOS o çıkışın ses seviyesini ayarlayamıyor
// (aygıtta ses denetimi yok; `output volume` = missing value). Ses tuşları ve klavyenin çevirme düğmesi etkisiz.
// Windows bu çıkışta sesi yazılımla düşürüyor; burada da aynısı yapılır:
//   - Core Audio process tap (macOS 14.2+) tüm sistem sesini yakalar ve özgün çıkışı susturur (mutedWhenTapped:
//     yardımcı kapanırsa ses kendiliğinden eski hâline döner),
//   - özel bir toplu aygıt (aggregate) tap'i girdi, monitörü çıktı olarak alır; IOProc sesi kazançla çarparak geçirir,
//   - ses tuşları (NX_KEYTYPE_SOUND_UP / DOWN / MUTE) olay dinleyicisinde yakalanıp kazancı değiştirir.
// Yalnız varsayılan çıkışın kendi ses denetimi yoksa çalışır; varsayılan çıkış değişince yeniden kurulur.
// İzin: "Sistem Sesi Kaydı" (NSAudioCaptureUsageDescription), uygulamaya verilir.

import AudioToolbox
import CoreAudio
import Foundation

final class SoftVolume {
  var enabled = false
  var volume: Float = 0.5  // 0…1 (kullanıcının gördüğü seviye)
  var muted = false
  private(set) var active = false  // şu an tap ve toplu aygıt kurulu mu
  private var tapID = AudioObjectID(kAudioObjectUnknown)
  private var aggID = AudioObjectID(kAudioObjectUnknown)
  private var procID: AudioDeviceIOProcID?
  private var outDev = AudioObjectID(kAudioObjectUnknown)
  private var gain: Float = 0.25
  private var curGain: Float = 0.25
  private let q = DispatchQueue(label: "softvol")
  private var listening = false

  // Algısal eğri: seviyenin karesi (macOS'un kaydırıcısına yakın)
  private func targetGain() -> Float { muted ? 0 : volume * volume }

  // ---- Core Audio yardımcıları ----
  private func prop<T>(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal, _ elem: AudioObjectPropertyElement = kAudioObjectPropertyElementMain, def: T) -> T {
    var addr = AudioObjectPropertyAddress(mSelector: sel, mScope: scope, mElement: elem)
    var v = def
    var size = UInt32(MemoryLayout<T>.size)
    return AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &v) == noErr ? v : def
  }

  private func defaultOutput() -> AudioObjectID {
    prop(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultOutputDevice, def: AudioObjectID(kAudioObjectUnknown))
  }

  private func uid(_ dev: AudioObjectID) -> String? {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyDeviceUID, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var s: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(dev, &addr, 0, nil, &size, &s) == noErr, let v = s else { return nil }
    return v.takeRetainedValue() as String
  }

  private func name(_ dev: AudioObjectID) -> String {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioObjectPropertyName, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var s: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(dev, &addr, 0, nil, &size, &s) == noErr, let v = s else { return "?" }
    return v.takeRetainedValue() as String
  }

  // Aygıtın kendi ses denetimi var mı (ana öğe ya da 1. / 2. kanal, ayarlanabilir)
  func hasHardwareVolume(_ dev: AudioObjectID) -> Bool {
    for el: UInt32 in [kAudioObjectPropertyElementMain, 1, 2] {
      var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyVolumeScalar, mScope: kAudioDevicePropertyScopeOutput, mElement: el)
      guard AudioObjectHasProperty(dev, &addr) else { continue }
      var settable: DarwinBoolean = false
      if AudioObjectIsPropertySettable(dev, &addr, &settable) == noErr, settable.boolValue { return true }
    }
    return false
  }

  // Şu an yazılım denetimi devrede mi olmalı (tuşları yakalamak için)
  var handlesKeys: Bool { enabled && active }

  // ---- kurma / sökme ----
  func refresh() {
    q.async { self.refreshSync() }
  }

  private func refreshSync() {
    if !listening { listen() }
    let dev = defaultOutput()
    let need = enabled && dev != kAudioObjectUnknown && !hasHardwareVolume(dev)
    if active && (!need || dev != outDev) { teardown() }
    if need && !active { setup(dev) }
    emit(["ev": "softvol", "active": active, "device": dev == kAudioObjectUnknown ? "" : name(dev),
          "v": Int((volume * 100).rounded()), "muted": muted])
  }

  private func listen() {
    listening = true
    var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &addr, q) { [weak self] _, _ in
      // çıkış değişti (monitör ↔ hoparlör / kulaklık)
      self?.q.asyncAfter(deadline: .now() + 0.3) { self?.refreshSync() }
    }
  }

  private func ownProcessObject() -> AudioObjectID {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var pid = getpid()
    var obj = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, UInt32(MemoryLayout<pid_t>.size), &pid, &size, &obj)
    return obj
  }

  private func fail(_ what: String, _ err: OSStatus) {
    emit(["ev": "softvol", "active": false, "error": "\(what) (\(err))"])
    teardown()
  }

  private func setup(_ dev: AudioObjectID) {
    guard let devUID = uid(dev) else { return }
    // kendi sesimizi (monitöre geri gönderdiğimiz) tap'e katma, yoksa geri besleme olur
    let me = ownProcessObject()
    let desc = CATapDescription(stereoGlobalTapButExcludeProcesses: me == kAudioObjectUnknown ? [] : [me])
    desc.name = "KB923L ses"
    desc.isPrivate = true
    desc.muteBehavior = .mutedWhenTapped
    var tap = AudioObjectID(kAudioObjectUnknown)
    var err = AudioHardwareCreateProcessTap(desc, &tap)
    guard err == noErr else { return fail("ses yakalama (izin?)", err) }
    tapID = tap

    let aggUID = "com.kb923l.softvol." + UUID().uuidString
    let dict: [String: Any] = [
      kAudioAggregateDeviceNameKey: "KB923L ses",
      kAudioAggregateDeviceUIDKey: aggUID,
      kAudioAggregateDeviceMainSubDeviceKey: devUID,
      kAudioAggregateDeviceIsPrivateKey: true,
      kAudioAggregateDeviceIsStackedKey: false,
      kAudioAggregateDeviceTapAutoStartKey: true,
      kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: devUID]],
      kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true, kAudioSubTapUIDKey: desc.uuid.uuidString]],
    ]
    var agg = AudioObjectID(kAudioObjectUnknown)
    err = AudioHardwareCreateAggregateDevice(dict as CFDictionary, &agg)
    guard err == noErr else { return fail("toplu aygıt", err) }
    aggID = agg

    curGain = targetGain()
    var pid: AudioDeviceIOProcID?
    err = AudioDeviceCreateIOProcIDWithBlock(&pid, agg, nil) { [unowned self] _, inData, _, outData, _ in
      self.process(inData, outData)
    }
    guard err == noErr, let p = pid else { return fail("ses işleyici", err) }
    procID = p
    err = AudioDeviceStart(agg, p)
    guard err == noErr else { return fail("başlatma", err) }
    outDev = dev
    active = true
  }

  private func teardown() {
    if let p = procID, aggID != kAudioObjectUnknown {
      AudioDeviceStop(aggID, p)
      AudioDeviceDestroyIOProcID(aggID, p)
    }
    procID = nil
    if aggID != kAudioObjectUnknown { AudioHardwareDestroyAggregateDevice(aggID) }
    aggID = AudioObjectID(kAudioObjectUnknown)
    if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID) }
    tapID = AudioObjectID(kAudioObjectUnknown)
    outDev = AudioObjectID(kAudioObjectUnknown)
    active = false
  }

  func shutdown() { q.sync { self.teardown() } }

  // Ses iş parçacığı: girdi (tap) → çıktı (monitör), kazanç yumuşak geçişle
  private func process(_ inList: UnsafePointer<AudioBufferList>, _ outList: UnsafeMutablePointer<AudioBufferList>) {
    let ins = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inList))
    let outs = UnsafeMutableAudioBufferListPointer(outList)
    let target = targetGain()
    let start = curGain
    for (i, ob) in outs.enumerated() {
      guard let od = ob.mData?.assumingMemoryBound(to: Float.self) else { continue }
      let on = Int(ob.mDataByteSize) / MemoryLayout<Float>.size
      guard i < ins.count, let id = ins[i].mData?.assumingMemoryBound(to: Float.self) else {
        memset(ob.mData, 0, Int(ob.mDataByteSize))
        continue
      }
      let n = min(on, Int(ins[i].mDataByteSize) / MemoryLayout<Float>.size)
      let step = n > 0 ? (target - start) / Float(n) : 0
      var g = start
      for k in 0..<n {
        od[k] = id[k] * g
        g += step
      }
      if n < on { memset(od + n, 0, (on - n) * MemoryLayout<Float>.size) }
    }
    curGain = target
  }

  // ---- ses tuşları ----
  // 16 adım (macOS gibi); ⇧⌥ ile 64 adım
  func key(_ code: Int, fine: Bool) {
    let step: Float = fine ? 1.0 / 64 : 1.0 / 16
    switch code {
    case 0: volume = min(1, volume + step); muted = false
    case 1: volume = max(0, volume - step); if volume == 0 { muted = false }
    case 7: muted.toggle()
    default: return
    }
    emit(["ev": "softvol", "active": active, "v": Int((volume * 100).rounded()), "muted": muted, "key": true])
  }
}

let softvol = SoftVolume()
