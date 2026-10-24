import { describe, it, expect, vi } from 'vitest';
import { getMockTrack } from '../mockDataService';

describe('mockDataService', () => {
  it('returns a track with expected structure', () => {
    const track = getMockTrack();
    expect(track).toHaveProperty('id');
    expect(track).toHaveProperty('title');
    expect(track).toHaveProperty('artist');
    expect(typeof track.title).toBe('string');
  });
});
