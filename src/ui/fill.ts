import { PEN_COLORS } from '../app/settings';
import { h } from './dom';
import { field, slider } from './popover';
import { colorPanel } from './colorpicker';
import { addStrings, t } from './i18n';

addStrings(
  { 'fill.color': 'Füllfarbe', 'fill.opacity': 'Deckkraft der Füllung' },
  { 'fill.color': 'Fill color', 'fill.opacity': 'Fill opacity' },
);

/** Fill colour (or none) and fill opacity of shapes; the opacity row only shows while there is a fill. */
export function fillControls(opts: {
  fill: string | null;
  opacity: number;
  onFill: (color: string | null) => void;
  onOpacity: (opacity: number) => void;
}): HTMLElement {
  let fill = opts.fill;
  let opacity = opts.opacity;
  const opacityRow = h('div.fill-opacity');
  const renderOpacity = () => {
    opacityRow.replaceChildren();
    if (!fill) return;
    opacityRow.append(
      field(
        t('fill.opacity'),
        slider({
          min: 5, max: 100, step: 5, value: Math.round(opacity * 100), format: (v) => `${v} %`,
          onInput: (v) => {
            opacity = v / 100;
            opts.onOpacity(opacity);
          },
        }),
      ),
    );
  };
  renderOpacity();
  return h(
    'div.fill-controls',
    null,
    field(
      t('fill.color'),
      colorPanel({
        colors: PEN_COLORS,
        value: fill,
        allowNone: true,
        onPick: (c) => {
          fill = c;
          opts.onFill(c);
          renderOpacity();
        },
      }),
    ),
    opacityRow,
  );
}
