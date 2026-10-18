import { NOTE_COLORS, settings } from '../app/settings';
import { h } from './dom';
import { icon } from './icons';
import { Popover } from './popover';
import { addStrings, t } from './i18n';

addStrings(
  { 'note.placeholder': 'Notiz schreiben …', 'note.delete': 'Notiz löschen', 'note.color': 'Farbe' },
  { 'note.placeholder': 'Write a note …', 'note.delete': 'Delete note', 'note.color': 'Color' },
);

export interface NoteEditorOptions {
  anchor: DOMRect;
  text: string;
  color: string;
  isNew: boolean;
  /** called once when the popover closes */
  onDone: (result: { text: string; color: string; deleted: boolean }) => void;
}

export function openNoteEditor(opts: NoteEditorOptions): Popover {
  let color = opts.color;
  let deleted = false;
  const ta = h('textarea.note-text', { value: opts.text, placeholder: t('note.placeholder'), rows: 4, spellcheck: true });
  const dots = h('div.note-colors');
  const paint = () => {
    dots.replaceChildren(
      ...NOTE_COLORS.map((c) =>
        h('button.note-dot', {
          style: `--c:${c}`,
          title: t('note.color'),
          'aria-pressed': String(c === color),
          onclick: () => {
            color = c;
            settings.patch('note', { color: c });
            paint();
          },
        }),
      ),
    );
  };
  paint();
  const del = h('button.icon-btn.danger', {
    title: t('note.delete'),
    'aria-label': t('note.delete'),
    onclick: () => {
      deleted = true;
      pop.close();
    },
  }, icon('trash', 16));
  const content = h('div.note-editor', null, ta, h('div.note-row', null, dots, opts.isNew ? null : del));
  const pop = new Popover(content, {
    anchor: opts.anchor,
    placement: 'right',
    className: 'note-popover',
    onClose: () => opts.onDone({ text: ta.value, color, deleted }),
  });
  pop.open();
  ta.focus();
  setTimeout(() => ta.focus(), 30);
  return pop;
}
