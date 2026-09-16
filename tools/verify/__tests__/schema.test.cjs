'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { validate } = require('../lib/schema.cjs');

const schema = {
  type: 'object',
  required: ['required', 'items'],
  properties: {
    required: { type: 'string' },
    items: { type: 'array', items: { type: 'string' } },
    alternate: { type: 'array' }
  },
  anyOf: [
    { properties: { items: { minItems: 1 } } },
    { properties: { alternate: { minItems: 1 } } }
  ]
};

test('anyOf success does not skip sibling required, type, properties, or items', () => {
  assert.deepEqual(validate({ required: 'ok', items: ['valid'] }, schema), []);

  const missingRequired = validate({ items: ['valid'], alternate: ['branch'] }, schema);
  assert.ok(missingRequired.some((error) => /Missing required property: required/.test(error.message)));

  const wrongType = validate({ required: 'ok', items: 'invalid' }, schema);
  assert.ok(wrongType.some((error) => /Expected type array/.test(error.message)));

  const invalidItem = validate({ required: 'ok', items: [42] }, schema);
  assert.ok(invalidItem.some((error) => /Expected type string/.test(error.message)));
});

test('anyOf failure is retained when sibling constraints are valid', () => {
  const errors = validate({ required: 'ok', items: [], alternate: [] }, schema);
  assert.ok(errors.some((error) => /does not match any allowed schema shape/.test(error.message)));
  assert.equal(errors.filter((error) => /Missing required property|Expected type/.test(error.message)).length, 0);
});
