export function gridTracks(available, scale, gap, minWidth, maxColumns) {
  const columns = Math.max(1, Math.min(maxColumns, Math.floor((available + gap)/(minWidth + gap))));
  return { columns, width: Math.max(scale, Math.floor((available-(columns-1)*gap)/columns/scale)*scale) };
}

// Source-pixel slices: repeat only whole pixels; final partial tile is clipped.
export function tileAxis(length, tile) {
  if (!Number.isInteger(length) || length < tile*2) throw new Error('Panel too small for fixed corners');
  const parts = [{ source: 0, dest: 0, size: tile }];
  for (let at=tile; at<length-tile; at+=tile) parts.push({source:tile,dest:at,size:Math.min(tile,length-tile-at)});
  parts.push({source:tile*2,dest:length-tile,size:tile});
  return parts;
}

export function frameRect(asset, index=0) {
  const [width,height] = asset.frame;
  const columns = Math.floor(asset.width/width);
  const count = columns * Math.floor(asset.height/height);
  if (!Number.isInteger(index) || index<0 || index>=count) throw new Error(`Invalid sprite frame: ${index}`);
  return {x:(index%columns)*width,y:Math.floor(index/columns)*height,width,height};
}
