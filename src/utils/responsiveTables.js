export function ensureResponsiveTableWrappers(container) {
  if (!container) return;
  Array.from(container.querySelectorAll('table')).forEach((table) => {
    if (table.closest('.msc-table-wrap')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'msc-table-wrap';
    wrapper.setAttribute('data-msc-table', '1');
    table.parentNode?.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });
}
