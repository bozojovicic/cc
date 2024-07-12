import { getLibs } from '../../scripts/utils.js';

const miloLibs = getLibs('/libs');
const { loadStyle } = await import(`${miloLibs}/utils/utils.js`);

// Helps with TBT: MWPW-145127
loadStyle(`${miloLibs}/blocks/global-navigation/features/profile/dropdown.css`);

function handleCustomAnalyticsEvent(eventName, element) {
  let daaLhValue = '';
  let daaLhElement = element.closest('[daa-lh]');
  while (daaLhElement) {
    if (daaLhValue) {
      daaLhValue = `|${daaLhValue}`;
    }
    const daaLhAttrValue = daaLhElement.getAttribute('daa-lh');
    daaLhValue = `${daaLhAttrValue}${daaLhValue}`;
    daaLhElement = daaLhElement.parentElement.closest('[daa-lh]');
  }
  // eslint-disable-next-line no-underscore-dangle
  window._satellite?.track('event', {
    xdm: {},
    data: { web: { webInteraction: { name: `${eventName}|${daaLhValue}` } } },
  });
}

/** container block */
export default async function init(el) {
  el.classList.add('app');
  const libs = getLibs();
  const sidenavEl = el.querySelector('.sidenav');
  const merchCardsEl = el.querySelector('.merch-card-collection');
  el.innerHTML = '';
  let merchCards;
  if (merchCardsEl) {
    el.appendChild(merchCardsEl);
    merchCardsEl.classList.add('four-merch-cards');
    const { default: initMerchCards } = await import(`${libs}/blocks/merch-card-collection/merch-card-collection.js`);
    merchCards = await initMerchCards(merchCardsEl);
  }
  if (sidenavEl) {
    (merchCards?.updateComplete ?? Promise.resolve()).then(async () => {
      const { default: initSidenav } = await import('../sidenav/sidenav.js');
      const sidenav = await initSidenav(sidenavEl);
      el.appendChild(sidenav);
      sidenav.setAttribute('daa-lh', 'b1|sidenav');
      await sidenav.updateComplete;
      if (merchCards) {
        merchCards.addEventListener('sort-changed', ({ detail }) => {
          handleCustomAnalyticsEvent(`${detail.value}--sort`, merchCards);
        });
        sidenav.search.addEventListener('search-changed', ({ detail }) => {
          handleCustomAnalyticsEvent(`${detail.value}--search`, sidenav.search);
        });

        sidenav.filters.addEventListener('click', ({ target }) => {
          merchCards.setAttribute('daa-lh', target.getAttribute('daa-ll'));
        });
        merchCards.sidenav = sidenav;
        merchCards.querySelectorAll('merch-card').forEach((card) => {
          card.setAttribute('daa-lh', `card-${card.name}`);
        });
        merchCards.requestUpdate();
      }
    });
  }
  return el;
}
