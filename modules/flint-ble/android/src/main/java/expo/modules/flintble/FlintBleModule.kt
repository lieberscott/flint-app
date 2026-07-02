package expo.modules.flintble

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

class FlintBleModule : Module() {
  // These UUIDs MUST match FLINT_SERVICE_UUID / FLINT_TOKEN_CHAR_UUID in lib/proximity.ts.
  private val serviceUuid: UUID = UUID.fromString("8a7f1e00-1f1a-4c2b-9d4e-000000000001")
  private val charUuid: UUID = UUID.fromString("8a7f1e00-1f1a-4c2b-9d4e-000000000002")

  private var advertiser: BluetoothLeAdvertiser? = null
  private var advertiseCallback: AdvertiseCallback? = null
  private var gattServer: BluetoothGattServer? = null
  private var token: String = ""

  private val handler = Handler(Looper.getMainLooper())
  private var autoStop: Runnable? = null

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun bluetoothManager(): BluetoothManager =
    context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager

  override fun definition() = ModuleDefinition {
    Name("FlintBle")

    AsyncFunction("startAdvertising") { tokenArg: String, ttlMs: Double ->
      token = tokenArg
      startGattServer()
      startAdvertise()
      scheduleAutoStop(ttlMs.toLong())
    }

    AsyncFunction("stopAdvertising") {
      stopEverything()
    }

    AsyncFunction("isAdvertisingSupported") {
      bluetoothManager().adapter?.bluetoothLeAdvertiser != null
    }
  }

  private fun scheduleAutoStop(ttlMs: Long) {
    autoStop?.let { handler.removeCallbacks(it) }
    val r = Runnable { stopEverything() }
    autoStop = r
    handler.postDelayed(r, ttlMs)
  }

  private fun stopEverything() {
    autoStop?.let { handler.removeCallbacks(it) }
    autoStop = null
    advertiseCallback?.let { advertiser?.stopAdvertising(it) }
    advertiseCallback = null
    gattServer?.close()
    gattServer = null
  }

  private fun startGattServer() {
    gattServer?.close()
    val server = bluetoothManager().openGattServer(
      context,
      object : BluetoothGattServerCallback() {
        override fun onCharacteristicReadRequest(
          device: BluetoothDevice,
          requestId: Int,
          offset: Int,
          characteristic: BluetoothGattCharacteristic,
        ) {
          if (characteristic.uuid == charUuid) {
            gattServer?.sendResponse(
              device,
              requestId,
              BluetoothGatt.GATT_SUCCESS,
              offset,
              token.toByteArray(Charsets.UTF_8),
            )
          } else {
            gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null)
          }
        }
      },
    )

    val characteristic = BluetoothGattCharacteristic(
      charUuid,
      BluetoothGattCharacteristic.PROPERTY_READ,
      BluetoothGattCharacteristic.PERMISSION_READ,
    )
    val service = BluetoothGattService(serviceUuid, BluetoothGattService.SERVICE_TYPE_PRIMARY)
    service.addCharacteristic(characteristic)
    server.addService(service)
    gattServer = server
  }

  private fun startAdvertise() {
    val adv = bluetoothManager().adapter?.bluetoothLeAdvertiser ?: return
    advertiseCallback?.let { adv.stopAdvertising(it) }

    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
      .setConnectable(true) // connectable so scanners can read the GATT token
      .build()

    val data = AdvertiseData.Builder()
      .setIncludeDeviceName(false)
      .addServiceUuid(ParcelUuid(serviceUuid))
      .build()

    val cb = object : AdvertiseCallback() {}
    advertiseCallback = cb
    advertiser = adv
    adv.startAdvertising(settings, data, cb)
  }
}