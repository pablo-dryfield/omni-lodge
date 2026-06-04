import { Extension } from '@tiptap/core';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';

export const FontSize = Extension.create({
  name: 'fontSize',

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => (element as HTMLElement).style.fontSize || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) {
                return {};
              }

              return {
                style: `font-size: ${attributes.fontSize}`,
              };
            },
          },
        },
      },
    ];
  },
});

export const CerebroTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      textAlign: {
        default: null,
        parseHTML: (element) => (element as HTMLElement).style.textAlign || null,
        renderHTML: (attributes) => {
          if (!attributes.textAlign) {
            return {};
          }

          return {
            style: `text-align: ${attributes.textAlign}`,
          };
        },
      },
      verticalAlign: {
        default: null,
        parseHTML: (element) => (element as HTMLElement).style.verticalAlign || null,
        renderHTML: (attributes) => {
          if (!attributes.verticalAlign) {
            return {};
          }

          return {
            style: `vertical-align: ${attributes.verticalAlign}`,
          };
        },
      },
    };
  },
});

export const CerebroTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      textAlign: {
        default: null,
        parseHTML: (element) => (element as HTMLElement).style.textAlign || null,
        renderHTML: (attributes) => {
          if (!attributes.textAlign) {
            return {};
          }

          return {
            style: `text-align: ${attributes.textAlign}`,
          };
        },
      },
      verticalAlign: {
        default: null,
        parseHTML: (element) => (element as HTMLElement).style.verticalAlign || null,
        renderHTML: (attributes) => {
          if (!attributes.verticalAlign) {
            return {};
          }

          return {
            style: `vertical-align: ${attributes.verticalAlign}`,
          };
        },
      },
    };
  },
});
