import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_MAP_HEIGHT, CAMPAIGN_MAP_WIDTH, campaignMapCoordinates,
} from '../src/menu/campaign-map';

describe('campaign map pointer coordinates', () => {
  it('maps the displayed bitmap exactly when its aspect ratio matches', () => {
    const point = campaignMapCoordinates(512, 264.5, {
      left: 0, top: 0, width: 1_024, height: 529,
    });
    expect(point).toEqual([512, 264]);
  });

  it('removes top and bottom letterboxing before resolving edge countries', () => {
    const rect = { left: 100, top: 50, width: 1_024, height: 700 };
    const inset = (rect.height - CAMPAIGN_MAP_HEIGHT) / 2;
    expect(campaignMapCoordinates(rect.left + 1, rect.top + inset + 1, rect)).toEqual([1, 1]);
    expect(campaignMapCoordinates(rect.left + 1, rect.top + 1, rect)).toBeNull();
  });

  it('removes left and right letterboxing before resolving the Americas', () => {
    const rect = { left: 20, top: 30, width: 1_400, height: 529 };
    const displayedWidth = CAMPAIGN_MAP_WIDTH;
    const inset = (rect.width - displayedWidth) / 2;
    expect(campaignMapCoordinates(rect.left + inset + 10, rect.top + 100, rect)).toEqual([10, 100]);
    expect(campaignMapCoordinates(rect.left + 10, rect.top + 100, rect)).toBeNull();
  });

  it('folds a zoom + pan window into the resolved raster pixel', () => {
    const rect = { left: 0, top: 0, width: CAMPAIGN_MAP_WIDTH, height: CAMPAIGN_MAP_HEIGHT };
    // Whole-map view is unchanged from the 3-arg form.
    expect(campaignMapCoordinates(200, 100, rect, { zoom: 1, originX: 0, originY: 0 }))
      .toEqual([200, 100]);
    // 2x zoom, panned to (100, 50): the display centre lands half a window in.
    expect(campaignMapCoordinates(CAMPAIGN_MAP_WIDTH / 2, CAMPAIGN_MAP_HEIGHT / 2, rect,
      { zoom: 2, originX: 100, originY: 50 }))
      .toEqual([100 + CAMPAIGN_MAP_WIDTH / 4, 50 + Math.floor(CAMPAIGN_MAP_HEIGHT / 4)]);
    // Top-left of the display box is exactly the window origin.
    expect(campaignMapCoordinates(0, 0, rect, { zoom: 3, originX: 300, originY: 120 }))
      .toEqual([300, 120]);
  });
});
