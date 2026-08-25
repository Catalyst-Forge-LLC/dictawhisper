export function heightAt(sizes, index, estimate) {
  const value = sizes[index];
  return Number.isFinite(value) && value > 0 ? value : estimate;
}

export function offsetAt(sizes, index, estimate) {
  let top = 0;
  for (let i = 0; i < index; i += 1) top += heightAt(sizes, i, estimate);
  return top;
}

export function virtualSlice({
  count,
  scrollTop,
  viewport,
  sizes,
  estimate = 108,
  overscan = 8,
}) {
  const totalCount = Math.max(0, Number(count) || 0);
  const view = Math.max(1, Number(viewport) || 1);
  const top = Math.max(0, Number(scrollTop) || 0);
  let start = 0;
  let acc = 0;
  while (start < totalCount) {
    const height = heightAt(sizes, start, estimate);
    if (acc + height > top) break;
    acc += height;
    start += 1;
  }
  start = Math.max(0, start - overscan);
  const startTop = offsetAt(sizes, start, estimate);
  let end = start;
  let y = startTop;
  const limit = top + view + overscan * estimate;
  while (end < totalCount && y < limit) {
    y += heightAt(sizes, end, estimate);
    end += 1;
  }
  return {
    start,
    end,
    startTop,
    total: offsetAt(sizes, totalCount, estimate),
  };
}
