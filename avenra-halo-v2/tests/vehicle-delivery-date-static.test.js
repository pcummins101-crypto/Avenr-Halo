'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rest = fs.readFileSync(path.join(__dirname, '..', 'includes', 'class-halo-v2-rest.php'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'app.js'), 'utf8');

function between(source, start, end) {
	const startIndex = source.indexOf(start);
	assert.notEqual(startIndex, -1, `Expected start marker: ${start}`);
	const endIndex = source.indexOf(end, startIndex + start.length);
	assert.notEqual(endIndex, -1, `Expected end marker: ${end}`);
	return source.slice(startIndex, endIndex);
}

test('an order-specific expected delivery date wins before the global fallback', () => {
	const helper = between(rest, 'private function vehicle_estimated_delivery_date(', '/** @return object[] */');
	const orderField = helper.indexOf('$row->expected_delivery_date');
	const legacyAlias = helper.indexOf('$row->estimated_delivery_date');
	const legacyJson = helper.indexOf("$configuration['expected_delivery_date']");
	const globalOption = helper.indexOf("get_option( 'avenra_estimated_delivery_date'");
	assert.ok(orderField >= 0, 'expected_delivery_date must be read from the order');
	assert.ok(legacyAlias > orderField, 'the legacy per-order alias should remain supported');
	assert.ok(legacyJson > legacyAlias, 'legacy order JSON should be checked after dedicated columns');
	assert.ok(globalOption > legacyJson, 'the site-wide value must be fallback-only');
	assert.match(helper, /if \( null !== \$order_date \) \{\s*return \$order_date;/);
	assert.match(helper, /return \$this->valid_date\( \$fallback \);/);
});

test('the resolved per-order date feeds both Vehicle and Build displays', () => {
	const serialise = between(rest, 'private function serialise_vehicle(', 'private function owned_order(');
	assert.match(serialise, /\$estimated = \$this->vehicle_estimated_delivery_date\( \$row, is_array\( \$config \) \? \$config : array\(\) \);/);
	assert.match(serialise, /'estimated_delivery_date'\s*=>\s*\$estimated/);
	assert.match(serialise, /'estimated_delivery'\s*=>\s*\$estimated/);

	assert.match(app, /build\.estimated_delivery \|\| vehicle\.estimated_delivery \|\| vehicle\.estimated_delivery_date/);
	assert.match(app, /ESTIMATED DELIVERY/);
});
