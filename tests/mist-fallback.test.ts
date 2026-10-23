import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';

test('without WebGL the CSS mist stays visible and the canvas never covers it', { timeout: 10000 }, async () => {
  const dom = new JSDOM('<html><body></body></html>', { url: 'https://payread.test', pretendToBeVisual: true });
  for (const [key, value] of Object.entries({ React, window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  // jsdom has no WebGL: getContext('webgl') returns null, like a browser with graphics acceleration off.
  Object.defineProperty(dom.window.HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: () => null });
  const { default: MistBackground } = await import('../components/ui/MistBackground');
  const { render, cleanup, act } = await import('@testing-library/react');
  try {
    const view = render(React.createElement('div', { className: 'hero-shell' }, React.createElement(MistBackground)));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const still = view.getByTestId('mist-still');
    assert.equal(still.className, 'mist-still', 'still is shown and animating');
    for (const layer of ['mist-fog', 'mist-rays', 'mist-bokeh', 'mist-grain']) assert.ok(still.querySelector(`.${layer}`), layer);
    const canvas = view.container.querySelector('canvas')!;
    assert.equal(canvas.getAttribute('data-live'), 'false');
    assert.equal(canvas.className, 'mist-canvas', 'canvas stays transparent (opacity 0) when WebGL is missing');
    assert.equal(canvas.getAttribute('aria-hidden'), 'true');
  } finally {
    cleanup();
    dom.window.close();
  }
});
