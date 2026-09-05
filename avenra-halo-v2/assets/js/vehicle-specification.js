(function (root, factory) {
	'use strict';
	const api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	if (root) root.AvenraHaloVehicleSpecification = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
	'use strict';

	const LABELS = Object.freeze({
		finish: 'Finish',
		offer: 'Offer',
		controller: 'Controller',
		comfort: 'Comfort',
		insurance: 'Insurance',
		display: 'Display',
		abs: 'Braking',
		hel_calipers: 'Braking',
		hel_master: 'Braking',
		rims: 'Wheels',
		track: 'Ride technology',
		sentinel: 'Security',
		sound: 'Ride technology',
		total_care: 'Care package',
		jacket: 'Rider jacket'
	});

	function customerSpecificationRows(vehicle) {
		const source = Array.isArray(vehicle?.specification) ? vehicle.specification : [];
		const rows = [];
		const seen = new Set();
		for (const row of source.slice(0, 32)) {
			if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
			const key = String(row.key || '').trim().toLowerCase();
			const rawValue = row.value;
			if (!LABELS[key] || seen.has(key) || !['string', 'number'].includes(typeof rawValue)) continue;
			const value = String(rawValue).trim().slice(0, 160);
			if (!value || value === '[object Object]') continue;
			seen.add(key);
			rows.push({ key, label: LABELS[key], value });
			if (rows.length === 16) break;
		}
		return rows;
	}

	return { LABELS, customerSpecificationRows };
}));
