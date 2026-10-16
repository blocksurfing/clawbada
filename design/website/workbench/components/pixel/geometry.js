export function gridTracks(available, scale, gap, minWidth, maxColumns) {
  const columns = Math.max(1, Math.min(maxColumns, Math.floor((available + gap)/(minWidth + gap))));
  return { columns, width: Math.max(scale, Math.floor((available-(columns-1)*gap)/columns/scale)*scale) };
}

// Source-pixel slices: repeat only whole pixels; final partial tile is clipped.
export function tileAxis(length, tile, sliceSpan=tile) {
  if (!Number.isInteger(tile) || tile<1 || !Number.isInteger(sliceSpan) || sliceSpan<tile || sliceSpan%tile) throw new Error('Invalid panel tile group');
  if (!Number.isInteger(length) || length < sliceSpan*2) throw new Error('Panel too small for fixed corners');
  const groups = [{ source: 0, dest: 0, size: sliceSpan }];
  for (let at=sliceSpan; at<length-sliceSpan; at+=sliceSpan) groups.push({source:sliceSpan,dest:at,size:Math.min(sliceSpan,length-sliceSpan-at)});
  groups.push({source:sliceSpan*2,dest:length-sliceSpan,size:sliceSpan});
  // Keep multi-tile ornaments intact, but every draw uses the common tile grid.
  return groups.flatMap(group => {
    const parts=[];
    for (let offset=0; offset<group.size; offset+=tile) parts.push({source:group.source+offset,dest:group.dest+offset,size:Math.min(tile,group.size-offset)});
    return parts;
  });
}

export function frameRect(asset, index=0) {
  const [width,height] = asset.frame;
  const columns = Math.floor(asset.width/width);
  const count = columns * Math.floor(asset.height/height);
  if (!Number.isInteger(index) || index<0 || index>=count) throw new Error(`Invalid sprite frame: ${index}`);
  return {x:(index%columns)*width,y:Math.floor(index/columns)*height,width,height};
}
