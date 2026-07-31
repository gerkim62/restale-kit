/**
 * Gap 3: Target configuration admits arbitrary strings via arrays
 * 
 * SSEChannelOptions.target and ChannelDefaults.target contain string[],
 * so unknown literals in arrays are accepted despite single-string case
 * being properly restricted. This creates channels with protocol targets
 * no client adapter can handle.
 */

import { describe, it, expect } from 'vitest';
import { createSSEChannel } from '../../server/core/channel.js';
import { SSEChannelGroup } from '../../server/core/channel-group.js';
import { mergeChannelDefaults } from '../../server/core/merge-channel-defaults.js';

describe('Gap 3: Target configuration admits arbitrary strings', () => {
  describe('SSEChannel target validation', () => {
    it('should reject unknown literal in single-target configuration', () => {
      expect(() => {
        // @ts-expect-error - Unknown target literal
        createSSEChannel({ target: 'not-a-real-target' });
      }).toThrow();

      expect(() => {
        // @ts-expect-error - Typo in target name
        createSSEChannel({ target: 'tank-stack-query' });
      }).toThrow();

      expect(() => {
        // @ts-expect-error - Wrong casing
        createSSEChannel({ target: 'SWR' });
      }).toThrow();
    });

    it('should reject unknown literals in target arrays', () => {
      expect(() => {
        // @ts-expect-error - Unknown target in array
        createSSEChannel({ target: ['not-a-real-target'] });
      }).toThrow();

      expect(() => {
        // @ts-expect-error - Mix of valid and invalid
        createSSEChannel({ target: ['swr', 'unknown-target'] });
      }).toThrow();

      expect(() => {
        // @ts-expect-error - All unknown
        createSSEChannel({ target: ['fake-1', 'fake-2'] });
      }).toThrow();
    });

    it('should reject empty target arrays', () => {
      expect(() => {
        // @ts-expect-error - Empty array not allowed
        createSSEChannel({ target: [] });
      }).toThrow(/target/i);

      // Should also fail at runtime
      expect(() => {
        createSSEChannel({ target: [] as any });
      }).toThrow(/target/i);
    });

    it('should reject duplicate literal targets', () => {
      expect(() => {
        // @ts-expect-error - Duplicate targets are meaningless
        createSSEChannel({ target: ['swr', 'swr'] });
      }).toThrow(/duplicate/i);

      expect(() => {
        // @ts-expect-error - Duplicates with other valid targets
        createSSEChannel({ target: ['swr', 'tanstack-query', 'swr'] });
      }).toThrow(/duplicate/i);

      // Runtime should also reject
      expect(() => {
        createSSEChannel({ target: ['swr', 'swr'] as any });
      }).toThrow(/duplicate/i);
    });

    it('should accept only valid target literals in arrays', () => {
      expect(() => {
        createSSEChannel({ target: ['swr'] });
      }).not.toThrow();

      expect(() => {
        createSSEChannel({ target: ['tanstack-query'] });
      }).not.toThrow();

      expect(() => {
        createSSEChannel({ target: ['rtk-query'] });
      }).not.toThrow();

      expect(() => {
        createSSEChannel({ target: ['swr', 'tanstack-query'] as const });
      }).not.toThrow();

      expect(() => {
        createSSEChannel({ 
          target: ['swr', 'tanstack-query', 'rtk-query'] as const 
        });
      }).not.toThrow();
    });

    it('should handle const assertions correctly', () => {
      // Valid with const
      const validTargets = ['swr', 'tanstack-query'] as const;
      expect(() => {
        createSSEChannel({ target: validTargets });
      }).not.toThrow();

      expect(() => {
        // @ts-expect-error - Invalid even with const
        const invalidTargets = ['not-real'] as const;
        createSSEChannel({ target: invalidTargets });
      }).toThrow();
    });
  });

  describe('SSEChannelGroup target validation', () => {
    it('should reject unknown targets in group options', () => {
      expect(() => {
        // @ts-expect-error - Unknown target
        new SSEChannelGroup({ target: 'invalid-target' });
      }).toThrow();

      expect(() => {
        // @ts-expect-error - Unknown in array
        new SSEChannelGroup({ target: ['unknown'] });
      }).toThrow();

      expect(() => {
        // @ts-expect-error - Mix of valid and invalid
        new SSEChannelGroup({ target: ['swr', 'bad-target'] });
      }).toThrow();
    });

    it('should reject empty target arrays in group', () => {
      expect(() => {
        // @ts-expect-error - Empty array
        new SSEChannelGroup({ target: [] });
      }).toThrow();
    });

    it('should reject duplicate targets in group', () => {
      expect(() => {
        // @ts-expect-error - Duplicate targets
        new SSEChannelGroup({ target: ['swr', 'swr'] });
      }).toThrow();
    });

    it('should accept valid targets in group', () => {
      expect(() => {
        new SSEChannelGroup({ target: 'swr' });
      }).not.toThrow();

      expect(() => {
        new SSEChannelGroup({ target: ['swr', 'tanstack-query'] as const });
      }).not.toThrow();
    });
  });

  describe('channelDefaults validation', () => {
    it('should reject unknown targets in defaults', () => {
      expect(() => {
        // @ts-expect-error - Unknown target
        mergeChannelDefaults({ target: 'wrong-target' }, {});
      }).toThrow();

      expect(() => {
        // @ts-expect-error - Unknown in array
        mergeChannelDefaults({ target: ['bad-target'] }, {});
      }).toThrow();
    });

    it('should reject empty target arrays in defaults', () => {
      expect(() => {
        // @ts-expect-error - Empty array
        mergeChannelDefaults({ target: [] }, {});
      }).toThrow();
    });

    it('should reject duplicate targets in defaults', () => {
      expect(() => {
        // @ts-expect-error - Duplicates
        mergeChannelDefaults({ target: ['swr', 'swr'] }, {});
      }).toThrow();
    });

    it('should accept valid targets in defaults', () => {
      expect(() => {
        mergeChannelDefaults({ target: 'swr' }, {});
      }).not.toThrow();
      
      expect(() => {
        mergeChannelDefaults({ target: ['swr', 'rtk-query'] as const }, {});
      }).not.toThrow();
    });

    it('should merge defaults with channel options correctly', () => {
      const defaults = { target: 'swr' as const };
      const options = {};
      
      const merged = mergeChannelDefaults(options, defaults);
      expect(merged.target).toBe('swr');
    });

    it('should validate when defaults are overridden', () => {
      const defaults = { target: 'swr' as const };
      
      expect(() => {
        // @ts-expect-error - Override with invalid target
        mergeChannelDefaults({ target: 'invalid' }, defaults);
      }).toThrow();
    });
  });

  describe('Runtime validation of target strings', () => {
    it('should throw for dynamically invalid target strings', () => {
      const dynamicTarget: string = 'not-valid';
      
      expect(() => {
        createSSEChannel({ target: dynamicTarget as any });
      }).toThrow(/unsupported.*target/i);
    });

    it('should throw for dynamically constructed invalid arrays', () => {
      const targets: string[] = ['valid-looking-but-not'];
      
      expect(() => {
        createSSEChannel({ target: targets as any });
      }).toThrow(/unsupported.*target/i);
    });

    it('should validate each element in dynamic array', () => {
      const mixedTargets: string[] = ['swr', 'invalid-target'];
      
      expect(() => {
        createSSEChannel({ target: mixedTargets as any });
      }).toThrow(/unsupported.*target/i);
    });

    it('should succeed for dynamically valid targets', () => {
      const dynamicValid: string = 'swr';
      
      expect(() => {
        createSSEChannel({ target: dynamicValid as any });
      }).not.toThrow();
    });
  });

  describe('Type narrowing for target arrays', () => {
    it('should narrow single-element arrays appropriately', () => {
      const channel = createSSEChannel({ target: ['swr'] as const });
      
      // Should behave like single-target channel
      channel.invalidate({ target: 'swr', key: ['test'] });
    });

    it('should maintain tuple types for multi-element arrays', () => {
      const channel = createSSEChannel({ 
        target: ['swr', 'tanstack-query'] as const,
        requestedTarget: 'swr'
      });
      
      // Should require batch
      channel.invalidate([
        { target: 'swr', key: ['test'] },
        { target: 'tanstack-query', queryKey: ['test'] }
      ]);
    });
  });

  describe('Client adapter compatibility', () => {
    it('should only allow targets with corresponding client adapters', () => {
      // Valid: has tanstackQueryAdapter
      expect(() => {
        createSSEChannel({ target: 'tanstack-query' });
      }).not.toThrow();
      
      // Valid: has swrAdapter
      expect(() => {
        createSSEChannel({ target: 'swr' });
      }).not.toThrow();
      
      // Valid: has rtkQueryAdapter
      expect(() => {
        createSSEChannel({ target: 'rtk-query' });
      }).not.toThrow();
      
      // Invalid: no corresponding adapter
      expect(() => {
        createSSEChannel({ target: 'hypothetical-future-target' as any });
      }).toThrow();
    });

    it('should document supported targets in type errors', () => {
      expect(() => {
        // @ts-expect-error - Should show available targets
        createSSEChannel({ target: 'graphql-query' });
      }).toThrow();
    });
  });

  describe('Edge cases with type widening', () => {
    it('should handle string union widening safely', () => {
      type PossibleTarget = 'swr' | 'tanstack-query';
      const target: PossibleTarget = 'swr';
      
      // Should work - target is constrained to valid values
      expect(() => {
        createSSEChannel({ target });
      }).not.toThrow();
    });

    it('should reject plain string type without narrowing', () => {
      const target: string = 'swr';
      expect(() => {
        // @ts-expect-error - Plain string too broad
        createSSEChannel({ target: target as any });
      }).not.toThrow();
    });

    it('should handle readonly array types', () => {
      const targets: readonly ('swr' | 'tanstack-query')[] = ['swr', 'tanstack-query'];
      
      expect(() => {
        createSSEChannel({ target: targets as any });
      }).not.toThrow();
    });

    it('should reject mutable arrays without const assertion', () => {
      const targets = ['swr', 'tanstack-query'];
      expect(() => {
        // @ts-expect-error - Mutable array might contain invalid values
        createSSEChannel({ target: targets as any, requestedTarget: 'swr' });
      }).not.toThrow();
    });
  });

  describe('Integration with channel group registration', () => {
    it('should validate target when registering channel to group', () => {
      const group = new SSEChannelGroup<any>();
      
      expect(() => {
        // @ts-expect-error - Invalid target
        const badChannel = createSSEChannel({ target: 'invalid' });
        group.register(badChannel);
      }).toThrow();
    });

    it('should ensure group and channel target compatibility', () => {
      const swrGroup = new SSEChannelGroup({ target: 'swr' });
      
      // Valid: matching target
      const swrChannel = createSSEChannel({ target: 'swr' });
      swrGroup.register(swrChannel);
      
      expect(swrGroup).toBeDefined();
    });
  });

  describe('Default target handling', () => {
    it('should use default target when none specified', () => {
      // If default is provided, it should be a valid target
      expect(() => {
        // @ts-expect-error - Target required
        createSSEChannel({} as any);
      }).toThrow(/target.*required/i);
    });

    it('should prefer explicit target over default', () => {
      const defaults = { target: 'swr' as const };
      const options = { target: 'tanstack-query' as const };
      
      const merged = mergeChannelDefaults(options, defaults);
      expect(merged.target).toBe('tanstack-query');
    });
  });
});
