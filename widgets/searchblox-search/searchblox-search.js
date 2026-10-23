import { mount } from './searchblox-core.js';

/**
 * EDS widget entry point. Options come from the widget link's query string,
 * which EDS turns into data-* attributes, e.g.
 *   /widgets/searchblox-search/searchblox-search.html?domain=https://demo1.searchblox.com&collections=12&facets=contenttype,keywords
 */
export default function decorate(widget) {
  mount(widget, { ...widget.dataset });
}
