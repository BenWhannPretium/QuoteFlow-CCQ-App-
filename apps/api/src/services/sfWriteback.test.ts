import {
  SF_WRITEBACK_EVENT_VALUES,
  SF_WRITEBACK_SKIP_REASON_VALUES,
  SF_WRITEBACK_STATUS_VALUES,
} from '@ccq/contracts';
import {
  SF_WRITEBACK_EVENTS,
  SF_WRITEBACK_SKIP_REASONS,
  SF_WRITEBACK_STATUSES,
  SF_WRITEBACK_MAP_SEED,
} from '@ccq/domain';
import { SF_WRITE_ALLOW_LIST } from '@ccq/integrations';
import { describe, expect, it } from 'vitest';

import { SfWritebackService } from './sfWriteback';

describe('FB-29 write-back lists and checks', () => {
  it('the contracts mirror the domain lists', () => {
    expect([...SF_WRITEBACK_EVENT_VALUES]).toEqual([...SF_WRITEBACK_EVENTS]);
    expect([...SF_WRITEBACK_STATUS_VALUES]).toEqual([...SF_WRITEBACK_STATUSES]);
    expect([...SF_WRITEBACK_SKIP_REASON_VALUES]).toEqual([...SF_WRITEBACK_SKIP_REASONS]);
  });

  it('the settings console may not switch to live without a write connection, nor name an off-list field', () => {
    const off = new SfWritebackService({
      allowList: SF_WRITE_ALLOW_LIST,
      writerMode: 'off',
      liveBlockedReason: 'no write connection',
      appBaseUrl: 'http://localhost:5173',
    });
    expect(off.settingProblem('sf_writeback_mode', 'live')).toBe('no write connection');
    expect(off.settingProblem('sf_writeback_mode', 'dry_run')).toBeNull();
    expect(off.settingProblem('sf_writeback_map', SF_WRITEBACK_MAP_SEED)).toBeNull();
    const typo = {
      ...SF_WRITEBACK_MAP_SEED,
      entries: SF_WRITEBACK_MAP_SEED.entries.map((e) =>
        e.event === 'quote_link' ? { ...e, sfField: 'CCQ_Quote_Numbr__c' } : e,
      ),
    };
    expect(off.settingProblem('sf_writeback_map', typo)).toMatch(/not on the write allow-list/);
    expect(off.settingProblem('g1_enabled', true)).toBeNull();
  });
});
