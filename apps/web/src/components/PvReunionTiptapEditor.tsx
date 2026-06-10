import { useEffect } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Placeholder from '@tiptap/extension-placeholder';

function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1.5 text-xs">
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={`px-2 py-0.5 rounded ${editor.isActive('heading', { level: 2 }) ? 'bg-white shadow-sm' : 'hover:bg-white/80'}`}
      >
        H2
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        className={`px-2 py-0.5 rounded ${editor.isActive('heading', { level: 3 }) ? 'bg-white shadow-sm' : 'hover:bg-white/80'}`}
      >
        H3
      </button>
      <span className="text-gray-300 px-0.5">|</span>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`px-2 py-0.5 rounded font-semibold ${editor.isActive('bold') ? 'bg-white shadow-sm' : 'hover:bg-white/80'}`}
      >
        B
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`px-2 py-0.5 rounded italic ${editor.isActive('italic') ? 'bg-white shadow-sm' : 'hover:bg-white/80'}`}
      >
        I
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={`px-2 py-0.5 rounded underline ${editor.isActive('underline') ? 'bg-white shadow-sm' : 'hover:bg-white/80'}`}
      >
        U
      </button>
      <span className="text-gray-300 px-0.5">|</span>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={`px-2 py-0.5 rounded ${editor.isActive('bulletList') ? 'bg-white shadow-sm' : 'hover:bg-white/80'}`}
      >
        Liste
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`px-2 py-0.5 rounded ${editor.isActive('orderedList') ? 'bg-white shadow-sm' : 'hover:bg-white/80'}`}
      >
        1.
      </button>
      <span className="text-gray-300 px-0.5">|</span>
      <button
        type="button"
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
        className="px-2 py-0.5 rounded hover:bg-white/80"
      >
        + Tableau
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().addColumnBefore().run()}
        disabled={!editor.can().addColumnBefore()}
        className="px-2 py-0.5 rounded hover:bg-white/80 disabled:opacity-40"
      >
        Col ←
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().addColumnAfter().run()}
        disabled={!editor.can().addColumnAfter()}
        className="px-2 py-0.5 rounded hover:bg-white/80 disabled:opacity-40"
      >
        Col →
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().deleteTable().run()}
        disabled={!editor.can().deleteTable()}
        className="px-2 py-0.5 rounded hover:bg-white/80 disabled:opacity-40 text-red-700"
      >
        Suppr. tab.
      </button>
    </div>
  );
}

const extensions = [
  StarterKit.configure({
    heading: { levels: [2, 3, 4] },
  }),
  Underline,
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  Placeholder.configure({ placeholder: 'Rédigez le procès-verbal…' }),
];

type Props = {
  initialHtml: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  minHeightClass?: string;
};

export function PvReunionTiptapEditor({ initialHtml, onChange, disabled, minHeightClass }: Props) {
  const editor = useEditor({
    extensions,
    content: initialHtml?.trim() ? initialHtml : '<p></p>',
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: `prose-pv max-w-none px-3 py-2 text-sm text-gray-900 outline-none min-h-[260px] ${minHeightClass || ''}`,
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    },
  });

  useEffect(() => {
    if (editor) editor.setEditable(!disabled);
  }, [editor, disabled]);

  if (!editor) {
    return <div className="border border-gray-200 rounded-md p-4 text-sm text-gray-500">Chargement de l’éditeur…</div>;
  }

  return (
    <div className={`border border-gray-200 rounded-md overflow-hidden bg-white ${disabled ? 'opacity-70' : ''}`}>
      {!disabled && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
      <style>{`
        .prose-pv h2 { font-size: 1.125rem; font-weight: 700; margin: 0.75rem 0 0.35rem; }
        .prose-pv h3 { font-size: 1rem; font-weight: 600; margin: 0.6rem 0 0.25rem; }
        .prose-pv h4 { font-size: 0.95rem; font-weight: 600; margin: 0.5rem 0 0.2rem; }
        .prose-pv p { margin: 0.35rem 0; line-height: 1.5; }
        .prose-pv ul, .prose-pv ol { margin: 0.35rem 0 0.35rem 1.25rem; padding-left: 0.25rem; }
        .prose-pv table { border-collapse: collapse; width: 100%; margin: 0.5rem 0; font-size: 0.8125rem; }
        .prose-pv th, .prose-pv td { border: 1px solid #d1d5db; padding: 0.25rem 0.5rem; vertical-align: top; }
        .prose-pv th { background: #f3f4f6; font-weight: 600; }
        .ProseMirror:focus { outline: none; }
      `}</style>
    </div>
  );
}
