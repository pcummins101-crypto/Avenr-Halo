'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { customerSpecificationRows } = require('../assets/js/vehicle-specification.js');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('Cain-shaped internal order data cannot enter customer specification rows', () => {
	const vehicle = {
		specification: [
			{ key: 'finish', label: 'Untrusted label', value: 'Personalised factory paint' },
			{ key: 'offer', label: 'Untrusted label', value: 'EVO-LAUNCH' },
			{ key: 'controller', label: 'Untrusted label', value: 'HyperCore 1200' },
			{ key: 'comfort', label: 'Untrusted label', value: 'Heated grips and seat' },
			{ key: 'insurance', label: 'Untrusted label', value: 'Included' },
			{ key: 'jacket', label: 'Untrusted label', value: 'Size 52' },
			{ key: 'eligibility_declaration', value: { defaults: 'No' } },
			{ key: 'purchase_price_minor', value: 999900 },
			{ key: 'brand_ambassador', value: 'AMB-KAS2577' },
			{ key: 'payment_assist', value: '[object Object]' }
		],
		configuration: {
			version: 3,
			source: 'Manual Entry - Test Ride',
			monthly_schedule: [{ start_month: 1, monthly_minor: 24988 }],
			financial_consistency: { requires_manual_review: true },
			brand_ambassador: { code: 'AMB-KAS2577', referral_id: 123 }
		}
	};

	assert.deepEqual(customerSpecificationRows(vehicle), [
		{ key: 'finish', label: 'Finish', value: 'Personalised factory paint' },
		{ key: 'offer', label: 'Offer', value: 'EVO-LAUNCH' },
		{ key: 'controller', label: 'Controller', value: 'HyperCore 1200' },
		{ key: 'comfort', label: 'Comfort', value: 'Heated grips and seat' },
		{ key: 'insurance', label: 'Insurance', value: 'Included' },
		{ key: 'jacket', label: 'Rider jacket', value: 'Size 52' }
	]);
	const rendered = JSON.stringify(customerSpecificationRows(vehicle));
	for (const forbidden of ['eligibility', 'purchase_price', 'payment_assist', 'brand_ambassador', 'monthly_schedule', 'financial_consistency', '[object Object]']) {
		assert.equal(rendered.toLowerCase().includes(forbidden.toLowerCase()), false, `${forbidden} must stay private`);
	}
});

test('customer specification accepts only known scalar rows and canonical labels', () => {
	const rows = customerSpecificationRows({
		specification: [
			{ key: 'controller', label: 'Finance agreement', value: 'HyperCore 1200' },
			{ key: 'controller', value: 'Duplicate' },
			{ key: 'offer', value: { code: 'EVO-LAUNCH' } },
			{ key: 'unknown', value: 'Internal note' },
			{ key: 'display', value: '6.5-inch dashboard upgrade' }
		]
	});
	assert.deepEqual(rows, [
		{ key: 'controller', label: 'Controller', value: 'HyperCore 1200' },
		{ key: 'display', label: 'Display', value: '6.5-inch dashboard upgrade' }
	]);
});

test('REST vehicle serializer exposes only curated specification and profile configuration', () => {
	const php = read('includes/class-halo-v2-rest.php');
	assert.match(php, /private function public_vehicle_specification\(/);
	assert.match(php, /'specification'\s*=>\s*\$public_specification/);
	assert.match(php, /'configuration'\s*=>\s*\$public_configuration/);
	assert.doesNotMatch(php, /'configuration'\s*=>\s*\$config\s*[,)]/);
	assert.match(php, /unset\( \$filtered\['configuration_data'\], \$filtered\['legacy_reconciliation_json'\], \$filtered\['specs'\] \)/);
	assert.match(php, /Stored labels, prices and arbitrary configuration keys are deliberately/);
});

test('Vehicle screen has no generic configuration renderer or object stringification fallback', () => {
	const app = read('assets/js/app.js');
	const start = app.indexOf('\t\trenderVehicleOverview(container) {');
	const end = app.indexOf('\n\t\trenderVehicleBattery(container)', start);
	assert.ok(start > 0 && end > start, 'renderVehicleOverview should be present');
	const render = app.slice(start, end);
	assert.match(render, /customerSpecificationRows\(vehicle\)/);
	assert.doesNotMatch(render, /vehicle\.(?:configuration|specs)/);
	assert.doesNotMatch(render, /Object\.entries/);
	assert.doesNotMatch(render, /\[object Object\]|row\.value\.join/);

	const plugin = read('includes/class-halo-v2-plugin.php');
	assert.match(plugin, /avenra-halo-v2-vehicle-specification/);
	assert.match(plugin, /assets\/js\/vehicle-specification\.js/);
});
