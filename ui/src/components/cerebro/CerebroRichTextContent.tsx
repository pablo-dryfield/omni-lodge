import { Box } from '@mantine/core';
import { sanitizeCerebroRichText } from './cerebroRichTextSanitize';
import './CerebroRichText.css';

type CerebroRichTextContentProps = {
  value: string;
};

export const CerebroRichTextContent = ({ value }: CerebroRichTextContentProps) => (
  <Box
    className="cerebro-rich-text"
    dangerouslySetInnerHTML={{ __html: sanitizeCerebroRichText(value) }}
  />
);
