import { describe, expect, it } from 'vitest'

import {
  connectionEdgeCrossingPriority,
  sortByConnectionCrossingPriority,
} from './connectionCrossingOrder'

describe('connection crossing order', () => {
  it('places manual lower and upper layers around the automatic business order', () => {
    expect(connectionEdgeCrossingPriority({ crossingLayer: 'lower' }))
      .toBeLessThan(connectionEdgeCrossingPriority({ coolingLineRole: 'auxiliary' }))
    expect(connectionEdgeCrossingPriority({ coolingLineRole: 'auxiliary' }))
      .toBeLessThan(connectionEdgeCrossingPriority({}))
    expect(connectionEdgeCrossingPriority({}))
      .toBeLessThan(connectionEdgeCrossingPriority({ crossingLayer: 'upper' }))
  })

  it('keeps the stable source order when two child lines have equal priority', () => {
    expect(sortByConnectionCrossingPriority([
      { id: 'upper-first', edge: { crossingLayer: 'upper' as const } },
      { id: 'auto-primary', edge: {} },
      { id: 'lower', edge: { crossingLayer: 'lower' as const } },
      { id: 'upper-second', edge: { crossingLayer: 'upper' as const } },
      { id: 'auto-auxiliary', edge: { coolingLineRole: 'auxiliary' as const } },
    ], (item) => item.edge).map((item) => item.id)).toEqual([
      'lower',
      'auto-auxiliary',
      'auto-primary',
      'upper-first',
      'upper-second',
    ])
  })
})
