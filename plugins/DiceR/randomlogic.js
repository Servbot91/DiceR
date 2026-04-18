(function() {
  'use strict';

  /* ==========================
     ADVANCED DEBUG LOGGER
  ========================== */

  const DEBUG = false; // Enable detailed logging
  let rollCount = 0;

  const DiceRLogger = {
    styles: {
      base: "font-weight:600;padding:2px 6px;border-radius:4px;",
      info: "background:#1e90ff;color:white;",
      success: "background:#28a745;color:white;",
      warn: "background:#ff9800;color:black;",
      error: "background:#e53935;color:white;",
      event: "background:#6f42c1;color:white;"
    },

    log(type, label, data = null) {
      if (!DEBUG) return;

      const time = new Date().toISOString().split("T")[1].replace("Z", "");
      const style = this.styles[type] || this.styles.info;

      console.groupCollapsed(
        `%c DiceR %c ${type.toUpperCase()} %c ${label} %c ${time}`,
        this.styles.base + "background:#222;color:#fff;",
        this.styles.base + style,
        "font-weight:600;",
        "color:#999;font-size:11px;"
      );

      if (data !== null) console.log(data);

      console.groupEnd();
    },

    time(label) {
      if (!DEBUG) return;
      console.time(`⏱ DiceR ${label}`);
    },

    timeEnd(label) {
      if (!DEBUG) return;
      console.timeEnd(`⏱ DiceR ${label}`);
    }
  };

  DiceRLogger.log("success", "Plugin initialized");

  /* ==========================
     CONSTANTS AND CONFIGURATION
  ========================== */

  const CONFIG = {
    CACHE_REFRESH_INTERVAL: 5 * 60 * 1000, // 5 minutes
    RECENT_SEEN_LIMIT: 1000, // High-priority recent seen items
    HISTORY_SEEN_LIMIT: 10000, // Lower-priority historical seen items
    MAX_RETRY_ATTEMPTS: 5,
    PAGE_SIZE: 1000,
    REQUEST_TIMEOUT: 6000, // 6 seconds timeout
    MAX_TIMEOUT_RETRIES: 3, // Number of retry attempts for timeouts
    CACHE_VERSION: 2, // For cache structure validation
    
    // Mobile-specific configurations
    MOBILE_PAGE_SIZE: 100, // Smaller page size for mobile
    MOBILE_CACHE_REFRESH_INTERVAL: 15 * 60 * 1000, // Longer cache refresh
    MOBILE_REQUEST_TIMEOUT: 10000, // Longer timeout for mobile networks
    MOBILE_MAX_RETRY_ATTEMPTS: 3, // Fewer retries for mobile
    MOBILE_MAX_ITEMS_TO_PROCESS: 5000, // Limit total items processed
    ENABLE_THROTTLING: true,
    THROTTLE_DELAY: 100, // ms between operations
  
    // Desktop-specific configurations
    DESKTOP_PAGE_SIZE: 1000,
    DESKTOP_REQUEST_TIMEOUT: 6000,
    DESKTOP_MAX_RETRY_ATTEMPTS: 5
  };

  // Device detection
  const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isLowPowerMode = navigator.connection && navigator.connection.effectiveType && 
                      (navigator.connection.effectiveType.includes('slow') || 
                       navigator.connection.effectiveType === '2g');  
  // Apply device-specific configurations
  if (isMobile) {
    CONFIG.PAGE_SIZE = CONFIG.MOBILE_PAGE_SIZE;
    CONFIG.REQUEST_TIMEOUT = CONFIG.MOBILE_REQUEST_TIMEOUT;
    CONFIG.MAX_RETRY_ATTEMPTS = CONFIG.MOBILE_MAX_RETRY_ATTEMPTS;
    DiceRLogger.log("info", "Mobile device detected - applying mobile optimizations");
  } else {
    CONFIG.PAGE_SIZE = CONFIG.DESKTOP_PAGE_SIZE;
    CONFIG.REQUEST_TIMEOUT = CONFIG.DESKTOP_REQUEST_TIMEOUT;
    CONFIG.MAX_RETRY_ATTEMPTS = CONFIG.DESKTOP_MAX_RETRY_ATTEMPTS;
    DiceRLogger.log("info", "Desktop device detected - applying desktop optimizations");
  }

// Throttled processing for mobile
function throttle(func, limit) {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// Memory-efficient shuffle (Fisher-Yates with early termination)
function efficientShuffle(array, maxElements = 1000) {
  const len = Math.min(array.length, maxElements);
  for (let i = len - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array.slice(0, len);
}

  /* ==========================
     UNIFORM ENTITY LOGGING
  ========================== */

  function logEntityAction(entity, action, details = {}) {
    DiceRLogger.log("info", `${entity} - ${action}`, details);
  }

  function logEntitySuccess(entity, action, details = {}) {
    DiceRLogger.log("success", `${entity} - ${action}`, details);
  }

  function logEntityWarning(entity, action, details = {}) {
    DiceRLogger.log("warn", `${entity} - ${action}`, details);
  }

  function logEntityError(entity, action, details = {}) {
    DiceRLogger.log("error", `${entity} - ${action}`, details);
  }

  /* ==========================
     TIMEOUT HANDLING UTILITIES
  ========================== */

  // Wrapper for fetch with timeout
  async function fetchWithTimeout(url, options = {}) {
    const { timeout = CONFIG.REQUEST_TIMEOUT } = options;
    
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(id);
      return response;
    } catch (error) {
      clearTimeout(id);
      if (controller.signal.aborted) {
        throw new Error('REQUEST_TIMEOUT');
      }
      throw error;
    }
  }

  // Retry wrapper for functions that might timeout
  async function retryWithTimeout(asyncFunction, maxRetries = CONFIG.MAX_TIMEOUT_RETRIES) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await asyncFunction();
      } catch (error) {
        if (error.message === 'REQUEST_TIMEOUT' && attempt < maxRetries) {
          logEntityWarning("System", "Request timeout", { attempt, maxRetries });
          // Add a small delay between retries
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        throw error;
      }
    }
  }

  /* ==========================
     HELPERS
  ========================== */

  function getIdFromPath(regex) {
    const m = window.location.pathname.match(regex);
    return m ? m[1] : null;
  }

  function getPlural(entity) {
    const pluralMap = {
      'Gallery': 'Galleries',
      'Tag': 'Tags',
      'Image': 'Images',
      'Scene': 'Scenes',
      'Performer': 'Performers',
      'Studio': 'Studios',
      'Group': 'Groups'
    };
    return pluralMap[entity] || entity + "s";
  }

  function getCacheKey(entity, internalFilter) {
    const filterKey = internalFilter ? JSON.stringify(internalFilter) : 'global';
    // Limit cache key length to prevent storage issues
    const cacheKey = `randomData_${entity}_${filterKey.substring(0, 100)}`;
    return cacheKey;
  }

  // Optimized shuffle using Fisher-Yates algorithm
  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /* ==========================
     TIERED SEEN TRACKING
  ========================== */

  class TieredSeenTracker {
    constructor(cacheKey, entity) {
      this.cacheKey = cacheKey;
      this.entity = entity;
      this.recentKey = `${cacheKey}_recent`;
      this.historyKey = `${cacheKey}_history`;
      this.recentSeen = new Set();
      this.historySeen = new Set();
      this.loadSeenData();
      logEntitySuccess(this.entity, "TieredSeenTracker initialized", { 
        cacheKey, 
        recentCount: this.recentSeen.size, 
        historyCount: this.historySeen.size 
      });
    }

    loadSeenData() {
      try {
        const recentStored = localStorage.getItem(this.recentKey);
        const historyStored = localStorage.getItem(this.historyKey);
        
        this.recentSeen = new Set(recentStored ? JSON.parse(recentStored) : []);
        this.historySeen = new Set(historyStored ? JSON.parse(historyStored) : []);
        
        logEntitySuccess(this.entity, "Seen data loaded", { 
          recentLoaded: this.recentSeen.size, 
          historyLoaded: this.historySeen.size 
        });
      } catch (e) {
        logEntityWarning(this.entity, "Failed to load seen data, using empty sets", e);
        this.recentSeen = new Set();
        this.historySeen = new Set();
      }
    }

    saveSeenData() {
      try {
        // Maintain size limits for both tiers
        const beforeRecent = this.recentSeen.size;
        const beforeHistory = this.historySeen.size;
        
        this.maintainSizeLimits();
        
        localStorage.setItem(this.recentKey, JSON.stringify(Array.from(this.recentSeen)));
        localStorage.setItem(this.historyKey, JSON.stringify(Array.from(this.historySeen)));
        
        logEntitySuccess(this.entity, "Seen data saved", { 
          recentCount: this.recentSeen.size,
          historyCount: this.historySeen.size,
          recentChanged: beforeRecent !== this.recentSeen.size,
          historyChanged: beforeHistory !== this.historySeen.size
        });
      } catch (e) {
        logEntityWarning(this.entity, "Failed to save seen data", e);
      }
    }

    maintainSizeLimits() {
      const initialRecent = this.recentSeen.size;
      const initialHistory = this.historySeen.size;
      
      // Manage recent seen (high priority)
      if (this.recentSeen.size > CONFIG.RECENT_SEEN_LIMIT) {
        const recentArray = Array.from(this.recentSeen);
        // Move oldest items to history
        const itemsToDemote = recentArray.slice(0, recentArray.length - CONFIG.RECENT_SEEN_LIMIT + 200);
        itemsToDemote.forEach(id => {
          this.historySeen.add(id);
          this.recentSeen.delete(id);
        });
        logEntityWarning(this.entity, "Recent seen limit exceeded, demoted items to history", { 
          demotedCount: itemsToDemote.length 
        });
      }

      // Manage history seen (lower priority)
      if (this.historySeen.size > CONFIG.HISTORY_SEEN_LIMIT) {
        const historyArray = Array.from(this.historySeen);
        // Remove oldest items
        const excess = historyArray.length - CONFIG.HISTORY_SEEN_LIMIT;
        if (excess > 0) {
          historyArray.slice(0, excess).forEach(id => this.historySeen.delete(id));
          logEntityWarning(this.entity, "History seen limit exceeded, removed oldest items", { 
            removedCount: excess 
          });
        }
      }
      
      if (initialRecent !== this.recentSeen.size || initialHistory !== this.historySeen.size) {
        logEntitySuccess(this.entity, "Size limits maintained", {
          recentBefore: initialRecent,
          recentAfter: this.recentSeen.size,
          historyBefore: initialHistory,
          historyAfter: this.historySeen.size
        });
      }
    }

    addSeen(id) {
      // Add to recent seen (highest priority)
      const wasNew = !this.recentSeen.has(id);
      this.recentSeen.add(id);
      
      logEntitySuccess(this.entity, "Item marked as seen", { 
        id, 
        isNew: wasNew,
        recentCount: this.recentSeen.size,
        historyCount: this.historySeen.size
      });
      
      // Always save to ensure persistence - performance impact is minimal
      this.saveSeenData();
    }

    hasSeen(id) {
      // Check recent first (higher priority), then history
      const seenInRecent = this.recentSeen.has(id);
      const seenInHistory = this.historySeen.has(id);
      const isSeen = seenInRecent || seenInHistory;
      
      if (isSeen) {
        logEntityAction(this.entity, "Item previously seen", { 
          id, 
          inRecent: seenInRecent, 
          inHistory: seenInHistory 
        });
      }
      
      return isSeen;
    }

    getSeenCount() {
      const totalCount = this.recentSeen.size + this.historySeen.size;
      logEntityAction(this.entity, "Current seen count", { 
        recent: this.recentSeen.size, 
        history: this.historySeen.size, 
        total: totalCount 
      });
      return totalCount;
    }

    clear() {
      const clearedCount = this.recentSeen.size + this.historySeen.size;
      this.recentSeen.clear();
      this.historySeen.clear();
      this.saveSeenData();
      logEntityWarning(this.entity, "Seen tracking cleared", { clearedItems: clearedCount });
    }
  }

  /* ==========================
     CACHED DATA MANAGER
  ========================== */

  class CachedDataManager {
    constructor(cacheKey, entity, internalFilter) {
      this.cacheKey = cacheKey;
      this.entity = entity;
      this.internalFilter = internalFilter;
      this.metadataKey = `${cacheKey}_meta`;
      this.metadata = {
        totalCount: 0,
        lastUpdated: 0,
        version: CONFIG.CACHE_VERSION,
        entity: entity,
        filter: internalFilter ? JSON.stringify(internalFilter) : 'global'
      };
      this.loadMetadata();
      logEntitySuccess(this.entity, "CachedDataManager initialized", { cacheKey, entity });
    }

    loadMetadata() {
      try {
        const stored = localStorage.getItem(this.metadataKey);
        if (stored) {
          const parsedMetadata = JSON.parse(stored);
          
          // Validate cache version and structure
          if (parsedMetadata.version !== CONFIG.CACHE_VERSION) {
            logEntityWarning(this.entity, "Cache version mismatch, clearing cache", { 
              oldVersion: parsedMetadata.version, 
              newVersion: CONFIG.CACHE_VERSION 
            });
            this.clearCache();
            return;
          }
          
          // Validate entity match
          if (parsedMetadata.entity !== this.entity) {
            logEntityWarning(this.entity, "Entity mismatch, clearing cache", { 
              storedEntity: parsedMetadata.entity, 
              currentEntity: this.entity 
            });
            this.clearCache();
            return;
          }
          
          // Validate filter match
          const storedFilter = parsedMetadata.filter;
          const currentFilter = this.internalFilter ? JSON.stringify(this.internalFilter) : 'global';
          if (storedFilter !== currentFilter) {
            logEntityWarning(this.entity, "Filter mismatch, clearing cache", { 
              storedFilter, 
              currentFilter 
            });
            this.clearCache();
            return;
          }
          
          this.metadata = parsedMetadata;
          logEntitySuccess(this.entity, "Metadata loaded and validated", this.metadata);
        }
      } catch (e) {
        logEntityWarning(this.entity, "Failed to load metadata, using defaults", e);
        this.clearCache();
      }
    }

    saveMetadata() {
      try {
        localStorage.setItem(this.metadataKey, JSON.stringify(this.metadata));
        logEntitySuccess(this.entity, "Metadata saved", this.metadata);
      } catch (e) {
        logEntityWarning(this.entity, "Failed to save metadata", e);
      }
    }

    needsRefresh() {
      const needsRefresh = Date.now() - this.metadata.lastUpdated > CONFIG.CACHE_REFRESH_INTERVAL;
      const cacheTooOld = Date.now() - this.metadata.lastUpdated > (CONFIG.CACHE_REFRESH_INTERVAL * 3); // Force refresh if very old
      
      logEntityAction(this.entity, "Cache refresh check", { 
        needsRefresh, 
        cacheTooOld,
        lastUpdated: this.metadata.lastUpdated, 
        currentTime: Date.now(),
        interval: CONFIG.CACHE_REFRESH_INTERVAL
      });
      
      return needsRefresh || cacheTooOld;
    }

    updateTotalCount(count) {
      const oldCount = this.metadata.totalCount;
      this.metadata.totalCount = count;
      this.metadata.lastUpdated = Date.now();
      this.metadata.version = CONFIG.CACHE_VERSION;
      this.metadata.entity = this.entity;
      this.metadata.filter = this.internalFilter ? JSON.stringify(this.internalFilter) : 'global';
      this.saveMetadata();
      logEntitySuccess(this.entity, "Total count updated", { 
        oldCount, 
        newCount: count, 
        updated: this.metadata.lastUpdated 
      });
      
      if (isMobile) {
        count = Math.min(count, CONFIG.MOBILE_MAX_ITEMS_TO_PROCESS);
      }   
    }

    getTotalCount() {
      logEntityAction(this.entity, "Retrieved total count", { count: this.metadata.totalCount });
      return this.metadata.totalCount;
    }

    clearCache() {
      this.metadata = {
        totalCount: 0,
        lastUpdated: 0,
        version: CONFIG.CACHE_VERSION,
        entity: this.entity,
        filter: this.internalFilter ? JSON.stringify(this.internalFilter) : 'global'
      };
      this.saveMetadata();
      logEntityWarning(this.entity, "Cache cleared and reset");
    }

    validateCacheIntegrity(cacheDataKey) {
      try {
        const stored = localStorage.getItem(cacheDataKey);
        if (!stored) return false;
        
        const parsed = JSON.parse(stored);
        // Basic structure validation
        if (!parsed.hasOwnProperty('allIds') || !parsed.hasOwnProperty('remaining')) {
          logEntityWarning(this.entity, "Cache structure invalid", { hasAllIds: !!parsed.allIds, hasRemaining: !!parsed.remaining });
          return false;
        }
        
        // Type validation
        if (!Array.isArray(parsed.allIds) || !Array.isArray(parsed.remaining)) {
          logEntityWarning(this.entity, "Cache data types invalid");
          return false;
        }
        
        return true;
      } catch (e) {
        logEntityWarning(this.entity, "Cache integrity check failed", e);
        return false;
      }
    }
  }

  /* ==========================
     HYBRID RANDOM SYSTEM
  ========================== */

  async function randomGlobal(entity, idField, redirectPrefix, internalFilter) {
    rollCount++;
    logEntityAction(entity, `🎲 Roll #${rollCount}`, { internalFilter });

    const cacheKey = getCacheKey(entity, internalFilter);
    const shouldUseSampling = (entity === "Image" || entity === "Scene" || entity === "Gallery" || entity === "Performer") && !internalFilter;

    if (shouldUseSampling) {
      logEntityAction(entity, "Using sampling approach for large collection");
      return await randomWithSamplingAndTracking(entity, idField, redirectPrefix, internalFilter, cacheKey);
    }

    logEntityAction(entity, "Using full cache approach for smaller collection");
    return await randomWithFullCache(entity, idField, redirectPrefix, internalFilter, cacheKey);
  }

  // Optimized: Hybrid approach for large collections with seen/unseen tracking
  async function randomWithSamplingAndTracking(entity, idField, redirectPrefix, internalFilter, cacheKey) {
    const realEntityPlural = getPlural(entity);
    const seenTracker = new TieredSeenTracker(cacheKey, entity);
    const dataManager = new CachedDataManager(cacheKey, entity, internalFilter);

    // Refresh total count periodically with timeout handling
    if (dataManager.needsRefresh()) {
      logEntityAction(entity, "Refreshing total count");
      
      try {
        const count = await retryWithTimeout(() => getTotalCount(entity, internalFilter));
        if (count !== null) {
          dataManager.updateTotalCount(count);
        } else {
          logEntityWarning(entity, "Failed to refresh count, using cached value");
        }
      } catch (error) {
        logEntityError(entity, "Failed to refresh count due to timeout", error);
        // Continue with cached value
      }
    }

    // Try to find an item that hasn't been seen
    let attempts = 0;
    let selectedItem = null;
    let selectedId = null;

    logEntityAction(entity, "Starting selection attempts", { maxAttempts: CONFIG.MAX_RETRY_ATTEMPTS });

    while (attempts < CONFIG.MAX_RETRY_ATTEMPTS && !selectedItem) {
      attempts++;
      logEntityAction(entity, `Selection attempt #${attempts}`);
      
      try {
        const itemResult = await retryWithTimeout(() => getRandomItemBySampling(entity, idField, internalFilter));
        
        if (itemResult && itemResult.item && itemResult.id) {
          // Check if we've seen this item before
          if (!seenTracker.hasSeen(itemResult.id)) {
            selectedItem = itemResult.item;
            selectedId = itemResult.id;
            logEntitySuccess(entity, "Found unseen item", { 
              id: selectedId, 
              attemptsUsed: attempts 
            });
            break;
          } else {
            logEntityAction(entity, "Skipping already seen item", { 
              id: itemResult.id, 
              attempts 
            });
          }
        } else {
          logEntityWarning(entity, "Failed to get item from sampling", { attempts });
        }
      } catch (error) {
        if (error.message === 'REQUEST_TIMEOUT') {
          logEntityWarning(entity, "Timeout during sampling attempt", { attempts });
        } else {
          throw error;
        }
      }
    }

    // If we couldn't find an unseen item, either reshuffle or pick one anyway
    if (!selectedItem) {
      logEntityWarning(entity, "All items may have been seen, allowing repeats");
      
      // Clear seen tracking to allow repeats if most items have been seen
      const totalCount = dataManager.getTotalCount();
      const seenCount = seenTracker.getSeenCount();
      
      if (seenCount > (totalCount || 10000) * 0.9) {
        logEntityWarning(entity, "Resetting seen tracking - most items seen", { 
          seenCount, 
          totalCount, 
          threshold: (totalCount || 10000) * 0.9 
        });
        seenTracker.clear();
      }
      
      try {
        const sampleResult = await retryWithTimeout(() => getRandomItemBySampling(entity, idField, internalFilter));
        if (sampleResult && sampleResult.item) {
          selectedItem = sampleResult.item;
          selectedId = sampleResult.id;
          logEntitySuccess(entity, "Selected item with repeats allowed", { selectedId });
        }
      } catch (error) {
        if (error.message !== 'REQUEST_TIMEOUT') {
          throw error;
        }
      }
    }

    if (selectedItem && selectedId) {
      // Mark as seen
      seenTracker.addSeen(selectedId);

      logEntitySuccess(entity, "Selected random item", {
        itemId: selectedId,
        seenCount: seenTracker.getSeenCount(),
        totalEstimated: dataManager.getTotalCount()
      });

      window.location.href = `${redirectPrefix}${selectedId}`;
    } else {
      logEntityError(entity, "Failed to select item after max attempts");
      alert("Unable to select random item.");
    }
  }

  // Helper function to get random item via optimized sampling
  async function getRandomItemBySampling(entity, idField, internalFilter) {
    const realEntityPlural = getPlural(entity);
    
    try {
      logEntityAction(entity, "Getting random item via sampling", { idField });
      
      // Get total count
      const totalCount = await getTotalCount(entity, internalFilter);
      if (totalCount === 0) {
        logEntityWarning(entity, "Total count is zero");
        return null;
      }

      logEntityAction(entity, "Total count retrieved", { totalCount });

      // Generate random page and offset
      const totalPages = Math.ceil(totalCount / CONFIG.PAGE_SIZE);
      const randomPage = Math.floor(Math.random() * totalPages);
      const itemsInLastPage = totalCount % CONFIG.PAGE_SIZE || CONFIG.PAGE_SIZE;
      const maxOffset = (randomPage === totalPages - 1) ? itemsInLastPage : CONFIG.PAGE_SIZE;
      const randomOffsetInPage = Math.floor(Math.random() * maxOffset);

      logEntityAction(entity, "Sampling parameters", { 
        totalPages, 
        randomPage, 
        itemsInLastPage, 
        maxOffset, 
        randomOffsetInPage 
      });

      // Add random sort to prevent chronological ordering
      const sortOptions = ['created_at', 'updated_at', 'name', 'path', 'date'];
      const randomSort = sortOptions[Math.floor(Math.random() * sortOptions.length)];
      const sortDirection = Math.random() > 0.5 ? 'ASC' : 'DESC';

      logEntityAction(entity, "Random sort applied", { randomSort, sortDirection });

      // Fetch the specific page
      let filterArg = "";
      let filterVar = "";
      let variables = {
        filter: { 
          per_page: CONFIG.PAGE_SIZE,
          page: randomPage + 1,
          sort: randomSort,
          direction: sortDirection
        }
      };

      if (internalFilter) {
        filterArg = `, $internal_filter: ${entity}FilterType`;
        filterVar = `, ${entity.toLowerCase()}_filter: $internal_filter`;
        variables.internal_filter = internalFilter;
        logEntityAction(entity, "Applied internal filter", { internalFilter });
      }

      const pageQuery = `
        query Find${realEntityPlural}($filter: FindFilterType${filterArg}) {
          find${realEntityPlural}(filter: $filter${filterVar}) {
            ${idField} { id }
          }
        }
      `;

      logEntityAction(entity, "Executing GraphQL sampling query", { 
        query: pageQuery.substring(0, 100) + "...",
        variables 
      });

      const response = await fetchWithTimeout('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: pageQuery, variables })
      });

      const data = await response.json();
      
      if (data.errors) {
        logEntityError(entity, "GraphQL errors in sampling", data.errors);
        return null;
      }

      let items = data.data[`find${realEntityPlural}`][idField];
      if (!items || items.length === 0) {
        logEntityWarning(entity, "No items returned from sampling query", { 
          page: randomPage + 1
        });
        return null;
      }

      logEntitySuccess(entity, "Sampling query successful", { 
        itemCount: items.length,
        page: randomPage + 1 
      });

      // Select random item from the page
      const randomIndex = randomOffsetInPage < items.length ? randomOffsetInPage : Math.floor(Math.random() * items.length);
      const selectedItem = items[randomIndex];

      logEntitySuccess(entity, "Random item selected from page", { 
        index: randomIndex, 
        id: selectedItem.id 
      });

      return {
        item: selectedItem,
        id: selectedItem.id
      };
    } catch (error) {
      logEntityError(entity, "Sampling failed", error);
      throw error;
    }
  }

  // Optimized cache-based approach for smaller collections
  async function randomWithFullCache(entity, idField, redirectPrefix, internalFilter, cacheKey) {
    const realEntityPlural = getPlural(entity);
    const cacheDataKey = `${cacheKey}_ids`;
    const dataManager = new CachedDataManager(cacheKey, entity, internalFilter);

    let filterArg = "";
    let filterVar = "";
    let variables = {
      filter: { per_page: -1 }
    };

    if (internalFilter) {
      filterArg = `, $internal_filter: ${entity}FilterType`;
      filterVar = `, ${entity.toLowerCase()}_filter: $internal_filter`;
      variables.internal_filter = internalFilter;
    }

    const query = `
      query Find${realEntityPlural}($filter: FindFilterType${filterArg}) {
        find${realEntityPlural}(filter: $filter${filterVar}) {
          ${idField} { id }
        }
      }
    `;

    logEntityAction(entity, "Running full cache GraphQL query");
    DiceRLogger.time(`${entity} GraphQL Request`);

    try {
      const response = await fetchWithTimeout('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables })
      });

      const data = await response.json();
      DiceRLogger.timeEnd(`${entity} GraphQL Request`);

      if (data.errors) {
        logEntityError(entity, "GraphQL errors", data.errors);
        alert("Error: " + JSON.stringify(data.errors));
        return;
      }

      let items = data.data[`find${realEntityPlural}`][idField];
      if (!items || items.length === 0) {
        logEntityWarning(entity, "No results found");
        alert("No results found.");
        return;
      }

      const currentIds = items.map(i => i.id);
      logEntitySuccess(entity, "Fetched IDs", { count: currentIds.length });

      // Load cached data with validation
      let stored = getCachedData(cacheDataKey);
      
      // Validate cache integrity
      if (stored && !dataManager.validateCacheIntegrity(cacheDataKey)) {
        logEntityWarning(entity, "Cache integrity check failed, clearing cache");
        stored = null;
      }
      
      if (!stored) {
        logEntityWarning(entity, "Cache created (first run or invalid)");
        stored = {
          allIds: currentIds,
          remaining: shuffleArray([...currentIds]),
          version: CONFIG.CACHE_VERSION,
          entity: entity,
          filter: internalFilter ? JSON.stringify(internalFilter) : 'global'
        };
        setCachedData(cacheDataKey, stored);
        logEntitySuccess(entity, "New cache initialized", { 
          totalItems: stored.allIds.length,
          remainingItems: stored.remaining.length 
        });
      } else {
        // Validate cache metadata
        if (stored.version !== CONFIG.CACHE_VERSION || 
            stored.entity !== entity || 
            stored.filter !== (internalFilter ? JSON.stringify(internalFilter) : 'global')) {
          logEntityWarning(entity, "Cache metadata mismatch, recreating cache", {
            storedVersion: stored.version,
            currentVersion: CONFIG.CACHE_VERSION,
            storedEntity: stored.entity,
            currentEntity: entity
          });
          stored = {
            allIds: currentIds,
            remaining: shuffleArray([...currentIds]),
            version: CONFIG.CACHE_VERSION,
            entity: entity,
            filter: internalFilter ? JSON.stringify(internalFilter) : 'global'
          };
          setCachedData(cacheDataKey, stored);
        } else {
          // Incremental update logic
          const oldAll = new Set(stored.allIds);
          const currentSet = new Set(currentIds);

          const added = currentIds.filter(id => !oldAll.has(id));
          const removed = stored.allIds.filter(id => !currentSet.has(id));

          if (added.length > 0 || removed.length > 0) {
            logEntityWarning(entity, "Cache updated (incremental)", {
              added: added.length,
              removed: removed.length
            });

            // Remove deleted items from remaining
            stored.remaining = stored.remaining.filter(id => currentSet.has(id));
            
            // Add new items and shuffle them in
            if (added.length > 0) {
              const shuffledAdded = shuffleArray([...added]);
              stored.remaining.push(...shuffledAdded);
              logEntityAction(entity, "Added new items to remaining", { 
                count: added.length 
              });
            }
            
            stored.allIds = currentIds;
            stored.version = CONFIG.CACHE_VERSION;
            stored.entity = entity;
            stored.filter = internalFilter ? JSON.stringify(internalFilter) : 'global';
            setCachedData(cacheDataKey, stored);
          }
          
          logEntityAction(entity, "Cache status", {
            totalItems: stored.allIds.length,
            remainingItems: stored.remaining.length
          });
        }
      }
      
      if (stored.remaining.length === 0) {
        logEntityWarning(entity, "Cache exhausted — reshuffling");
        stored.remaining = shuffleArray([...stored.allIds]);
        setCachedData(cacheDataKey, stored);
        logEntitySuccess(entity, "Cache reshuffled", { 
          newItemCount: stored.remaining.length 
        });
      }

      if (stored.remaining.length > 0) {
        const nextId = stored.remaining.pop();
        setCachedData(cacheDataKey, stored);

        logEntitySuccess(entity, "Redirecting", {
          nextId,
          remaining: stored.remaining.length
        });

        window.location.href = `${redirectPrefix}${nextId}`;
      } else {
        logEntityError(entity, "No items available to select");
        alert("No items available to select.");
      }
    } catch (error) {
      logEntityError(entity, "Cache-based selection failed", error);
      if (error.message === 'REQUEST_TIMEOUT') {
        alert("Request timed out. Please try again.");
      } else {
        alert("Selection failed: " + error.message);
      }
    }
  }

  /* ==========================
     UTILITY FUNCTIONS
  ========================== */

  async function getTotalCount(entity, internalFilter) {
    const realEntityPlural = getPlural(entity);
    
    let countFilterArg = "";
    let countFilterVar = "";
    let countVariables = {};
    
    if (internalFilter) {
      countFilterArg = `, $internal_filter: ${entity}FilterType`;
      countFilterVar = `, ${entity.toLowerCase()}_filter: $internal_filter`;
      countVariables.internal_filter = internalFilter;
    }

    const countQuery = `
      query Count${realEntityPlural}($filter: FindFilterType${countFilterArg}) {
        find${realEntityPlural}(filter: $filter${countFilterVar}) {
          count
        }
      }
    `;

    try {
      logEntityAction(entity, "Fetching total count");
      
      const response = await fetchWithTimeout('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          query: countQuery, 
          variables: { filter: {}, ...countVariables } 
        })
      });
      
      const data = await response.json();
      
      if (data.errors) {
        logEntityError(entity, "Count query errors", data.errors);
        return null;
      }
      
      const count = data.data[`find${realEntityPlural}`].count;
      logEntitySuccess(entity, "Total count retrieved", { count });
      return count;
    } catch (error) {
      logEntityError(entity, "Failed to get count", error);
      throw error;
    }
  }

  function getCachedData(key) {
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        logEntityAction("System", "Cached data retrieved", { key, dataSize: stored.length });
        return parsed;
      }
      return null;
    } catch (e) {
      logEntityWarning("System", "Failed to parse cached data", { key, error: e.message });
      return null;
    }
  }

  // Efficient localStorage management
  function setCachedData(key, data) {
    try {
      // Limit data size on mobile
      if (isMobile) {
        const maxSize = 1024 * 1024; // 1MB limit
        const dataString = JSON.stringify(data);
        if (dataString.length > maxSize) {
          // Trim data to fit within limits
          data.remaining = data.remaining.slice(0, Math.floor(data.remaining.length * 0.7));
        }
      }
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      // Clear cache on quota exceeded
      if (e.name === 'QuotaExceededError') {
        localStorage.clear();
      }
    }
  }
  
  /* ==========================
     BUTTON HANDLER
  ========================== */

  async function randomButtonHandler() {
    const pathname = window.location.pathname.replace(/\/$/, ''); // Remove trailing slash
    const searchParams = new URLSearchParams(window.location.search);
    logEntityAction("System", "Button clicked", { pathname, searchParams: window.location.search });

    // Handle main galleries list page (with or without filters)
    if (pathname === '/galleries') {
      logEntityAction("Gallery", "Handling galleries page");
      const filterParam = searchParams.get('c');
      if (filterParam) {
        try {
          const internalFilter = convertUrlFilterToInternalFilter(filterParam);
          logEntityAction("Gallery", "Using filter for galleries", { filterParam });
          return randomGlobal('Gallery', 'galleries', '/galleries/', internalFilter);
        } catch (e) {
          logEntityError("Gallery", "Failed to convert filters", e);
          return randomGlobal('Gallery', 'galleries', '/galleries/');
        }
      }
      return randomGlobal('Gallery', 'galleries', '/galleries/');
    }

    // Handle specific gallery page - should roll to another gallery
    let galleryId = getIdFromPath(/^\/galleries\/(\d+)/);
    if (galleryId) {
      logEntityAction("Gallery", "Handling specific gallery page", { galleryId });
      const filterParam = searchParams.get('c');
      if (filterParam) {
        try {
          const internalFilter = convertUrlFilterToInternalFilter(filterParam);
          return randomGlobal('Gallery', 'galleries', '/galleries/', internalFilter);
        } catch (e) {
          logEntityError("Gallery", "Failed to convert filters", e);
          return randomGlobal('Gallery', 'galleries', '/galleries/');
        }
      }
      return randomGlobal('Gallery', 'galleries', '/galleries/');
    }

    // Handle specific performer page - should roll to another performer
    let performerPageId = getIdFromPath(/^\/performers\/(\d+)/);
    if (performerPageId) {
      logEntityAction("Performer", "Handling specific performer page", { performerPageId });
      // Always roll to another performer, never content from this performer
      return randomGlobal('Performer', 'performers', '/performers/');
    }

    // Handle specific studio page - should roll to another studio
    // This regex matches /studios/{id} even if there are more path segments
    let studioMatch = pathname.match(/^\/studios\/(\d+)/);
    if (studioMatch) {
      let studioId = studioMatch[1];
      logEntityAction("Studio", "Handling specific studio page", { studioId });
      return randomGlobal('Studio', 'studios', '/studios/');
    }

    // Handle specific tag page - should roll to another tag
    // This regex matches /tags/{id} even if there are more path segments
    let tagMatch = pathname.match(/^\/tags\/(\d+)/);
    if (tagMatch) {
      let tagId = tagMatch[1];
      logEntityAction("Tag", "Handling specific tag page", { tagId });
      return randomGlobal('Tag', 'tags', '/tags/');
    }

    // Rest of your existing conditions...
    if (pathname === '/scenes' || pathname === '/' || pathname === '' ||
        pathname === '/stats' || pathname === '/settings' ||
        pathname === '/scenes/markers' || /^\/scenes\/\d+$/.test(pathname)) {
      logEntityAction("Scene", "Handling scenes page");
      return randomGlobal('Scene', 'scenes', '/scenes/');
    }

    if (pathname === '/images' || /^\/images\/\d+$/.test(pathname)) {
      logEntityAction("Image", "Handling images page");
      return randomGlobal('Image', 'images', '/images/');
    }

    if (pathname === '/performers') {
      logEntityAction("Performer", "Handling performers page");
      return randomGlobal('Performer', 'performers', '/performers/');
    }

    if (pathname === '/studios') {
      logEntityAction("Studio", "Handling studios page");
      return randomGlobal('Studio', 'studios', '/studios/');
    }

    if (pathname === '/tags') {
      logEntityAction("Tag", "Handling tags page");
      return randomGlobal('Tag', 'tags', '/tags/');
    }

    if (pathname === '/groups') {
      logEntityAction("Group", "Handling groups page");
      return randomGlobal('Group', 'groups', '/groups/');
    }

    // Handle images within a specific gallery (from gallery image view)
    let galleryImageId = getIdFromPath(/^\/galleries\/(\d+)\/images/);
    if (galleryImageId) {
      logEntityAction("Image", "Handling gallery images", { galleryImageId });
      return randomGlobal('Image', 'images', '/images/', {
        galleries: { value: [galleryImageId], modifier: "INCLUDES_ALL" }
      });
    }

    let studioSceneId = getIdFromPath(/^\/studios\/(\d+)\/scenes/);
    if (studioSceneId) {
      logEntityAction("Scene", "Handling studio scenes", { studioSceneId });
      return randomGlobal('Scene', 'scenes', '/scenes/', {
        studios: { value: [studioSceneId], modifier: "INCLUDES_ALL" }
      });
    }

    let groupId = getIdFromPath(/^\/groups\/(\d+)\/scenes/);
    if (groupId) {
      logEntityAction("Scene", "Handling group scenes", { groupId });
      return randomGlobal('Scene', 'scenes', '/scenes/', {
        groups: { value: [groupId], modifier: "INCLUDES_ALL" }
      });
    }

    let tagSceneId = getIdFromPath(/^\/tags\/(\d+)\/scenes/);
    if (tagSceneId) {
      logEntityAction("Scene", "Handling tag scenes", { tagSceneId });
      return randomGlobal('Scene', 'scenes', '/scenes/', {
        tags: { value: [tagSceneId], modifier: "INCLUDES_ALL" }
      });
    }

    logEntityError("System", "Unsupported path", { pathname });
    alert('Not supported');
  }

  // Convert URL filter format to internal GraphQL filter format
  function convertUrlFilterToInternalFilter(filterParam) {
    try {
      logEntityAction("System", "Converting URL filter", { filterParam });
      const decoded = decodeURIComponent(filterParam);
      
      const excludedMatch = decoded.match(/"excluded":$$$(.*?)$$$/);
      if (excludedMatch && excludedMatch[1]) {
        const tagIds = [];
        const excludedStr = excludedMatch[1];
        const tagMatches = excludedStr.match(/"id":"([^"]+)"/g);
        if (tagMatches) {
          tagMatches.forEach(match => {
            const idMatch = match.match(/"id":"([^"]+)"/);
            if (idMatch && idMatch[1]) {
              tagIds.push(idMatch[1]);
            }
          });
        }
        
        if (tagIds.length > 0) {
          const result = {
            tags: {
              value: tagIds,
              modifier: "EXCLUDE"
            }
          };
          logEntitySuccess("System", "Converted filter with exclusions", { result });
          return result;
        }
      }
      
      const result = {};
      logEntityAction("System", "Converted filter (no exclusions)", { result });
      return result;
    } catch (e) {
      logEntityError("System", "Failed to convert filter", { filterParam, error: e.message });
      return {};
    }
  }

  /* ==========================
     BUTTON INJECTION
  ========================== */

  function addRandomButton() {
    if (document.querySelector('.random-btn')) {
      logEntityAction("System", "Random button already exists");
      return;
    }

    const navContainer = document.querySelector('.navbar-buttons.flex-row.ml-auto.order-xl-2.navbar-nav');
    if (!navContainer) {
      logEntityWarning("System", "Navigation container not found");
      return;
    }

    const container = document.createElement('div');
    container.className = 'mr-2';
    
    // Responsive button design
    container.innerHTML = `
      <a href="javascript:void(0)">
        <button type="button" class="btn btn-primary random-btn d-flex align-items-center">
          <span class="d-none d-md-inline">🎲Roll</span>
          <span class="d-inline d-md-none">🎲Roll</span>
        </button>
      </a>
    `;

    const button = container.querySelector('button');
    button.addEventListener('click', async function(e) {
      logEntityAction("System", "Random button clicked");
      
      const originalText = button.innerHTML;
      const originalClasses = button.className;
      
      // Visual feedback states
      button.innerHTML = '<span class="d-none d-md-inline">🎲Rolling...</span><span class="d-inline d-md-none">🎲Rolling...</span>';
      button.className = 'btn btn-warning random-btn d-flex align-items-center'; // Change to yellow
      button.disabled = true; // Prevent multiple clicks
      
      try {
        // Call the main handler with timeout retry
        await retryWithTimeout(() => randomButtonHandler.call(this, e));
        
        // Keep the visual feedback for a moment so user sees it
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        // Restore button on error
        button.innerHTML = originalText;
        button.className = originalClasses;
        button.disabled = false;
        
        // Handle timeout specifically
        if (error.message === 'REQUEST_TIMEOUT') {
          logEntityError("System", "Request timed out after all retries");
          alert('Request timed out. Please try again.');
        } else {
          logEntityError("System", "Button handler error", error);
        }
      }
    });

    navContainer.appendChild(container);
    logEntitySuccess("System", "Random button added");
  }

  const observer = new MutationObserver(() => {
    if (document.querySelector('.navbar-buttons.flex-row.ml-auto.order-xl-2.navbar-nav')) {
      addRandomButton();
      observer.disconnect();
      logEntityAction("System", "Observer disconnected");
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('click', () => {
    logEntityAction("System", "Document click detected");
    setTimeout(addRandomButton, 1200);
  });
  
  window.addEventListener('popstate', () => {
    logEntityAction("System", "Popstate detected");
    setTimeout(addRandomButton, 1200);
  });
  
  window.addEventListener('hashchange', () => {
    logEntityAction("System", "Hashchange detected");
    setTimeout(addRandomButton, 1200);
  });
  
})();
