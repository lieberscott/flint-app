import ExpoModulesCore
import CoreBluetooth

// These UUIDs MUST match FLINT_SERVICE_UUID / FLINT_TOKEN_CHAR_UUID in lib/proximity.ts.
private let kServiceUUID = CBUUID(string: "8a7f1e00-1f1a-4c2b-9d4e-000000000001")
private let kTokenCharUUID = CBUUID(string: "8a7f1e00-1f1a-4c2b-9d4e-000000000002")

// Runs a GATT peripheral: advertises the fixed service UUID and serves the
// current token from a readable characteristic. Auto-stops after a TTL via a
// native timer, so the cap holds even when the app is backgrounded.
class FlintPeripheral: NSObject, CBPeripheralManagerDelegate {
  private var manager: CBPeripheralManager?
  private var token: String?
  private var autoStop: DispatchWorkItem?

  func start(_ token: String, ttlSeconds: Double) {
    self.token = token
    scheduleAutoStop(ttlSeconds)
    if manager == nil {
      manager = CBPeripheralManager(delegate: self, queue: nil)
    } else if manager?.state == .poweredOn {
      setupAndAdvertise()
    }
  }

  func stop() {
    autoStop?.cancel()
    autoStop = nil
    token = nil
    manager?.stopAdvertising()
    manager?.removeAllServices()
  }

  func isSupported() -> Bool {
    return true
  }

  private func scheduleAutoStop(_ ttlSeconds: Double) {
    autoStop?.cancel()
    let work = DispatchWorkItem { [weak self] in
      self?.stop()
    }
    autoStop = work
    DispatchQueue.main.asyncAfter(deadline: .now() + ttlSeconds, execute: work)
  }

  private func setupAndAdvertise() {
    guard let manager = manager, token != nil else { return }
    manager.stopAdvertising()
    manager.removeAllServices()

    let characteristic = CBMutableCharacteristic(
      type: kTokenCharUUID,
      properties: [.read],
      value: nil, // dynamic — answered in didReceiveRead
      permissions: [.readable]
    )
    let service = CBMutableService(type: kServiceUUID, primary: true)
    service.characteristics = [characteristic]
    manager.add(service) // advertising starts in didAdd
  }

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    if peripheral.state == .poweredOn, token != nil {
      setupAndAdvertise()
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    guard error == nil else { return }
    peripheral.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [kServiceUUID]])
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
    if request.characteristic.uuid == kTokenCharUUID, let token = token {
      request.value = token.data(using: .utf8)
      peripheral.respond(to: request, withResult: .success)
    } else {
      peripheral.respond(to: request, withResult: .attributeNotFound)
    }
  }
}

public class FlintBleModule: Module {
  private let peripheral = FlintPeripheral()

  public func definition() -> ModuleDefinition {
    Name("FlintBle")

    AsyncFunction("startAdvertising") { (token: String, ttlMs: Double) in
      DispatchQueue.main.async {
        self.peripheral.start(token, ttlSeconds: ttlMs / 1000.0)
      }
    }

    AsyncFunction("stopAdvertising") {
      DispatchQueue.main.async {
        self.peripheral.stop()
      }
    }

    AsyncFunction("isAdvertisingSupported") { () -> Bool in
      self.peripheral.isSupported()
    }
  }
}