package expo.modules.flintble

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.os.ParcelUuid
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

class FlintBleModule : Module() {
  private var advertiser: BluetoothLeAdvertiser? = null
  private var callback: AdvertiseCallback? = null

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun bluetoothAdvertiser(): BluetoothLeAdvertiser? {
    val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    val adapter: BluetoothAdapter? = manager?.adapter
    return adapter?.bluetoothLeAdvertiser
  }

  override fun definition() = ModuleDefinition {
    Name("FlintBle")

    // Requires BLUETOOTH_ADVERTISE (granted at runtime in proximity.ts and
    // declared in the manifest); otherwise startAdvertising throws SecurityException.
    AsyncFunction("startAdvertising") { serviceUuid: String ->
      val adv = bluetoothAdvertiser()
        ?: throw Exception("BLE advertising not supported on this device")

      callback?.let { adv.stopAdvertising(it) }

      val settings = AdvertiseSettings.Builder()
        .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
        .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
        .setConnectable(false)
        .build()

      val data = AdvertiseData.Builder()
        .setIncludeDeviceName(false)
        .addServiceUuid(ParcelUuid(UUID.fromString(serviceUuid)))
        .build()

      val cb = object : AdvertiseCallback() {}
      callback = cb
      advertiser = adv
      adv.startAdvertising(settings, data, cb)
    }

    AsyncFunction("stopAdvertising") {
      callback?.let { advertiser?.stopAdvertising(it) }
      callback = null
    }

    AsyncFunction("isAdvertisingSupported") {
      bluetoothAdvertiser() != null
    }
  }
}