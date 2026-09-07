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
   The BMS chooser lists every nearby Bluetooth device, because a BMS module
   does not always advertise its serial service and a service filter could hide
   the unit while still listing the ECU. Choose the battery module, not the ECU.
5. Halo reports **HyperCore live** only after both units deliver valid telemetry.
   If one unit is live, Halo reports **HyperCore partial** and identifies the
   available component without hiding its data.

Web Bluetooth requires each physical-device chooser to begin from a fresh rider
gesture, so Halo deliberately keeps two connection buttons on the same screen.
It never pairs automatically. Raw Bluetooth device names are not repeated in
Halo because firmware names may expose supplier terminology.

If the wrong module is chosen, Halo says so: the ECU picked in the BMS chooser
is reported as **That device is the HyperCore ECU, not the BMS**, and the BMS
picked in the ECU chooser is reported the other way round. A link that never
opened, and a link that opened without a data stream, each carry their own
instruction instead of one generic message.

## Troubleshooting a BMS that will not pair

- **Another app holds the link.** A BMS module accepts one connection at a
  time. A vendor or diagnostic app left running with auto-reconnect, on this
  phone or another, keeps the module busy and Halo's connection times out or is
  refused. Close that app fully, then pair again.
- **First operation fails right after connecting.** Android Bluetooth
  frequently fails the first GATT operation after a fresh connection. Halo now
  retries the connection, the notification start and the first read request
  once each, half a second apart, before reporting a failure.
- **The card says "No data".** The link opened and the read requests were
  written, but the module never answered. Switch the motorcycle off and on,
  make sure no other app is connected, then disconnect and pair again.
- **Details line.** A failed or silent link shows a short technical line under
  the card copy: the error, the channel used (`ffe0`, `ff00`, `fff0` or
  `auto`) and a short code. Riders can quote this line when reporting a
  problem.

### During a ride

Locking the phone or leaving Halo drops both radio links for privacy. When the
screen comes back mid-ride Halo reopens them to the modules already chosen,
without a chooser, and the ride map and dash both carry a **Reconnect BMS**
button for the rider to do the same by hand. Web Bluetooth allows a GATT
connection to a previously chosen device without a new chooser; the chooser
only opens when nothing is remembered, which needs the rider's tap.

The ride map's **Dash** control switches to a simplified black display: the
next instruction and its distance large at the top, speed largest, then charge,
range, max power and trip. The choice is remembered on the phone. Hazard, Share
and Hold to end stay in place on both views, and the hold control refuses text
selection and the context menu so a two-second press can only end the ride.

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

## Figures Halo derives from the pack

Halo names the modules as a rider knows them — **Avenrà BMS** and **Avenrà
HyperCore ECU**. The phone's own Bluetooth chooser is drawn by the operating
system and still shows the firmware's advertised name (it begins with `ANT`);
no website can rename that dialog.

### Estimated range

Range is shown with the evidence it rests on, best first:

| Basis | How it is worked out | When it is used |
| --- | --- | --- |
| Measured | Pack's remaining energy ÷ Wh per mile recorded this ride | From two miles into a ride with the BMS connected |
| Pack | Remaining energy as a share of full capacity × the model's published range | BMS reports capacity, no consumption yet |
| Charge | Published full-charge range × state of charge | BMS or vehicle record gives charge only |
| Vehicle | The range already held on the Avenrà record | Nothing better is available |

The published full-charge figures are **206 miles for EVO** and **103 miles for
ONE**, set through `avenra_halo_v2_full_range_miles_evo` and
`avenra_halo_v2_full_range_miles_one`. They are nominal manufacturer figures,
not a promise of real-world range, and every result stays labelled an estimate.

### Energy and consumption

During a ride Halo accounts for energy two ways and prefers the first:

1. The movement of the pack's own remaining energy, which does not depend on
   any current-sign convention.
2. An integration of pack power, for firmware that does not report capacity.
   The discharge direction is confirmed by watching which sign of current
   accompanies a falling pack, rather than being assumed; steps are capped at
   30 seconds so a dropped link cannot invent energy.

This fills the ride record's previously empty energy field and gives Wh per
mile, energy recovered and state of charge used.

### Recorded power

Peak **drive** power is recorded while the motorcycle is moving, together with
the current and pack voltage at that moment, and shown as kW, bhp and bhp per
tonne. Power to weight uses the kerb weight from
`avenra_halo_v2_kerb_weight_kg` (default 170 kg) and **excludes rider and
luggage**. A ride made without the BMS connected records no power or energy
figures at all rather than a zero that would read as a measurement.

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
- Secondary transport: service `FFF0`, notify characteristic `FFF1`, write
  characteristic `FFF2`
- Auto-discovery: when none of the above exists, Halo inspects every permitted
  service (`FFE0`, `FF00`, `FFF0`, `FFE5`, `FEE7` and the Nordic UART service),
  skips the generic GATT services, and uses the first characteristic that
  notifies together with the first that accepts writes, preferring one
  characteristic that does both. A write-without-response-only channel is
  written without response. Nothing is written during discovery, and an `FFE0`
  service that only carries the ECU's `FFEC` channel is reported as the wrong
  module.
- Modern wake request: `7e a1 01 00 00 be 18 55 aa 55` (the vendor app's
  request; a requested length above `0xC0` makes the BMS answer in a two-part
  frame layout that Halo does not decode)
- Legacy read probe: `db db 00 00 00 00`
- Protocol choice from the advertised name, as in the vendor app: an
  `ANT-BLE` name that is exactly ten characters or has a dash at index ten is
  an older unit and receives only the legacy probe; any other `ANT` name
  (including `ANT@BLE...`) is a modern unit and receives only the modern
  request; other names receive both until one is answered
- Wake cadence: one second after notifications start, then every two seconds
- Modern status header: `7e a1 11` or `7e b1 91`; legacy status header: `aa 55 aa`
- Silent link: after five unanswered requests Halo drops and reopens the GATT
  link once on the same device, without a second chooser, as the vendor app
  does; a link that stays silent is then shown as **No data**
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
