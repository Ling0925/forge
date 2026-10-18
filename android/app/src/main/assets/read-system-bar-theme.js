(() => {
  // Read only presentation state. No native bridge, storage, URLs or page content.
  const dark = document.documentElement.dataset.theme;
  if (dark !== 'dark' && dark !== 'light') return null;
  const hex = value => {
    const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(value);
    if (!match || (match[4] !== undefined && Number(match[4]) !== 1)) return null;
    return '#' + match.slice(1, 4).map(channel => Number(channel).toString(16).padStart(2, '0')).join('');
  };
  const background = y => {
    let element = document.elementFromPoint(Math.floor(innerWidth / 2), y);
    for (let depth = 0; element && depth < 32; depth++, element = element.parentElement) {
      const color = hex(getComputedStyle(element).backgroundColor);
      if (color) return color;
    }
    // Theme token is the final fallback when the page's outer containers are transparent.
    const canvas = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim();
    return /^#[\da-f]{6}$/i.test(canvas) ? canvas : null;
  };
  return { dark: dark === 'dark', top: background(0), bottom: background(Math.max(0, innerHeight - 1)) };
})()
