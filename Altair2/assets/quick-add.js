import { morph } from '@theme/morph';
import { Component } from '@theme/component';
import { CartUpdateEvent, ThemeEvents } from '@theme/events';
import { DialogComponent, DialogCloseEvent } from '@theme/dialog';
import { mediaQueryLarge, isMobileBreakpoint, getIOSVersion } from '@theme/utilities';

export class QuickAddComponent extends Component {
  /** @type {AbortController | null} */
  #abortController = null;
  /** @type {Map<string, Element>} */
  #cachedContent = new Map();

  get productPageUrl() {
    const productCard = /** @type {import('./product-card').ProductCard | null} */ (this.closest('product-card'));
    const productLink = productCard?.getProductCardLink();

    if (!productLink?.href) return '';

    const url = new URL(productLink.href);

    if (url.searchParams.has('variant')) {
      return url.toString();
    }

    const selectedVariantId = this.#getSelectedVariantId();
    if (selectedVariantId) {
      url.searchParams.set('variant', selectedVariantId);
    }

    return url.toString();
  }

  /**
   * Gets the currently selected variant ID from the product card
   * @returns {string | null} The variant ID or null
   */
  #getSelectedVariantId() {
    const productCard = /** @type {import('./product-card').ProductCard | null} */ (this.closest('product-card'));
    return productCard?.getSelectedVariantId() || null;
  }

  connectedCallback() {
    super.connectedCallback();

    mediaQueryLarge.addEventListener('change', this.#closeQuickAddModal);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    mediaQueryLarge.removeEventListener('change', this.#closeQuickAddModal);
    this.#abortController?.abort();
  }

  /**
   * Handles quick add button click
   * @param {Event} event - The click event
   */
  handleClick = async (event) => {
    event.preventDefault();

    const chooseButton = /** @type {HTMLButtonElement | null} */ (this.querySelector('.quick-add__button--choose'));

    this.toggleAttribute('loading', true);
    chooseButton?.setAttribute('aria-busy', 'true');
    chooseButton?.setAttribute('disabled', '');

    let shouldOpenModal = false;
    /** @type {QuickAddDialog | null} */
    let dialogComponent = null;

    try {
      const currentUrl = this.productPageUrl;

      // Check if we have cached content for this URL
      let productGrid = this.#cachedContent.get(currentUrl);

      if (!productGrid) {
        // Fetch and cache the content
        const html = await this.fetchProductPage(currentUrl);
        if (html) {
          const gridElement = html.querySelector('[data-product-grid-content]');
          if (gridElement) {
            // Cache the cloned element to avoid modifying the original
            productGrid = /** @type {Element} */ (gridElement.cloneNode(true));
            this.#cachedContent.set(currentUrl, productGrid);
          }
        }
      }

      if (productGrid) {
        // Use a fresh clone from the cache
        const freshContent = /** @type {Element} */ (productGrid.cloneNode(true));
        await this.updateQuickAddModal(freshContent);
        shouldOpenModal = true;
      }
    } catch (error) {
      console.error('QuickAddComponent failed to load product content', error);
    } finally {
      this.removeAttribute('loading');
      chooseButton?.removeAttribute('aria-busy');
      chooseButton?.removeAttribute('disabled');

      const productCardContent = this.closest('product-card')?.querySelector('.product-card__content');
      if (!dialogComponent) {
        const dialogElement = document.getElementById('quick-add-dialog');
        dialogComponent = dialogElement instanceof QuickAddDialog ? dialogElement : null;
      }

      if (dialogComponent) {
        if (shouldOpenModal && productCardContent instanceof HTMLElement) {
          dialogComponent.prepareToOpenFromElement(productCardContent);
        } else {
          dialogComponent.prepareToOpenFromElement(null);
        }
      }

      if (shouldOpenModal) {
        this.#openQuickAddModal(dialogComponent ?? undefined);
      }
    }
  };

  /** @param {QuickAddDialog} dialogComponent */
  #stayVisibleUntilDialogCloses(dialogComponent) {
    this.toggleAttribute('stay-visible', true);

    dialogComponent.addEventListener(DialogCloseEvent.eventName, () => this.toggleAttribute('stay-visible', false), {
      once: true,
    });
  }

  #openQuickAddModal = (dialogComponent = document.getElementById('quick-add-dialog')) => {
    if (!(dialogComponent instanceof QuickAddDialog)) return;

    this.#stayVisibleUntilDialogCloses(dialogComponent);

    dialogComponent.showDialog();
  };

  #closeQuickAddModal = () => {
    const dialogComponent = document.getElementById('quick-add-dialog');
    if (!(dialogComponent instanceof QuickAddDialog)) return;

    dialogComponent.closeDialog();
  };

  /**
   * Fetches the product page content
   * @param {string} productPageUrl - The URL of the product page to fetch
   * @returns {Promise<Document | null>}
   */
  async fetchProductPage(productPageUrl) {
    if (!productPageUrl) return null;

    // We use this to abort the previous fetch request if it's still pending.
    this.#abortController?.abort();
    this.#abortController = new AbortController();

    try {
      const response = await fetch(productPageUrl, {
        signal: this.#abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch product page: HTTP error ${response.status}`);
      }

      const responseText = await response.text();
      const html = new DOMParser().parseFromString(responseText, 'text/html');

      return html;
    } catch (error) {
      if (error.name === 'AbortError') {
        return null;
      } else {
        throw error;
      }
    } finally {
      this.#abortController = null;
    }
  }

  /**
   * Re-renders the variant picker.
   * @param {Element} productGrid - The product grid element
   */
  async updateQuickAddModal(productGrid) {
    const modalContent = document.getElementById('quick-add-modal-content');

    if (!productGrid || !modalContent) return;

    if (isMobileBreakpoint()) {
      const productDetails = productGrid.querySelector('.product-details');
      const productFormComponent = productGrid.querySelector('product-form-component');
      const variantPicker = productGrid.querySelector('variant-picker');
      const productPrice = productGrid.querySelector('product-price');
      const productTitle = document.createElement('a');
      productTitle.textContent = this.dataset.productTitle || '';

      // Make product title as a link to the product page
      productTitle.href = this.productPageUrl;

      const productHeader = document.createElement('div');
      productHeader.classList.add('product-header');

      productHeader.appendChild(productTitle);
      if (productPrice) {
        productHeader.appendChild(productPrice);
      }
      productGrid.appendChild(productHeader);

      if (variantPicker) {
        productGrid.appendChild(variantPicker);
      }
      if (productFormComponent) {
        productGrid.appendChild(productFormComponent);
      }

      productDetails?.remove();
    }

    morph(modalContent, productGrid);

    this.#syncVariantSelection(modalContent);
  }

  /**
   * Syncs the variant selection from the product card to the modal
   * @param {Element} modalContent - The modal content element
   */
  #syncVariantSelection(modalContent) {
    const selectedVariantId = this.#getSelectedVariantId();
    if (!selectedVariantId) return;

    // Find and check the corresponding input in the modal
    const modalInputs = modalContent.querySelectorAll('input[type="radio"][data-variant-id]');
    for (const input of modalInputs) {
      if (input instanceof HTMLInputElement && input.dataset.variantId === selectedVariantId && !input.checked) {
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }
    }
  }
}

if (!customElements.get('quick-add-component')) {
  customElements.define('quick-add-component', QuickAddComponent);
}

class QuickAddDialog extends DialogComponent {
  #abortController = new AbortController();

  /**
   * Stores the geometry of the triggering element so the modal can animate from it.
   * @param {HTMLElement | null} element
   */
  prepareToOpenFromElement(element) {
    if (!(element instanceof HTMLElement)) {
      this.#clearHostOriginData();
      return;
    }

    const rect = element.getBoundingClientRect();

    this.setAttribute('data-transition-from-card', 'true');
    this.style.setProperty('--qa-origin-top', `${rect.top + window.scrollY}px`);
    this.style.setProperty('--qa-origin-left', `${rect.left + window.scrollX}px`);
    this.style.setProperty('--qa-origin-width', `${rect.width}px`);
    this.style.setProperty('--qa-origin-height', `${rect.height}px`);

    const originStyles = window.getComputedStyle(element);
    const borderRadius = originStyles.borderRadius;

    if (borderRadius) {
      this.style.setProperty('--qa-origin-radius', borderRadius);
    } else {
      this.style.removeProperty('--qa-origin-radius');
    }
  }

  connectedCallback() {
    super.connectedCallback();

    this.addEventListener(ThemeEvents.cartUpdate, this.handleCartUpdate, { signal: this.#abortController.signal });
    this.addEventListener(ThemeEvents.variantUpdate, this.#updateProductTitleLink);

    this.addEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#abortController.abort();
    this.removeEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
  }

  showDialog() {
    /** @type {HTMLDialogElement | null} */
    const modalElement = this.querySelector('.quick-add-modal');
    const shouldAnimateFromCard = this.hasAttribute('data-transition-from-card') && modalElement instanceof HTMLDialogElement;

    if (shouldAnimateFromCard && modalElement) {
      this.#applyOriginToModal(modalElement);
    }

    const result = super.showDialog();

    if (shouldAnimateFromCard && modalElement) {
      requestAnimationFrame(() => {
        this.#prepareModalAnimation(modalElement);
      });
    }

    return result;
  }

  /**
   * Closes the dialog
   * @param {CartUpdateEvent} event - The cart update event
   */
  handleCartUpdate = (event) => {
    if (event.detail.data.didError) return;
    this.closeDialog();
  };

  #updateProductTitleLink = (/** @type {CustomEvent} */ event) => {
    const anchorElement = /** @type {HTMLAnchorElement} */ (
      event.detail.data.html?.querySelector('.view-product-title a')
    );
    const viewMoreDetailsLink = /** @type {HTMLAnchorElement} */ (this.querySelector('.view-product-title a'));
    const mobileProductTitle = /** @type {HTMLAnchorElement} */ (this.querySelector('.product-header a'));

    if (!anchorElement) return;

    if (viewMoreDetailsLink) viewMoreDetailsLink.href = anchorElement.href;
    if (mobileProductTitle) mobileProductTitle.href = anchorElement.href;
  };

  #handleDialogClose = () => {
    this.#clearTransitionState();

    const iosVersion = getIOSVersion();
    /**
     * This is a patch to solve an issue with the UI freezing when the dialog is closed.
     * To reproduce it, use iOS 16.0.
     */
    if (!iosVersion || iosVersion.major >= 17 || (iosVersion.major === 16 && iosVersion.minor >= 4)) return;

    requestAnimationFrame(() => {
      /** @type {HTMLElement | null} */
      const grid = document.querySelector('#ResultsList [product-grid-view]');
      if (grid) {
        const currentWidth = grid.getBoundingClientRect().width;
        grid.style.width = `${currentWidth - 1}px`;
        requestAnimationFrame(() => {
          grid.style.width = '';
        });
      }
    });
  };

  /**
   * Copies the stored geometry from the host element onto the modal element.
   * @param {HTMLDialogElement} modalElement
   */
  #applyOriginToModal(modalElement) {
    const originTop = this.style.getPropertyValue('--qa-origin-top');
    const originLeft = this.style.getPropertyValue('--qa-origin-left');
    const originWidth = this.style.getPropertyValue('--qa-origin-width');
    const originHeight = this.style.getPropertyValue('--qa-origin-height');
    const originRadius = this.style.getPropertyValue('--qa-origin-radius');

    if (originTop) modalElement.style.setProperty('--qa-origin-top', originTop);
    if (originLeft) modalElement.style.setProperty('--qa-origin-left', originLeft);
    if (originWidth) modalElement.style.setProperty('--qa-origin-width', originWidth);
    if (originHeight) modalElement.style.setProperty('--qa-origin-height', originHeight);
    if (originRadius) {
      modalElement.style.setProperty('--qa-origin-radius', originRadius);
    } else {
      modalElement.style.removeProperty('--qa-origin-radius');
    }

    modalElement.classList.add('opening-from-card');
    modalElement.removeAttribute('data-transition-from-card');
  }

  /**
   * Computes the translation/scale needed to animate the modal from the triggering card.
   * @param {HTMLDialogElement} modalElement
   */
  #prepareModalAnimation(modalElement) {
    const modalRect = modalElement.getBoundingClientRect();
    const originTop = parseFloat(modalElement.style.getPropertyValue('--qa-origin-top'));
    const originLeft = parseFloat(modalElement.style.getPropertyValue('--qa-origin-left'));
    const originWidth = parseFloat(modalElement.style.getPropertyValue('--qa-origin-width'));
    const originHeight = parseFloat(modalElement.style.getPropertyValue('--qa-origin-height'));

    if ([originTop, originLeft, originWidth, originHeight].some((value) => Number.isNaN(value))) {
      modalElement.removeAttribute('data-transition-from-card');
      return;
    }

    const translateX = originLeft - (modalRect.left + window.scrollX);
    const translateY = originTop - (modalRect.top + window.scrollY);
    const scaleX = modalRect.width ? Math.max(originWidth / modalRect.width, 0.01) : 1;
    const scaleY = modalRect.height ? Math.max(originHeight / modalRect.height, 0.01) : 1;

    modalElement.style.setProperty('--qa-origin-translate-x', `${translateX}px`);
    modalElement.style.setProperty('--qa-origin-translate-y', `${translateY}px`);
    modalElement.style.setProperty('--qa-origin-scale-x', `${scaleX}`);
    modalElement.style.setProperty('--qa-origin-scale-y', `${scaleY}`);
    modalElement.style.setProperty('--qa-open-duration', '0.45s');
    modalElement.style.setProperty('--qa-content-delay', '0.22s');

    const modalStyles = window.getComputedStyle(modalElement);
    const finalRadius = modalStyles.borderRadius;
    if (finalRadius) {
      modalElement.style.setProperty('--qa-final-radius', finalRadius);
    }

    modalElement.setAttribute('data-transition-from-card', 'true');
  }

  #clearTransitionState() {
    this.#clearHostOriginData();

    /** @type {HTMLDialogElement | null} */
    const modalElement = this.querySelector('.quick-add-modal');
    if (!modalElement) return;

    modalElement.classList.remove('opening-from-card');
    modalElement.removeAttribute('data-transition-from-card');

    modalElement.style.removeProperty('--qa-origin-top');
    modalElement.style.removeProperty('--qa-origin-left');
    modalElement.style.removeProperty('--qa-origin-width');
    modalElement.style.removeProperty('--qa-origin-height');
    modalElement.style.removeProperty('--qa-origin-translate-x');
    modalElement.style.removeProperty('--qa-origin-translate-y');
    modalElement.style.removeProperty('--qa-origin-scale-x');
    modalElement.style.removeProperty('--qa-origin-scale-y');
    modalElement.style.removeProperty('--qa-origin-radius');
    modalElement.style.removeProperty('--qa-final-radius');
    modalElement.style.removeProperty('--qa-open-duration');
    modalElement.style.removeProperty('--qa-content-delay');
  }

  #clearHostOriginData() {
    this.removeAttribute('data-transition-from-card');
    this.style.removeProperty('--qa-origin-top');
    this.style.removeProperty('--qa-origin-left');
    this.style.removeProperty('--qa-origin-width');
    this.style.removeProperty('--qa-origin-height');
    this.style.removeProperty('--qa-origin-radius');
  }
}

if (!customElements.get('quick-add-dialog')) {
  customElements.define('quick-add-dialog', QuickAddDialog);
}
