import { describe, it, expect } from 'vitest';
import { computeLayout } from './layout.js';

describe('computeLayout', () => {
  it('computes dimensions for standard 80x24 terminal', () => {
    const layout = computeLayout(80, 24);
    expect(layout.termWidth).toBe(80);
    expect(layout.termHeight).toBe(24);
    expect(layout.leftWidth + layout.rightWidth).toBe(80);
    expect(layout.contentHeight + layout.barHeight).toBe(24);
    expect(layout.barHeight).toBe(3);
  });

  it('enforces minimum left panel width of 30', () => {
    const layout = computeLayout(60, 24);
    expect(layout.leftWidth).toBe(30);
    expect(layout.rightWidth).toBe(30);
  });

  it('uses 30% ratio for wider terminals', () => {
    const layout = computeLayout(120, 40);
    expect(layout.leftWidth).toBe(36);
    expect(layout.rightWidth).toBe(84);
  });

  it('calculates inner dimensions accounting for borders', () => {
    const layout = computeLayout(80, 24);
    expect(layout.leftInner).toBe(layout.leftWidth - 3);
    expect(layout.rightInner).toBe(layout.rightWidth - 3);
    expect(layout.contentInner).toBe(layout.contentHeight - 2);
  });

  it('handles very small terminals', () => {
    const layout = computeLayout(40, 10);
    expect(layout.leftWidth).toBe(30);
    expect(layout.rightWidth).toBe(10);
    expect(layout.contentHeight).toBe(7);
    expect(layout.contentInner).toBe(5);
  });

  it('handles large terminals', () => {
    const layout = computeLayout(200, 60);
    expect(layout.leftWidth).toBe(60);
    expect(layout.rightWidth).toBe(140);
    expect(layout.contentHeight).toBe(57);
  });
});
