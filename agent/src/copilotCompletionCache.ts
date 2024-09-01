import type { Completion } from "../../lib/src/types.ts";

import { LRUCacheMap } from "../../lib/src/common/cache.ts";

// ./commands/panel.ts
// <uuid, completion>
class CopilotCompletionCache extends LRUCacheMap<string, Completion> {
  constructor(maxSize: number = 100) {
    super(maxSize);
  }
}

export { CopilotCompletionCache };
