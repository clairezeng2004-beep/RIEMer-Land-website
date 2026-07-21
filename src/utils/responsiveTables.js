export function ensureResponsiveTableWrappers(container) {
  if (!container) return;
  Array.from(container.querySelectorAll('table')).forEach((table) => {
    let wrapper = table.closest('.msc-table-wrap');
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'msc-table-wrap';
      wrapper.setAttribute('data-msc-table', '1');
      table.parentNode?.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    }

    const colgroupCount = table.querySelector(':scope > colgroup')?.children?.length || 0;
    const rowColumnCount = Math.max(0, ...Array.from(table.rows || []).map((row) => (
      Array.from(row.cells || []).reduce(
        (count, cell) => count + Math.max(1, Number(cell.colSpan) || 1),
        0,
      )
    )));
    const columnCount = Math.max(1, colgroupCount, rowColumnCount);
    wrapper.style.setProperty('--msc-table-mobile-width', `${Math.max(320, columnCount * 96)}px`);
  });
}
