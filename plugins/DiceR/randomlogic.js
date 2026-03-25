(function() {
  'use strict';

  /* ==========================
     ADVANCED DEBUG LOGGER
  ========================== */

  const DEBUG = true;
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
     HELPERS
  ========================== */

  function getIdFromPath(regex) {
    const m = window.location.pathname.match(regex);
    DiceRLogger.log("info", "getIdFromPath", { regex: regex.toString(), result: m ? m[1] : null });
    return m ? m[1] : null;
  }

  function getPlural(entity) {
    const plural =
      (entity === "Gallery") ? "Galleries" :
      (entity === "Tag") ? "Tags" :
      (entity === "Image") ? "Images" :
      (entity === "Scene") ? "Scenes" :
      (entity === "Performer") ? "Performers" :
      (entity === "Studio") ? "Studios" :
      (entity === "Group") ? "Groups" :
      entity + "s";

    return plural;
  }

  function getCacheKey(entity, internalFilter) {
    return internalFilter
      ? `randomData_${entity}_${JSON.stringify(internalFilter)}`
      : `randomData_${entity}_global`;
  }

  function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
  }

  /* ==========================
     HYBRID RANDOM SYSTEM
  ========================== */

  async function randomGlobal(entity, idField, redirectPrefix, internalFilter) {
    rollCount++;
    DiceRLogger.log("event", `🎲 Roll #${rollCount}`, { entity, internalFilter });

    const cacheKey = getCacheKey(entity, internalFilter);
	const shouldUseSampling = (entity === "Image" || entity === "Scene" || entity === "Gallery") && !internalFilter;

    if (shouldUseSampling) {
      return await randomWithSamplingAndTracking(entity, idField, redirectPrefix, internalFilter, cacheKey);
    }

    return await randomWithFullCache(entity, idField, redirectPrefix, internalFilter, cacheKey);
  }

  // NEW: Hybrid approach for large collections with seen/unseen tracking
  async function randomWithSamplingAndTracking(entity, idField, redirectPrefix, internalFilter, cacheKey) {
    const realEntityPlural = getPlural(entity);
    
    // Load cache for seen tracking
    let stored = JSON.parse(localStorage.getItem(cacheKey) || "null");
    
    // Initialize cache structure if needed
    if (!stored) {
      stored = {
        seenIds: new Set(),           // Track what we've seen
        unseenCount: null,            // Total count from last check
        lastChecked: 0,               // Timestamp of last count check
        sampledPages: new Map()       // Track sampled pages to avoid immediate repeats
      };
    } else {
      // Convert array to Set for better performance
      stored.seenIds = new Set(stored.seenIds || []);
    }

    // Refresh total count periodically (every 5 minutes)
    const now = Date.now();
    const shouldRefreshCount = !stored.unseenCount || (now - stored.lastChecked) > 300000;
    
    if (shouldRefreshCount) {
      DiceRLogger.log("info", "Refreshing total count");
      
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
        let countResp = await fetch('/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            query: countQuery, 
            variables: { filter: {}, ...countVariables } 
          })
        });
        let countData = await countResp.json();

        if (!countData.errors) {
          stored.unseenCount = countData.data[`find${realEntityPlural}`].count;
          stored.lastChecked = now;
          DiceRLogger.log("info", "Updated total count", { count: stored.unseenCount });
        }
      } catch (error) {
        DiceRLogger.log("error", "Failed to get count", error);
      }
    }

    // Try to find an item that hasn't been seen
    let attempts = 0;
    const maxAttempts = 10;
    let selectedItem = null;
    let selectedId = null;

    while (attempts < maxAttempts && !selectedItem) {
      attempts++;
      
      // Get random item using sampling
      const itemResult = await getRandomItemBySampling(entity, idField, internalFilter);
      
      if (itemResult && itemResult.item && itemResult.id) {
        // Check if we've seen this item before
        if (!stored.seenIds.has(itemResult.id)) {
          selectedItem = itemResult.item;
          selectedId = itemResult.id;
          break;
        } else {
          DiceRLogger.log("info", "Skipping already seen item", { attempts });
        }
      }
    }

    // If we couldn't find an unseen item, either reshuffle or pick one anyway
    if (!selectedItem) {
      DiceRLogger.log("warn", "All items may have been seen, allowing repeats");
      
      // Clear seen tracking to allow repeats (or keep going with repeats)
      const sampleResult = await getRandomItemBySampling(entity, idField, internalFilter);
      if (sampleResult && sampleResult.item) {
        selectedItem = sampleResult.item;
        selectedId = sampleResult.id;
      }
      
      // Optional: Reset seen tracking periodically
      if (stored.seenIds.size > (stored.unseenCount || 10000) * 0.9) {
        DiceRLogger.log("warn", "Resetting seen tracking - most items seen");
        stored.seenIds.clear();
      }
    }

    if (selectedItem && selectedId) {
      // Mark as seen
      stored.seenIds.add(selectedId);
      
      // Save updated cache
      const cacheToSave = {
        seenIds: Array.from(stored.seenIds),
        unseenCount: stored.unseenCount,
        lastChecked: stored.lastChecked,
        sampledPages: {} // Don't persist page tracking to save space
      };
      localStorage.setItem(cacheKey, JSON.stringify(cacheToSave));

	  // EXPLICIT CONSOLE LOG to ensure visibility
	  console.log(`🎯 DiceR: Selected ${entity} ID ${selectedId} (${stored.seenIds.size}/${stored.unseenCount} seen)`);


      DiceRLogger.log("success", "Selected random item", {
        itemId: selectedId,
        seenCount: stored.seenIds.size,
        totalEstimated: stored.unseenCount
      });

      window.location.href = `${redirectPrefix}${selectedId}`;
    } else {
      DiceRLogger.log("error", "Failed to select item after max attempts");
      alert("Unable to select random item.");
    }
  }

  // Helper function to get random item via sampling
async function getRandomItemBySampling(entity, idField, internalFilter) {
  const realEntityPlural = getPlural(entity);
  
  // First get total count
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
    let countResp = await fetch('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        query: countQuery, 
        variables: { filter: {}, ...countVariables } 
      })
    });
    let countData = await countResp.json();

    if (countData.errors) {
      return null;
    }

    const totalCount = countData.data[`find${realEntityPlural}`].count;
    
    if (totalCount === 0) {
      return null;
    }

    // Generate random page and offset
    const pageSize = 1000;
    const totalPages = Math.ceil(totalCount / pageSize);
    const randomPage = Math.floor(Math.random() * totalPages);
    const itemsInLastPage = totalCount % pageSize || pageSize;
    const maxOffset = (randomPage === totalPages - 1) ? itemsInLastPage : pageSize;
    const randomOffsetInPage = Math.floor(Math.random() * maxOffset);

    // *** KEY FIX: Add random sort to prevent chronological ordering ***
    const sortOptions = ['created_at', 'updated_at', 'name', 'path', 'date']; // Add relevant sort fields
    const randomSort = sortOptions[Math.floor(Math.random() * sortOptions.length)];
    const sortDirection = Math.random() > 0.5 ? 'ASC' : 'DESC';

    // Fetch the specific page
    let filterArg = "";
    let filterVar = "";
    let variables = {
      filter: { 
        per_page: pageSize,
        page: randomPage + 1,
        sort: randomSort,
        direction: sortDirection
      }
    };

    if (internalFilter) {
      filterArg = `, $internal_filter: ${entity}FilterType`;
      filterVar = `, ${entity.toLowerCase()}_filter: $internal_filter`;
      variables.internal_filter = internalFilter;
    }

    const pageQuery = `
      query Find${realEntityPlural}($filter: FindFilterType${filterArg}) {
        find${realEntityPlural}(filter: $filter${filterVar}) {
          ${idField} { id }
        }
      }
    `;

    let pageResp = await fetch('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: pageQuery, variables })
    });
    let pageData = await pageResp.json();

    if (pageData.errors) {
      return null;
    }

    let items = pageData.data[`find${realEntityPlural}`][idField];

    if (!items || items.length === 0) {
      return null;
    }

    // Select random item from the page
    const randomIndex = randomOffsetInPage < items.length ? randomOffsetInPage : Math.floor(Math.random() * items.length);
    const selectedItem = items[randomIndex];

    return {
      item: selectedItem,
      id: selectedItem.id
    };
  } catch (error) {
    DiceRLogger.log("error", "Sampling failed", error);
    return null;
  }
}

  // Existing cache-based approach for smaller collections
  async function randomWithFullCache(entity, idField, redirectPrefix, internalFilter, cacheKey) {
    const realEntityPlural = getPlural(entity);

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

    DiceRLogger.log("info", "Running GraphQL query", { entity });
    DiceRLogger.time("GraphQL Request");

    let resp = await fetch('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    });

    let data = await resp.json();
    DiceRLogger.timeEnd("GraphQL Request");

    if (data.errors) {
      DiceRLogger.log("error", "GraphQL errors", data.errors);
      alert("Error: " + JSON.stringify(data.errors));
      return;
    }

    let items = data.data[`find${realEntityPlural}`][idField];

    if (!items || items.length === 0) {
      DiceRLogger.log("warn", "No results found");
      alert("No results found.");
      return;
    }

    const currentIds = items.map(i => i.id);
    DiceRLogger.log("success", "Fetched IDs", { count: currentIds.length });

    let stored = JSON.parse(localStorage.getItem(cacheKey) || "null");

    if (!stored) {
      DiceRLogger.log("warn", "Cache created (first run)");
      stored = {
        allIds: currentIds,
        remaining: shuffleArray([...currentIds])
      };
    } else {
      const oldAll = new Set(stored.allIds);
      const currentSet = new Set(currentIds);

      const added = currentIds.filter(id => !oldAll.has(id));
      const removed = stored.allIds.filter(id => !currentSet.has(id));

      if (added.length > 0 || removed.length > 0) {
        DiceRLogger.log("warn", "Cache updated (incremental)", {
          added: added.length,
          removed: removed.length
        });

        stored.remaining = stored.remaining.filter(id => currentSet.has(id));
        const shuffledAdded = shuffleArray([...added]);
        stored.remaining.push(...shuffledAdded);
        stored.allIds = currentIds;
      }
    }
    
    if (stored.remaining.length === 0) {
      DiceRLogger.log("warn", "Cache exhausted — reshuffling");
      stored.remaining = shuffleArray([...stored.allIds]);
    }

    if (stored.remaining.length > 0) {
      const nextId = stored.remaining.pop();
      localStorage.setItem(cacheKey, JSON.stringify(stored));

      DiceRLogger.log("success", "Redirecting", {
        nextId,
        remaining: stored.remaining.length
      });

      window.location.href = `${redirectPrefix}${nextId}`;
    } else {
      DiceRLogger.log("error", "No items available to select");
      alert("No items available to select.");
    }
  }

  /* ==========================
     BUTTON HANDLER
  ========================== */

async function randomButtonHandler() {
  const pathname = window.location.pathname.replace(/\/$/, '');
  const searchParams = new URLSearchParams(window.location.search);
  DiceRLogger.log("event", "Button clicked", { pathname, searchParams: window.location.search });

  // Handle main galleries list page (with or without filters)
  if (pathname === '/galleries') {
    // Preserve all current filters by including them in the redirect
    const currentUrl = new URL(window.location.href);
    const search = currentUrl.search;
    
    // For filtered galleries, we need to apply the same filters to the random selection
    const filterParam = searchParams.get('c');
    if (filterParam) {
      try {
        const internalFilter = convertUrlFilterToInternalFilter(filterParam);
        return randomGlobal('Gallery', 'galleries', '/galleries/', internalFilter);
      } catch (e) {
        DiceRLogger.log("error", "Failed to convert filters", e);
        return randomGlobal('Gallery', 'galleries', '/galleries/');
      }
    }
    return randomGlobal('Gallery', 'galleries', '/galleries/');
  }

  // Handle specific gallery page - should roll to another gallery
  let galleryId = getIdFromPath(/^\/galleries\/(\d+)/);
  if (galleryId) {
    // If we're on a specific gallery page, roll to another gallery (preserve any filters if possible)
    const filterParam = searchParams.get('c');
    if (filterParam) {
      try {
        const internalFilter = convertUrlFilterToInternalFilter(filterParam);
        return randomGlobal('Gallery', 'galleries', '/galleries/', internalFilter);
      } catch (e) {
        DiceRLogger.log("error", "Failed to convert filters", e);
        return randomGlobal('Gallery', 'galleries', '/galleries/');
      }
    }
    return randomGlobal('Gallery', 'galleries', '/galleries/');
  }

  // Rest of your existing conditions...
  if (pathname === '/scenes' || pathname === '/' || pathname === '' ||
      pathname === '/stats' || pathname === '/settings' ||
      pathname === '/scenes/markers' || /^\/scenes\/\d+$/.test(pathname))
    return randomGlobal('Scene', 'scenes', '/scenes/');

  if (pathname === '/images' || /^\/images\/\d+$/.test(pathname))
    return randomGlobal('Image', 'images', '/images/');

  if (pathname === '/performers')
    return randomGlobal('Performer', 'performers', '/performers/');

  if (pathname === '/studios')
    return randomGlobal('Studio', 'studios', '/studios/');

  if (pathname === '/tags')
    return randomGlobal('Tag', 'tags', '/tags/');

  if (pathname === '/groups')
    return randomGlobal('Group', 'groups', '/groups/');

  // Handle images within a specific gallery (from gallery image view)
  let galleryImageId = getIdFromPath(/^\/galleries\/(\d+)\/images/);
  if (galleryImageId)
    return randomGlobal('Image', 'images', '/images/', {
      galleries: { value: [galleryImageId], modifier: "INCLUDES_ALL" }
    });

  let studioId = getIdFromPath(/^\/studios\/(\d+)\/scenes/);
  if (studioId)
    return randomGlobal('Scene', 'scenes', '/scenes/', {
      studios: { value: [studioId], modifier: "INCLUDES_ALL" }
    });

  let groupId = getIdFromPath(/^\/groups\/(\d+)\/scenes/);
  if (groupId)
    return randomGlobal('Scene', 'scenes', '/scenes/', {
      groups: { value: [groupId], modifier: "INCLUDES_ALL" }
    });

  let performerId = getIdFromPath(/^\/performers\/(\d+)\/scenes/);
  if (performerId)
    return randomGlobal('Scene', 'scenes', '/scenes/', {
      performers: { value: [performerId], modifier: "INCLUDES_ALL" }
    });

  let tagId = getIdFromPath(/^\/tags\/(\d+)\/scenes/);
  if (tagId)
    return randomGlobal('Scene', 'scenes', '/scenes/', {
      tags: { value: [tagId], modifier: "INCLUDES_ALL" }
    });

  DiceRLogger.log("error", "Unsupported path", { pathname });
  alert('Not supported');
}

// Convert URL filter format to internal GraphQL filter format
function convertUrlFilterToInternalFilter(filterParam) {
  try {
    // Custom parser for the specific format used
    // c=("type":"tags","modifier":"INCLUDES_ALL","value":("items":[],"excluded":[("id":"300","label":"Doujinshi")],"depth":-1))
    const decoded = decodeURIComponent(filterParam);
    
    // Extract excluded tags if present
    const excludedMatch = decoded.match(/"excluded":$$$(.*?)$$$/);
    if (excludedMatch && excludedMatch[1]) {
      // Extract tag IDs from the excluded array
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
        return {
          tags: {
            value: tagIds,
            modifier: "EXCLUDE"
          }
        };
      }
    }
    
    DiceRLogger.log("info", "Converted filter", { original: filterParam, converted: {} });
    return {};
  } catch (e) {
    DiceRLogger.log("error", "Failed to convert filter", { filterParam, error: e.message });
    return {};
  }
}


/* ==========================
   BUTTON INJECTION
========================== */

function addRandomButton() {
  if (document.querySelector('.random-btn')) return;

  const navContainer = document.querySelector('.navbar-buttons.flex-row.ml-auto.order-xl-2.navbar-nav');
  if (!navContainer) return;

  const container = document.createElement('div');
  container.className = 'mr-2';
  container.innerHTML = `
    <a href="javascript:void(0)">
      <button type="button" class="btn btn-primary random-btn">🎲Roll</button>
    </a>
  `;

  const button = container.querySelector('button');
  button.addEventListener('click', async function(e) {
    // Add visual feedback immediately
    const originalText = button.textContent;
    const originalClasses = button.className;
    
    // Visual feedback states
    button.textContent = '🎲Rolling...';
    button.className = 'btn btn-warning random-btn'; // Change to yellow
    button.disabled = true; // Prevent multiple clicks
    
    try {
      // Call the main handler
      await randomButtonHandler.call(this, e);
      
      // Keep the visual feedback for a moment so user sees it
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      // Restore button on error
      button.textContent = originalText;
      button.className = originalClasses;
      button.disabled = false;
      DiceRLogger.log("error", "Button handler error", error);
    }
  });

  navContainer.appendChild(container);
  DiceRLogger.log("success", "Random button added");
}

const observer = new MutationObserver(() => {
  if (document.querySelector('.navbar-buttons.flex-row.ml-auto.order-xl-2.navbar-nav')) {
    addRandomButton();
    observer.disconnect();
    DiceRLogger.log("event", "Observer disconnected");
  }
});

observer.observe(document.body, { childList: true, subtree: true });

document.addEventListener('click', () => setTimeout(addRandomButton, 1200));
window.addEventListener('popstate', () => setTimeout(addRandomButton, 1200));
window.addEventListener('hashchange', () => setTimeout(addRandomButton, 1200));

})();
