/**
 * Is the pen on the screen? Drivers differ: the tip normally sets button bit 1, but with the
 * side button held Windows reports contact as the second button only, and the eraser
 * (button or eraser end) reports bit 32. Pressure is 0 while hovering in every case.
 */
export function penTouching(e: { buttons: number; pressure: number }): boolean {
  return (e.buttons & 1) !== 0 || e.pressure > 0;
}
