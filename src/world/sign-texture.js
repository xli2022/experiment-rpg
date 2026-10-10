import * as THREE from 'three';

// Canvas signs shared by building signs and wayfinding boards.
export function drawSign(ctx, title, subtitle, color, vertical = false) {
  const w = vertical ? 256 : 1024, h = vertical ? 1024 : 384;
  ctx.fillStyle = '#09131c'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = color + '19'; ctx.fillRect(8, 8, w - 16, h - 16);
  ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.strokeRect(12, 12, w - 24, h - 24);
  ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 15; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (vertical) {
    ctx.font = '700 150px "Barlow Condensed", sans-serif';
    [...title].forEach((ch, i) => ctx.fillText(ch, w / 2, 110 + i * ((h - 210) / Math.max(title.length - 1, 1))));
  } else {
    ctx.font = `${title.length > 12 ? 100 : 146}px "Barlow Condensed", sans-serif`;
    ctx.fillText(title, w / 2, h * .43, w - 90);
    ctx.shadowBlur = 0; ctx.font = '28px "Barlow", sans-serif'; ctx.fillText(subtitle, w / 2, h * .77, w - 70);
    ctx.fillRect(35, h - 32, 95, 4); ctx.fillRect(w - 130, h - 32, 95, 4);
  }
}

export function signTexture(title, subtitle, color, vertical = false) {
  const canvas = document.createElement('canvas'); canvas.width = vertical ? 256 : 1024; canvas.height = vertical ? 1024 : 384;
  drawSign(canvas.getContext('2d'), title, subtitle, color, vertical);
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}
