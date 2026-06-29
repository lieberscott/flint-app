import ExpoModulesCore
import CoreBluetooth

// Handles CoreBluetooth advertising. Kept as a separate NSObject so it can be a
// CBPeripheralManagerDelegate (the Expo Module base class isn't an NSObject).
class FlintAdvertiser: NSObject, CBPeripheralManagerDelegate {
  private var manager: CBPeripheralManager?
  private var pendingUuid: String?

  func start(_ serviceUuid: String) {
    pendingUuid = serviceUuid
    if manager == nil {
      // Creating the manager triggers peripheralManagerDidUpdateState once ready.
      manager = CBPeripheralManager(delegate: self, queue: nil)
    } else if manager?.state == .poweredOn {
      beginAdvertising(serviceUuid)
    }
  }

  func stop() {
    pendingUuid = nil
    manager?.stopAdvertising()
  }

  func isSupported() -> Bool {
    // Real iOS devices support peripheral advertising; simulators have no radio.
    return true
  }

  private func beginAdvertising(_ serviceUuid: String) {
    guard let manager = manager else { return }
    manager.stopAdvertising()
    // iOS allows advertising service UUIDs in the foreground; the token lives in
    // the UUID's last segment, so no custom payload is needed.
    manager.startAdvertising([
      CBAdvertisementDataServiceUUIDsKey: [CBUUID(string: serviceUuid)]
    ])
  }

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    if peripheral.state == .poweredOn, let uuid = pendingUuid {
      beginAdvertising(uuid)
    }
  }
}

public class FlintBleModule: Module {
  private let advertiser = FlintAdvertiser()

  public func definition() -> ModuleDefinition {
    Name("FlintBle")

    AsyncFunction("startAdvertising") { (serviceUuid: String) in
      DispatchQueue.main.async {
        self.advertiser.start(serviceUuid)
      }
    }

    AsyncFunction("stopAdvertising") {
      DispatchQueue.main.async {
        self.advertiser.stop()
      }
    }

    AsyncFunction("isAdvertisingSupported") { () -> Bool in
      self.advertiser.isSupported()
    }
  }
}