(function() {
  'use strict';

  function getIdFromPath(regex) {
    let m = window.location.pathname.match(regex);
    return m ? m[1] : null;
  }

  function getPlural(entity) {
    return (entity === "Gallery") ? "Galleries"
      : (entity === "Tag") ? "Tags"
      : (entity === "Image") ? "Images"
      : (entity === "Scene") ? "Scenes"
      : (entity === "Performer") ? "Performers"
      : (entity === "Studio") ? "Studios"
      : (entity === "Group") ? "Groups"
      : entity + "s";
  }

  function getCacheKey(entity, internalFilter) {
    return internalFilter
      ? `randomData_${entity}_${JSON.stringify(internalFilter)}`
      : `randomData_${entity}_global`;
  }

  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function arraysEqual(a, b) {
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    const setA = new Set(a);
    for (let id of b) {
      if (!setA.has(id)) return false;
    }
    return true;
  }

  async function randomGlobal(entity, idField, redirectPrefix, internalFilter) {
    const realEntityPlural = getPlural(entity);
    const cacheKey = getCacheKey(entity, internalFilter);

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

    let resp = await fetch('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    });

    let data = await resp.json();
    if (data.errors) {
      alert("Error: " + JSON.stringify(data.errors));
      return;
    }

    let items = data.data[`find${realEntityPlural}`][idField];
    if (!items || items.length === 0) {
      alert("No results found.");
      return;
    }

    const currentIds = items.map(i => i.id);

    let stored = JSON.parse(localStorage.getItem(cacheKey) || "null");

    // If no cache OR library changed → rebuild
    if (!stored || !arraysEqual(stored.allIds, currentIds)) {
      const shuffled = shuffleArray([...currentIds]);
      stored = {
        allIds: currentIds,
        remaining: shuffled
      };
    }

    // If exhausted → reshuffle
    if (stored.remaining.length === 0) {
      stored.remaining = shuffleArray([...stored.allIds]);
    }

    const nextId = stored.remaining.pop();

    localStorage.setItem(cacheKey, JSON.stringify(stored));

    window.location.href = `${redirectPrefix}${nextId}`;
  }

  async function randomButtonHandler() {
    const pathname = window.location.pathname.replace(/\/$/, '');

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

    if (pathname === '/galleries')
      return randomGlobal('Gallery', 'galleries', '/galleries/');

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

    let galleryId = getIdFromPath(/^\/galleries\/(\d+)$/);
    if (galleryId)
      return randomGlobal('Image', 'images', '/images/', {
        galleries: { value: [galleryId], modifier: "INCLUDES_ALL" }
      });

    alert('Not supported');
  }

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

    container.querySelector('button')
      .addEventListener('click', randomButtonHandler);

    navContainer.appendChild(container);
  }

const observer = new MutationObserver(() => {
  if (document.querySelector('.navbar-buttons.flex-row.ml-auto.order-xl-2.navbar-nav')) {
    addRandomButton();
    observer.disconnect(); // stop observing once added
  }
});

observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('click', () => setTimeout(addRandomButton, 1200));
  window.addEventListener('popstate', () => setTimeout(addRandomButton, 1200));
  window.addEventListener('hashchange', () => setTimeout(addRandomButton, 1200));

})();
