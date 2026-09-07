/**
 * Avenrà Halo performance arithmetic.
 *
 * Range, consumption and power-to-weight are derived from HyperCore BMS
 * readings and the model's published figures. They are kept here, apart from
 * the interface, so each calculation can be checked on its own.
 */
(function (global, factory) {
	'use strict';

	const exports = factory();
	if (typeof module === 'object' && module.exports) module.exports = exports;
	if (global) global.AvenraHaloPerformance = exports;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
	'use strict';

	const KILOWATTS_TO_BHP = 1.34102209;
	const KILOGRAMS_PER_TONNE = 1000;

	const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
	const positive = (value) => {
		const number = finite(value);
		return number !== null && number > 0 ? number : null;
	};
	const round = (value, places) => {
		if (value === null) return null;
		const factor = 10 ** places;
		return Math.round(value * factor) / factor;
	};

	/**
	 * Estimated remaining range, with the evidence it rests on.
	 *
	 * measured — the pack's remaining energy divided by the consumption this
	 *            ride has actually recorded. The only figure based on how the
	 *            motorcycle is being ridden now.
	 * pack     — remaining energy as a share of the pack's full capacity,
	 *            applied to the model's published full-charge range.
	 * charge   — the published full-charge range scaled by state of charge.
	 * vehicle  — the range already held on the Avenrà record.
	 *
	 * Every result is an estimate. Nothing here promises a real-world range.
	 */
	function estimateRange(input) {
		const source = input || {};
		const remainingWh = positive(source.remainingWh);
		const fullCapacityWh = positive(source.fullCapacityWh);
		const fullRangeMiles = positive(source.fullRangeMiles);
		const efficiency = positive(source.efficiencyWhPerMile);
		const soc = finite(source.soc);
		const vehicleRange = finite(source.vehicleRangeMiles);

		if (remainingWh !== null && efficiency !== null) {
			return { miles: round(remainingWh / efficiency, 1), basis: 'measured' };
		}
		if (remainingWh !== null && fullCapacityWh !== null && fullRangeMiles !== null) {
			return { miles: round(fullRangeMiles * Math.min(1, remainingWh / fullCapacityWh), 1), basis: 'pack' };
		}
		if (soc !== null && soc >= 0 && fullRangeMiles !== null) {
			return { miles: round(fullRangeMiles * (Math.min(100, soc) / 100), 1), basis: 'charge' };
		}
		return { miles: vehicleRange === null ? null : round(vehicleRange, 1), basis: 'vehicle' };
	}

	/** Consumption over a ride. Held back until the distance makes it meaningful. */
	function efficiencyWhPerMile(energyWh, distanceMiles, minimumMiles) {
		const energy = positive(energyWh);
		const distance = positive(distanceMiles);
		const floor = finite(minimumMiles) ?? 1;
		if (energy === null || distance === null || distance < floor) return null;
		return round(energy / distance, 1);
	}

	function bhpFromKilowatts(kilowatts) {
		const kw = finite(kilowatts);
		return kw === null ? null : round(kw * KILOWATTS_TO_BHP, 1);
	}

	/** Power to weight from the motorcycle's kerb weight; rider and luggage excluded. */
	function bhpPerTonne(bhp, kerbWeightKg) {
		const power = finite(bhp);
		const weight = positive(kerbWeightKg);
		if (power === null || weight === null) return null;
		return round(power / (weight / KILOGRAMS_PER_TONNE), 1);
	}

	/** The complete power record for a ride, from its peak drive power. */
	function powerRecord(peakPowerKw, kerbWeightKg) {
		const kw = positive(peakPowerKw);
		if (kw === null) return { kilowatts: null, bhp: null, bhpPerTonne: null };
		const bhp = bhpFromKilowatts(kw);
		return { kilowatts: round(kw, 2), bhp, bhpPerTonne: bhpPerTonne(bhp, kerbWeightKg) };
	}

	return {
		KILOWATTS_TO_BHP,
		estimateRange,
		efficiencyWhPerMile,
		bhpFromKilowatts,
		bhpPerTonne,
		powerRecord
	};
}));
