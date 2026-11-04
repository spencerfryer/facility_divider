/**
 * Core splitting logic. Pure functions, no DOM, so it can be tested in Node.
 *
 * Beds are kept in the order they are listed (that order stands in for the
 * physical layout, e.g. down the hall). Occupied beds are split into one
 * contiguous run per staff member, with group sizes differing by at most one.
 * Empty beds are attached to whichever group's span they fall inside, so each
 * person also knows which open beds (admissions) are "theirs".
 */
(function (root) {
  /**
   * Sizes of `groups` groups covering `total` items as evenly as possible.
   * Larger groups come first, e.g. evenSizes(10, 3) -> [4, 3, 3].
   */
  function evenSizes(total, groups) {
    if (groups <= 0) return [];
    const base = Math.floor(total / groups);
    const extra = total % groups;
    const sizes = [];
    for (let i = 0; i < groups; i++) sizes.push(base + (i < extra ? 1 : 0));
    return sizes;
  }

  /**
   * @param {{id: string, occupied: boolean}[]} beds  beds in layout order
   * @param {number} staffCount
   * @returns {{groups: {occupied: string[], empty: string[]}[], unassignedEmpty: string[]}}
   */
  function divideBeds(beds, staffCount) {
    const n = Math.max(0, Math.floor(Number(staffCount) || 0));
    const groups = [];
    for (let i = 0; i < n; i++) groups.push({ occupied: [], empty: [] });
    if (n === 0) {
      return { groups, unassignedEmpty: beds.filter((b) => !b.occupied).map((b) => b.id) };
    }

    const occupiedIdx = [];
    beds.forEach((b, i) => { if (b.occupied) occupiedIdx.push(i); });
    const sizes = evenSizes(occupiedIdx.length, n);

    // owner[i] = group index owning bed i (occupied beds only for now)
    const owner = new Array(beds.length).fill(-1);
    let k = 0;
    sizes.forEach((size, g) => {
      for (let j = 0; j < size; j++) owner[occupiedIdx[k++]] = g;
    });

    // Empty beds: belong to the group of the nearest occupied bed before them
    // in the list; leading empties go to the first group that has any beds.
    const firstGroupWithBeds = sizes.findIndex((s) => s > 0);
    let current = firstGroupWithBeds >= 0 ? firstGroupWithBeds : 0;
    beds.forEach((b, i) => {
      if (b.occupied) {
        current = owner[i];
        groups[current].occupied.push(b.id);
      } else {
        groups[current].empty.push(b.id);
      }
    });

    // If nobody has occupied beds (census of zero), spread empties evenly instead.
    if (occupiedIdx.length === 0) {
      groups.forEach((g) => { g.empty = []; });
      const emptySizes = evenSizes(beds.length, n);
      let e = 0;
      emptySizes.forEach((size, g) => {
        for (let j = 0; j < size; j++) groups[g].empty.push(beds[e++].id);
      });
    }

    return { groups, unassignedEmpty: [] };
  }

  /**
   * Turn free text into bed ids. Accepts commas or newlines, and ranges like
   * "1-20" or "A1-A12" (same prefix, numeric suffix).
   */
  function parseBedList(text) {
    const out = [];
    const parts = String(text).split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const m = part.match(/^(.*?)(\d+)\s*-\s*(\1)?(\d+)$/);
      if (m) {
        const prefix = m[1];
        const a = parseInt(m[2], 10);
        const b = parseInt(m[4], 10);
        const width = m[2].length === m[4].length && m[2].startsWith('0') ? m[2].length : 0;
        const step = a <= b ? 1 : -1;
        if (Math.abs(b - a) > 2000) { out.push(part); continue; }
        for (let x = a; step > 0 ? x <= b : x >= b; x += step) {
          out.push(prefix + String(x).padStart(width, '0'));
        }
      } else {
        out.push(part);
      }
    }
    // de-duplicate, keep first occurrence
    return out.filter((id, i) => out.indexOf(id) === i);
  }

  const api = { evenSizes, divideBeds, parseBedList };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Divider = api;
})(typeof self !== 'undefined' ? self : this);
