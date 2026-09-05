# HyperCore Bluetooth integration

Halo 2.7.0 presents the motorcycle powertrain as one **HyperCore** view. The
HyperCore ECU and HyperCore BMS remain two independent Bluetooth peripherals,
but their live state and telemetry are shown together. Route planning, Ride
mode and manual starting-charge entry remain available without either link.

## Rider flow

1. Keep the motorcycle safely parked and switch on Bluetooth and the motorcycle.
2. Open **Vehicle → HyperCore**.
3. Choose **Connect HyperCore ECU** and select the ECU in the phone-owned chooser.
4. Choose **Connect HyperCore BMS** and select the BMS in the second chooser.
5. Halo reports **HyperCore live** only after both units deliver valid telemetry.
   If one unit is live, Halo reports **HyperCore partial** and identifies the
   available component without hiding its data.

Web Bluetooth requires each physical-device chooser to begin from a fresh rider
gesture, so Halo deliberately keeps two connection buttons on the same screen.
It never pairs automatically. Raw Bluetooth device names are not repeated in
Halo because firmware names may expose supplier terminology.

Ride start is disabled only while a chooser or connection is actively opening.
Live, partial, delayed and unavailable telemetry never end an active ride. Halo
disconnects both sessions when the page is hidden or unloaded, the rider signs
out, or the account or linked vehicle changes.

## Data ownership

The combined view does not blend competing measurements:

- **HyperCore BMS** is authoritative for state of charge, pack voltage, signed
  pack current and power, battery temperature, cell minimum/maximum and cell
  delta.
- **HyperCore ECU** supplies RPM, signed line current, phase A/C current, motor
  and ECU temperature, throttle, modulation, gear, brake state and faults.
- ECU-derived speed remains diagnostic-only. It never enters Halo's calibrated
  GPS speed, journey distance, 0–60, Ride Memories, Emergency Assist or live
  tracking pipeline.
- A stale component remains visibly labelled as its last reading and cannot
  silently replace a current source.

No detailed HyperCore telemetry is persisted or uploaded. Live BMS charge may
populate Halo's existing starting-charge field and can therefore be included in
an ordinary ride or Emergency Assist record exactly like a manually entered
charge value.

## HyperCore ECU protocol

- Primary service: `0000ffe0-0000-1000-8000-00805f9b34fb`
- Telemetry characteristic: `0000ffec-0000-1000-8000-00805f9b34fb`
- Read packet: `[register, register, 0x80, crcLo, crcHi]`
- CRC: reflected polynomial `0xA001`, initial value `0x7F3C`, little-endian
- Read-only poll registers: `E2 E8 EE F4 FA D6 24 2A 30 18 69 7C D0`

Modern notifications are 16 bytes, begin with `AA`, identify a page in byte 1,
and carry six little-endian words plus a two-byte CRC. The decoder validates
packet integrity, resolves repeated page selectors to their logical register,
preserves notification fragments, and exposes telemetry only after a verified
packet. Confirmed decoding includes RPM/pole-pair normalization, voltage,
signed line current and power, phase currents, temperatures, throttle,
modulation, gear, brake state and fault masks.

The module contains no configuration, firmware, unlock, remote-drive or general
write path. Its only outgoing values are the fixed read requests above.

## HyperCore BMS protocol

- Primary transport: service `FFE0` with shared notify/write characteristic `FFE1`
- Compatible transport: service `FF00`, notify characteristic `FF01`, write
  characteristic `FF02`
- Modern wake request: `7e a1 01 00 00 c8 99 b3 aa 55`
- Legacy read probe: `db db 00 00 00 00`
- Wake cadence: once after notifications start, then every two seconds
- Modern status header: `7e a1 11`; legacy status header: `aa 55 aa`
- CRC: CRC-16/MODBUS over bytes after `7E` through the final data byte,
  little-endian, followed by `AA 55`

For status responses, total frame length is `frame[5] + 10`. Halo validates that
length, the CRC and footer, supports up to 32 cells and 8 temperature channels,
and requires the complete core block before parsing. Cell voltages begin at
byte 34 as little-endian millivolts; temperatures follow as signed 16-bit °C.
With `P = 34 + 2×cellCount + 2×temperatureCount`, the displayed core fields are:

- pack voltage: `u16LE(P+4) × 0.01 V`;
- signed current: `i16LE(P+6) × 0.1 A` at every current level;
- state of charge: `u16LE(P+8)` percent, rejected when outside 0–100;
- power: reported pack voltage × signed current;
- cell minimum, maximum and delta from the validated cell list.

The decoder keeps fragmented and concatenated frames, respects `DataView` byte
offsets, rejects invalid bounds and maintains a bounded receive buffer. The
BMS module also normalizes the fixed 140-byte, big-endian legacy status format
to the same telemetry fields. It probes both read-only formats until a valid
frame identifies the unit, then locks that protocol for the session. It sends
only the two established read requests and has no configuration, shutdown or
arbitrary-write capability.

## Runtime limitation

Standard Web Bluetooth is available only in a secure context when the runtime
exposes `navigator.bluetooth.requestDevice`. The bundled WebToNative JavaScript
SDK does not expose raw BLE GATT reads, writes or notifications. System-level
pairing alone is therefore not live HyperCore telemetry.

A signed wrapper without standard Web Bluetooth needs a purpose-built native
raw-GATT adapter, Android/iOS Bluetooth permissions and a rebuilt binary. Both
modules accept an injected Bluetooth-compatible adapter for that future bridge.
Until it exists, Halo shows an honest unavailable state and retains the rest of
the application.

## Physical-device acceptance

Before release to riders:

- confirm the production origin is HTTPS and permits `bluetooth=(self)`;
- verify `navigator.bluetooth.requestDevice` or the native adapter in the
  signed runtime;
- pair the physical HyperCore ECU and BMS separately and test wrong-device
  selection, chooser cancellation, permission denial and powered-off units;
- compare every displayed metric against trusted bench instrumentation at rest,
  under controlled load and during charging/regeneration;
- verify positive/negative current direction and high-current values, including
  values above 100 A;
- test fragmented/concatenated packets, invalid CRCs, brief radio loss, stale
  transitions and GATT disconnection for each component independently;
- confirm ECU values never alter Halo's GPS ride or safety telemetry;
- confirm backgrounding, sign-out and account/vehicle changes stop both sessions
  and all poll timers;
- confirm Ride mode remains safe when either or both links are lost.
