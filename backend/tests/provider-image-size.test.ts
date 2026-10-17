import assert from 'node:assert/strict'
import test from 'node:test'
import { imageSize } from '../src/providers.js'

test('image size mapping resolves ratio and resolution tier without breaking legacy ratios', () => {
  const profile = {
    outputResolutions: ['1K', '2K'],
    outputDimensions: {
      '1K': { '1:1': '1254x1254', '16:9': '1672x941' },
      '2K': { '1:1': '2048x2048' },
    },
  }
  assert.equal(imageSize('1:1', '1K', profile), '1254x1254')
  assert.equal(imageSize('16:9', '1K', profile), '1672x941')
  assert.equal(imageSize('1:1', '2K', profile), '2048x2048')
  assert.equal(imageSize('9:16', '1K', profile), '941x1672')
  assert.equal(imageSize('1:1', undefined, { resolutions: ['1K'], outputDimensions: { '1K': { '1:1': '1254x1254' } } }), '1254x1254')
})

test('image size mapping accepts flat ratio dimensions and inverse map shape', () => {
  assert.equal(imageSize('1:1', '1K', { outputDimensions: { '1:1': '1254x1254' } }), '1254x1254')
  assert.equal(imageSize('1:1', '1K', { sizeMap: { '1:1': { '1K': '1254x1254' } } }), '1254x1254')
})
