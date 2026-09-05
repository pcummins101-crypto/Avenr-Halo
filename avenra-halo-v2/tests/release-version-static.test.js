'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('2.7.1 release identifiers stay synchronized', () => {
	const entry = read('avenra-halo-v2.php');
	const readme = read('readme.txt');
	const operations = read('templates/emergency-operations.php');
	assert.match(entry, /\* Version:\s+2\.7\.1/);
	assert.match(entry, /AVENRA_HALO_V2_VERSION',\s*'2\.7\.1'/);
	assert.match(readme, /Stable tag:\s*2\.7\.1/);
	assert.match(readme, /= 2\.7\.1 =/);
	assert.match(operations, /AVENRA_HALO_V2_VERSION' \) \? AVENRA_HALO_V2_VERSION : '2\.7\.1'/);
});
