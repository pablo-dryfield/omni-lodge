import {
  Body,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components';
import * as ReactEmailComponents from '@react-email/components';
import { render } from '@react-email/render';
import { Fragment, createElement, isValidElement } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import ts from 'typescript';
import vm from 'node:vm';
import type EmailTemplate from '../../models/EmailTemplate.js';
import type { EmailTemplateType } from '../../models/EmailTemplate.js';

export type EmailTemplateContext = Record<string, unknown>;

type RenderStoredEmailTemplateParams = {
  template: EmailTemplate;
  context?: EmailTemplateContext | null;
  subjectOverride?: string | null;
  bodyOverride?: string | null;
};

export type RenderedEmailTemplate = {
  templateType: EmailTemplateType;
  subject: string;
  textBody: string;
  htmlBody: string | null;
};

type RenderReactEmailTemplateSourceParams = {
  source: string;
  subject: string;
  context?: EmailTemplateContext | null;
};

const PLACEHOLDER_REGEX = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
const REACT_TEMPLATE_SOURCE_MARKER = '@react-email-template-source';
const IDENTIFIER_REGEX = /\b[A-Za-z_$][A-Za-z0-9_$]*\b/g;

const RESERVED_IDENTIFIER_WORDS = new Set<string>([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'await',
  'null',
  'true',
  'false',
]);

const BUILTIN_GLOBAL_IDENTIFIERS = new Set<string>([
  'Math',
  'Date',
  'Array',
  'Object',
  'String',
  'Number',
  'Boolean',
  'JSON',
  'Intl',
  'RegExp',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Promise',
  'Error',
  'TypeError',
  'ReferenceError',
  'console',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'encodeURIComponent',
  'decodeURIComponent',
  'undefined',
]);

const pageBodyStyle: CSSProperties = {
  backgroundColor: '#eef2ff',
  fontFamily: 'Segoe UI, Arial, sans-serif',
  margin: 0,
  padding: '28px 12px',
};

const cardStyle: CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #dbe3f4',
  borderRadius: '14px',
  margin: '0 auto',
  maxWidth: '680px',
  padding: '24px',
};

const mutedTextStyle: CSSProperties = {
  color: '#475569',
  fontSize: '13px',
  lineHeight: '18px',
  margin: '0',
};

const paragraphStyle: CSSProperties = {
  color: '#1e293b',
  fontSize: '15px',
  lineHeight: '24px',
  margin: '0',
  whiteSpace: 'pre-line',
};

const sectionCardStyle: CSSProperties = {
  backgroundColor: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '10px',
  marginTop: '14px',
  padding: '12px',
};

type RefundAddonLine = {
  name: string;
  quantity: number;
  amount: number;
};

type SupplyOrderLine = {
  name: string;
  quantity: number;
  unit: string;
  priority: string | null;
  note: string | null;
};

const interpolationFallback = (key: string): string => `{{${key}}}`;

const normalizeTemplateContextScalar = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
};

const interpolateTemplate = (template: string, context: EmailTemplateContext = {}): string =>
  template.replace(PLACEHOLDER_REGEX, (_, rawKey: string) => {
    const key = String(rawKey ?? '').trim();
    if (!key) {
      return '';
    }
    if (!(key in context)) {
      return interpolationFallback(key);
    }
    return normalizeTemplateContextScalar(context[key]);
  });

const normalizeTextBody = (value: string): string => value.replace(/\r\n/g, '\n').trim();

const stripHtmlTags = (html: string): string => {
  if (!html) {
    return '';
  }
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|td|h1|h2|h3|h4|h5|h6|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const toString = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
};

const toNullableString = (value: unknown): string | null => {
  const normalized = toString(value).trim();
  return normalized.length > 0 ? normalized : null;
};

const toNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
};

const toInteger = (value: unknown): number => {
  const numberValue = toNumber(value);
  if (!Number.isFinite(numberValue)) {
    return 0;
  }
  return Math.max(0, Math.round(numberValue));
};

const toBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['true', '1', 'yes', 'y'].includes(normalized);
  }
  return false;
};

const toRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const toArray = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value;
};

const formatCurrency = (amount: number, currency: string): string => {
  const safeCurrency = currency.trim().toUpperCase();
  if (safeCurrency.length === 3) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: safeCurrency }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${safeCurrency}`;
    }
  }
  return `${amount.toFixed(2)} ${safeCurrency || 'EUR'}`;
};

const resolveTemplateKey = (template: EmailTemplate, context: EmailTemplateContext): string => {
  const fromContext = toNullableString(context.templateKey)?.toLowerCase();
  if (fromContext) {
    return fromContext;
  }
  return String(template.name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
};

const isReactTemplateSource = (value: string): boolean =>
  value.includes(REACT_TEMPLATE_SOURCE_MARKER);

const looksLikeReactTemplateSource = (value: string): boolean => {
  const source = value.trim();
  if (!source) {
    return false;
  }
  return (
    source.includes('return (') ||
    source.includes('components;') ||
    source.includes('<Section') ||
    source.includes('<Text') ||
    source.includes('<Row') ||
    source.includes('<Column') ||
    source.includes('<Html')
  );
};

const normalizeLiveReactTemplateSource = (source: string): string => {
  // Support template-like placeholders typed in live editor: {{value}} -> {value}
  // This avoids rendering object literals as JSX children while preserving
  // valid JSX attribute object literals like style={{ ... }}.
  // Only convert simple variable/path placeholders and only when the token is
  // not directly preceded by "=" (which indicates JSX prop assignment).
  const normalized = source.replace(
    /(?<![=])\{\{\s*([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\s*\}\}/g,
    '{$1}',
  );

  // Guard against accidental self-references in declarations like:
  // const peopleRefund = toRecord(peopleRefundDetails ?? peopleRefund ?? {});
  // which throw TDZ errors during preview. In these fallback expressions,
  // reinterpret the self-reference as context.<name>.
  return normalized.replace(
    /\b(const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([^;]+);/g,
    (match, declarationKind: string, variableName: string, initializer: string) => {
      const escapedName = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const bareIdentifier = `(?<![\\w$.])${escapedName}(?![\\w$])`;
      const fallbackSelfReference = new RegExp(
        `(?:\\?\\?|\\|\\|)\\s*${bareIdentifier}|${bareIdentifier}\\s*(?:\\?\\?|\\|\\|)`,
      );
      if (!fallbackSelfReference.test(initializer)) {
        return match;
      }
      const replacedInitializer = initializer.replace(
        new RegExp(bareIdentifier, 'g'),
        `context.${variableName}`,
      );
      return `${declarationKind} ${variableName} = ${replacedInitializer};`;
    },
  );
};

const isSafeIdentifierName = (value: string): boolean =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) &&
  !RESERVED_IDENTIFIER_WORDS.has(value) &&
  !BUILTIN_GLOBAL_IDENTIFIERS.has(value);

const collectTemplateIdentifiers = (source: string): string[] => {
  const matches = source.match(IDENTIFIER_REGEX) ?? [];
  const unique = new Set<string>();
  matches.forEach((match) => {
    if (!isSafeIdentifierName(match)) {
      return;
    }
    unique.add(match);
  });
  return Array.from(unique);
};

const createReactRuntimeModule = (): Record<string, unknown> => {
  const reactRuntime = {
    createElement,
    Fragment,
  };
  return {
    __esModule: true,
    default: reactRuntime,
    createElement,
    Fragment,
  };
};

const createReactEmailComponentsModule = (): Record<string, unknown> => ({
  __esModule: true,
  default: ReactEmailComponents,
  ...ReactEmailComponents,
});

const resolveElementFromTemplateOutput = (value: unknown): ReactNode =>
  isValidElement(value)
    ? value
    : createElement(
        Section,
        null,
        createElement(
          Text,
          { style: paragraphStyle },
          String(value ?? ''),
        ),
      );

const formatTranspileDiagnostics = (diagnostics: readonly ts.Diagnostic[] | undefined): string | null => {
  if (!diagnostics || diagnostics.length === 0) {
    return null;
  }
  const errors = diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (errors.length === 0) {
    return null;
  }
  return errors
    .slice(0, 3)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    .join(' | ');
};

const renderDynamicReactTemplateSource = async (
  source: string,
  subject: string,
  context: EmailTemplateContext,
): Promise<{ html: string; textBody: string }> => {
  const normalizedSource = normalizeLiveReactTemplateSource(source);
  const baseCompilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    strict: false,
  };

  const executeCommonJsSource = (scriptSource: string): unknown => {
    const transpileResult = ts.transpileModule(scriptSource, {
      compilerOptions: baseCompilerOptions,
      fileName: 'live-template.tsx',
      reportDiagnostics: true,
    });
    const transpileError = formatTranspileDiagnostics(transpileResult.diagnostics);
    if (transpileError) {
      throw new Error(`TypeScript transpile failed: ${transpileError}`);
    }
    const transpiled = transpileResult.outputText;

    const reactRuntimeModule = createReactRuntimeModule();
    const reactEmailModule = createReactEmailComponentsModule();
    const safeRequire = (moduleName: string): unknown => {
      if (moduleName === 'react') {
        return reactRuntimeModule;
      }
      if (moduleName === '@react-email/components') {
        return reactEmailModule;
      }
      throw new Error(`Unsupported import in React Email source: ${moduleName}`);
    };

    const moduleExports: Record<string, unknown> = {};
    const sandbox: Record<string, unknown> & {
      module: { exports: unknown };
      exports: unknown;
      require: (moduleName: string) => unknown;
      React: Record<string, unknown>;
      components: Record<string, unknown>;
      console: { log: (..._args: unknown[]) => void };
    } = {
      module: { exports: moduleExports },
      exports: moduleExports,
      require: safeRequire,
      React: reactRuntimeModule,
      components: reactEmailModule,
      console: { log: () => undefined },
    };

    const contextRecord = toRecord(context);
    const identifierCandidates = collectTemplateIdentifiers(scriptSource);
    const contextKeys = Object.keys(contextRecord);

    Object.entries(ReactEmailComponents).forEach(([key, value]) => {
      if (!isSafeIdentifierName(key)) {
        return;
      }
      if (!(key in sandbox)) {
        sandbox[key] = value;
      }
    });

    contextKeys.forEach((key) => {
      if (!isSafeIdentifierName(key)) {
        return;
      }
      if (!(key in sandbox)) {
        sandbox[key] = contextRecord[key];
      }
    });

    identifierCandidates.forEach((key) => {
      if (!isSafeIdentifierName(key)) {
        return;
      }
      if (key in sandbox) {
        return;
      }
      sandbox[key] = key in contextRecord ? contextRecord[key] : undefined;
    });

    vm.runInNewContext(transpiled, sandbox, { timeout: 2000 });
    return sandbox.module.exports;
  };

  const renderInput = {
    subject,
    context,
    components: ReactEmailComponents,
    React: {
      createElement,
      Fragment,
    },
  };

  let element: ReactNode;
  let lastError: Error | null = null;

  try {
    const wrappedSource = `
    function __renderTemplate(input) {
      const { subject, context, components, React } = input;
      ${normalizedSource}
    }
    module.exports = __renderTemplate;
    `;
    const renderTemplate = executeCommonJsSource(wrappedSource);
    if (typeof renderTemplate !== 'function') {
      throw new Error('Expected a function body that returns JSX.');
    }
    const elementOrValue = (renderTemplate as (input: unknown) => unknown)(renderInput);
    element = resolveElementFromTemplateOutput(elementOrValue);
  } catch (error) {
    lastError = error instanceof Error ? error : new Error(String(error));
    try {
      const exportedModule = executeCommonJsSource(normalizedSource);
      const exportedRecord = exportedModule as Record<string, unknown>;
      const exportedTemplate =
        (exportedRecord?.default as unknown) ??
        (exportedRecord?.Template as unknown) ??
        exportedModule;

      let elementOrValue: unknown = exportedTemplate;
      if (typeof exportedTemplate === 'function') {
        elementOrValue = exportedTemplate({
          subject,
          context,
          ...context,
        });
      }
      element = resolveElementFromTemplateOutput(elementOrValue);
    } catch (moduleModeError) {
      const primaryMessage = lastError?.message ?? 'Unknown source error';
      const secondaryMessage =
        moduleModeError instanceof Error ? moduleModeError.message : String(moduleModeError);
      throw new Error(
        `Invalid React Email template source. Function-body mode failed: ${primaryMessage}. Module mode failed: ${secondaryMessage}`,
      );
    }
  }

  const html = await render(element);
  const textBodyFromContext = toNullableString(context.reactPlainText);
  const textBody = textBodyFromContext ?? stripHtmlTags(html) ?? 'Rendered from React Email template.';
  return {
    html,
    textBody: textBody.trim() || 'Rendered from React Email template.',
  };
};

const renderShell = (subject: string, previewText: string, children: ReactNode): ReactNode =>
  createElement(
    Html,
    null,
    createElement(Head, null),
    createElement(Preview, null, previewText || subject),
    createElement(
      Body,
      { style: pageBodyStyle },
      createElement(
        Container,
        { style: cardStyle },
        children,
      ),
    ),
  );

const renderBasicTemplateHtml = async (subject: string, textBody: string, context: EmailTemplateContext): Promise<string> => {
  const messageLines = toArray(context.messageLines)
    .map((entry) => toNullableString(entry))
    .filter((entry): entry is string => entry !== null);
  const paragraphs = (messageLines.length > 0 ? messageLines : textBody.split(/\n{2,}/))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const greeting = toNullableString(context.greeting) ?? 'Hello,';
  const signature = toNullableString(context.signature);
  const footer = toNullableString(context.footerNote);

  const html = renderShell(
    subject,
    `${subject} ${textBody}`.replace(/\s+/g, ' ').trim().slice(0, 120),
    createElement(
      Section,
      null,
      createElement(
        Heading,
        {
          as: 'h1',
          style: {
            color: '#0f172a',
            fontSize: '24px',
            lineHeight: '30px',
            margin: '0 0 12px',
            padding: 0,
          },
        },
        subject,
      ),
      createElement(Hr, { style: { borderColor: '#dbe3f4', margin: '0 0 18px' } }),
      createElement(
        Text,
        {
          style: { ...paragraphStyle, marginBottom: '10px', fontWeight: 600 },
        },
        greeting,
      ),
      ...paragraphs.map((paragraph, index) =>
        createElement(
          Text,
          {
            key: `basic-paragraph-${index}`,
            style: {
              ...paragraphStyle,
              marginBottom: index === paragraphs.length - 1 && !signature ? '0' : '10px',
            },
          },
          paragraph,
        ),
      ),
      signature
        ? createElement(
            Text,
            {
              style: { ...paragraphStyle, marginTop: '16px' },
            },
            signature,
          )
        : null,
      footer
        ? createElement(
            Text,
            {
              style: { ...mutedTextStyle, marginTop: '18px' },
            },
            footer,
          )
        : null,
    ),
  );

  return render(html);
};

const resolveRefundAddons = (context: EmailTemplateContext): RefundAddonLine[] =>
  toArray(context.refundedAddons)
    .map((entry) => {
      const item = toRecord(entry);
      const name = toNullableString(item.name);
      if (!name) {
        return null;
      }
      return {
        name,
        quantity: Math.max(1, toInteger(item.quantity)),
        amount: toNumber(item.amount),
      } as RefundAddonLine;
    })
    .filter((entry): entry is RefundAddonLine => entry !== null);

const inferRefundKind = (
  context: EmailTemplateContext,
  refundedAmount: number,
  totalPaidAmount: number,
): { isFullRefund: boolean; reasonLabel: string; reasonDetail: string } => {
  const explicitReason = toNullableString(context.partialReason) ?? toNullableString(context.refundReason);
  const explicitIsFullRefund = context.isFullRefund !== undefined ? toBoolean(context.isFullRefund) : null;
  const refundedAddons = resolveRefundAddons(context);
  const peopleChange = toRecord(context.peopleChange);
  const fromPeople = toInteger(peopleChange.from);
  const toPeople = toInteger(peopleChange.to);
  const peopleChanged = fromPeople > 0 && toPeople >= 0 && toPeople < fromPeople;
  const byAddons = refundedAddons.length > 0;
  const computedIsFull = totalPaidAmount > 0 && refundedAmount >= totalPaidAmount - 0.01;
  const isFullRefund = explicitIsFullRefund ?? computedIsFull;

  if (isFullRefund) {
    return {
      isFullRefund: true,
      reasonLabel: 'Refund type',
      reasonDetail: 'Full refund',
    };
  }

  if (explicitReason) {
    return {
      isFullRefund: false,
      reasonLabel: 'Partial refund reason',
      reasonDetail: explicitReason,
    };
  }

  if (byAddons && peopleChanged) {
    return {
      isFullRefund: false,
      reasonLabel: 'Partial refund reason',
      reasonDetail: 'Combination of add-on adjustments and change in people quantity',
    };
  }
  if (byAddons) {
    return {
      isFullRefund: false,
      reasonLabel: 'Partial refund reason',
      reasonDetail: 'Add-on refund',
    };
  }
  if (peopleChanged) {
    return {
      isFullRefund: false,
      reasonLabel: 'Partial refund reason',
      reasonDetail: 'People quantity changed',
    };
  }
  return {
    isFullRefund: false,
    reasonLabel: 'Partial refund reason',
    reasonDetail: 'Manual partial adjustment',
  };
};

const renderBookingRefundTemplateHtml = async (
  subject: string,
  templateBodyText: string,
  context: EmailTemplateContext,
): Promise<{ html: string; textBody: string }> => {
  const customerName = toNullableString(context.customerName) ?? 'Guest';
  const bookingReference = toNullableString(context.bookingReference) ?? toNullableString(context.bookingId) ?? '-';
  const productName = toNullableString(context.productName) ?? 'Experience';
  const experienceDate = toNullableString(context.experienceDate) ?? toNullableString(context.bookingDateDisplay) ?? '-';
  const currency = toNullableString(context.currency) ?? 'EUR';
  const refundedAmount = Math.max(0, toNumber(context.refundedAmount));
  const totalPaidAmount = Math.max(0, toNumber(context.totalPaidAmount));
  const refundedAddons = resolveRefundAddons(context);
  const peopleChange = toRecord(context.peopleChange);
  const fromPeople = toInteger(peopleChange.from);
  const toPeople = toInteger(peopleChange.to);
  const peopleAmount = Math.max(0, toNumber(peopleChange.amount));
  const refundKind = inferRefundKind(context, refundedAmount, totalPaidAmount);
  const refundedLabel = formatCurrency(refundedAmount, currency);
  const totalPaidLabel = totalPaidAmount > 0 ? formatCurrency(totalPaidAmount, currency) : null;
  const customMessage = templateBodyText.trim();

  const textLines: string[] = [
    `Hi ${customerName},`,
    '',
    `We have processed your ${refundKind.isFullRefund ? 'full' : 'partial'} refund for booking ${bookingReference}.`,
    `Refunded amount: ${refundedLabel}.`,
    `Product: ${productName}.`,
    `Experience date: ${experienceDate}.`,
  ];
  if (totalPaidLabel) {
    textLines.push(`Total paid: ${totalPaidLabel}.`);
  }
  if (!refundKind.isFullRefund) {
    textLines.push(`${refundKind.reasonLabel}: ${refundKind.reasonDetail}.`);
  }
  if (refundedAddons.length > 0) {
    textLines.push('');
    textLines.push('Refunded add-ons:');
    refundedAddons.forEach((addon) => {
      textLines.push(`- ${addon.name} x${addon.quantity}: ${formatCurrency(addon.amount, currency)}`);
    });
  }
  if (fromPeople > 0 && toPeople >= 0 && toPeople < fromPeople) {
    textLines.push('');
    textLines.push(`People changed: ${fromPeople} to ${toPeople}.`);
    if (peopleAmount > 0) {
      textLines.push(`People adjustment amount: ${formatCurrency(peopleAmount, currency)}.`);
    }
  }
  textLines.push('');
  if (customMessage) {
    textLines.push(customMessage);
    textLines.push('');
  }
  textLines.push('Best regards,');

  const htmlNode = renderShell(
    subject,
    `Refund update for booking ${bookingReference}`,
    createElement(
      Section,
      null,
      createElement(
        Heading,
        {
          as: 'h1',
          style: {
            color: '#0f172a',
            fontSize: '24px',
            lineHeight: '30px',
            margin: '0 0 8px',
            padding: 0,
          },
        },
        'Refund Confirmation',
      ),
      createElement(
        Text,
        {
          style: { ...mutedTextStyle, marginBottom: '14px' },
        },
        `Booking ${bookingReference} - ${productName}`,
      ),
      createElement(
        Section,
        { style: { ...sectionCardStyle, backgroundColor: '#ecfeff', borderColor: '#bae6fd' } },
        createElement(
          Text,
          {
            style: {
              color: '#0f172a',
              fontSize: '15px',
              lineHeight: '22px',
              fontWeight: 700,
              margin: '0 0 4px',
            },
          },
          `Refunded amount: ${refundedLabel}`,
        ),
        totalPaidLabel
          ? createElement(
              Text,
              {
                style: mutedTextStyle,
              },
              `Total paid: ${totalPaidLabel}`,
            )
          : null,
        createElement(
          Text,
          {
            style: { ...mutedTextStyle, marginTop: '4px' },
          },
          `${refundKind.reasonLabel}: ${refundKind.reasonDetail}`,
        ),
      ),
      createElement(
        Section,
        { style: sectionCardStyle },
        createElement(
          Text,
          {
            style: { ...paragraphStyle, marginBottom: '8px' },
          },
          `Hi ${customerName},`,
        ),
        createElement(
          Text,
          { style: paragraphStyle },
          `Your ${refundKind.isFullRefund ? 'full' : 'partial'} refund was processed successfully. Experience date: ${experienceDate}.`,
        ),
      ),
      customMessage
        ? createElement(
            Section,
            { style: sectionCardStyle },
            createElement(
              Text,
              { style: { ...paragraphStyle, fontWeight: 700, marginBottom: '6px' } },
              'Message',
            ),
            createElement(
              Text,
              { style: paragraphStyle },
              customMessage,
            ),
          )
        : null,
      refundedAddons.length > 0
        ? createElement(
            Section,
            { style: sectionCardStyle },
            createElement(
              Text,
              {
                style: { ...paragraphStyle, marginBottom: '8px', fontWeight: 700 },
              },
              'Refunded add-ons',
            ),
            ...refundedAddons.map((addon, index) =>
              createElement(
                Row,
                {
                  key: `refund-addon-${index}`,
                  style: { marginBottom: index === refundedAddons.length - 1 ? '0' : '6px' },
                  children: [
                    createElement(
                      Column,
                      { key: `refund-addon-left-${index}` },
                      createElement(
                        Text,
                        { style: { ...paragraphStyle, fontSize: '14px', margin: 0 } },
                        `${addon.name} x${addon.quantity}`,
                      ),
                    ),
                    createElement(
                      Column,
                      { key: `refund-addon-right-${index}`, align: 'right' },
                      createElement(
                        Text,
                        { style: { ...paragraphStyle, fontSize: '14px', margin: 0, fontWeight: 700 } },
                        formatCurrency(addon.amount, currency),
                      ),
                    ),
                  ],
                },
              ),
            ),
          )
        : null,
      fromPeople > 0 && toPeople >= 0 && toPeople < fromPeople
        ? createElement(
            Section,
            { style: sectionCardStyle },
            createElement(
              Text,
              { style: { ...paragraphStyle, fontWeight: 700, marginBottom: '8px' } },
              'People quantity adjustment',
            ),
            createElement(
              Text,
              { style: { ...paragraphStyle, fontSize: '14px' } },
              `Participants updated from ${fromPeople} to ${toPeople}.`,
            ),
            peopleAmount > 0
              ? createElement(
                  Text,
                  { style: { ...paragraphStyle, fontSize: '14px', marginTop: '6px' } },
                  `Adjustment refunded: ${formatCurrency(peopleAmount, currency)}`,
                )
              : null,
          )
        : null,
    ),
  );

  return {
    html: await render(htmlNode),
    textBody: textLines.join('\n'),
  };
};

const resolveSupplyItems = (context: EmailTemplateContext): SupplyOrderLine[] =>
  toArray(context.items).reduce<SupplyOrderLine[]>((acc, entry) => {
    const item = toRecord(entry);
    const name = toNullableString(item.name);
    if (!name) {
      return acc;
    }
    acc.push({
      name,
      quantity: Math.max(1, toInteger(item.quantity)),
      unit: toNullableString(item.unit) ?? 'pcs',
      priority: toNullableString(item.priority),
      note: toNullableString(item.note),
    });
    return acc;
  }, []);

const renderSupplyOrderTemplateHtml = async (
  subject: string,
  templateBodyText: string,
  context: EmailTemplateContext,
): Promise<{ html: string; textBody: string }> => {
  const supplierName = toNullableString(context.supplierName) ?? 'Supplier';
  const requestedBy = toNullableString(context.requestedBy) ?? 'Operations Team';
  const deliveryDate = toNullableString(context.deliveryDate) ?? '-';
  const location = toNullableString(context.location) ?? '-';
  const notes = toNullableString(context.notes);
  const items = resolveSupplyItems(context);
  const customMessage = templateBodyText.trim();

  const textLines: string[] = [
    `Hello ${supplierName},`,
    '',
    'Please process the following supply order:',
    `Requested by: ${requestedBy}`,
    `Delivery date: ${deliveryDate}`,
    `Delivery location: ${location}`,
    '',
    'Items:',
  ];
  items.forEach((item) => {
    const segments = [`- ${item.name}: ${item.quantity} ${item.unit}`];
    if (item.priority) {
      segments.push(`priority ${item.priority}`);
    }
    if (item.note) {
      segments.push(`note ${item.note}`);
    }
    textLines.push(segments.join(' | '));
  });
  if (notes) {
    textLines.push('');
    textLines.push(`Notes: ${notes}`);
  }
  textLines.push('');
  if (customMessage) {
    textLines.push(customMessage);
    textLines.push('');
  }
  textLines.push('Thank you.');

  const htmlNode = renderShell(
    subject,
    `Supply order for ${supplierName}`,
    createElement(
      Section,
      null,
      createElement(
        Heading,
        {
          as: 'h1',
          style: {
            color: '#0f172a',
            fontSize: '24px',
            lineHeight: '30px',
            margin: '0 0 8px',
            padding: 0,
          },
        },
        'Supply Order Request',
      ),
      createElement(
        Text,
        {
          style: { ...mutedTextStyle, marginBottom: '12px' },
        },
        `Supplier: ${supplierName}`,
      ),
      createElement(
        Section,
        { style: { ...sectionCardStyle, backgroundColor: '#eff6ff', borderColor: '#bfdbfe' } },
        createElement(
          Row,
          {
            children: [
              createElement(
                Column,
                { key: 'supply-meta-requested-by' },
                createElement(
                  Text,
                  { style: { ...mutedTextStyle, marginBottom: '2px' } },
                  'Requested by',
                ),
                createElement(
                  Text,
                  { style: { ...paragraphStyle, fontWeight: 700 } },
                  requestedBy,
                ),
              ),
              createElement(
                Column,
                { key: 'supply-meta-delivery-date' },
                createElement(
                  Text,
                  { style: { ...mutedTextStyle, marginBottom: '2px' } },
                  'Delivery date',
                ),
                createElement(
                  Text,
                  { style: { ...paragraphStyle, fontWeight: 700 } },
                  deliveryDate,
                ),
              ),
              createElement(
                Column,
                { key: 'supply-meta-location' },
                createElement(
                  Text,
                  { style: { ...mutedTextStyle, marginBottom: '2px' } },
                  'Location',
                ),
                createElement(
                  Text,
                  { style: { ...paragraphStyle, fontWeight: 700 } },
                  location,
                ),
              ),
            ],
          },
        ),
      ),
      createElement(
        Section,
        { style: sectionCardStyle },
        createElement(
          Text,
          { style: { ...paragraphStyle, fontWeight: 700, marginBottom: '10px' } },
          'Order lines',
        ),
        items.length > 0
          ? items.map((item, index) =>
              createElement(
                Section,
                {
                  key: `supply-item-${index}`,
                  style: {
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    marginBottom: index === items.length - 1 ? '0' : '8px',
                    padding: '10px',
                  },
                },
                createElement(
                  Row,
                  {
                    children: [
                      createElement(
                        Column,
                        { key: `supply-item-left-${index}` },
                        createElement(
                          Text,
                          { style: { ...paragraphStyle, fontSize: '14px', margin: 0, fontWeight: 700 } },
                          item.name,
                        ),
                      ),
                      createElement(
                        Column,
                        { key: `supply-item-right-${index}`, align: 'right' },
                        createElement(
                          Text,
                          { style: { ...paragraphStyle, fontSize: '14px', margin: 0 } },
                          `${item.quantity} ${item.unit}`,
                        ),
                      ),
                    ],
                  },
                ),
                item.priority
                  ? createElement(
                      Text,
                      { style: { ...mutedTextStyle, marginTop: '6px' } },
                      `Priority: ${item.priority}`,
                    )
                  : null,
                item.note
                  ? createElement(
                      Text,
                      { style: { ...mutedTextStyle, marginTop: '4px' } },
                      `Note: ${item.note}`,
                    )
                  : null,
              ),
            )
          : createElement(
              Text,
              { style: mutedTextStyle },
              'No items specified.',
            ),
      ),
      customMessage
        ? createElement(
            Section,
            { style: sectionCardStyle },
            createElement(
              Text,
              { style: { ...paragraphStyle, fontWeight: 700, marginBottom: '6px' } },
              'Message',
            ),
            createElement(Text, { style: paragraphStyle }, customMessage),
          )
        : null,
      notes
        ? createElement(
            Section,
            { style: sectionCardStyle },
            createElement(
              Text,
              { style: { ...paragraphStyle, fontWeight: 700, marginBottom: '6px' } },
              'Additional notes',
            ),
            createElement(Text, { style: paragraphStyle }, notes),
          )
        : null,
    ),
  );

  return {
    html: await render(htmlNode),
    textBody: textLines.join('\n'),
  };
};

const renderReactEmailByKey = async (
  templateKey: string,
  subject: string,
  textBody: string,
  context: EmailTemplateContext,
): Promise<{ html: string; textBody: string }> => {
  if (templateKey.includes('booking_refund') || templateKey.includes('refund')) {
    return renderBookingRefundTemplateHtml(subject, textBody, context);
  }
  if (templateKey.includes('supply_order') || templateKey.includes('supply')) {
    return renderSupplyOrderTemplateHtml(subject, textBody, context);
  }
  const html = await renderBasicTemplateHtml(subject, textBody, context);
  return { html, textBody };
};

export const renderStoredEmailTemplate = async ({
  template,
  context,
  subjectOverride,
  bodyOverride,
}: RenderStoredEmailTemplateParams): Promise<RenderedEmailTemplate> => {
  const safeContext = context ?? {};
  const subjectSource = subjectOverride?.trim() ? subjectOverride : template.subjectTemplate;
  const bodySource = bodyOverride?.trim() ? bodyOverride : template.bodyTemplate;
  const subject = interpolateTemplate(subjectSource ?? '', safeContext).trim();
  const body = interpolateTemplate(bodySource ?? '', safeContext);
  const textBody = normalizeTextBody(body);

  if (template.templateType === 'react_email') {
    const sourceFromContext = toNullableString(safeContext.reactTemplateSource);
    const bodyTemplateSource = bodySource ?? '';
    const sourceCandidate =
      sourceFromContext ??
      (isReactTemplateSource(bodyTemplateSource) || looksLikeReactTemplateSource(bodyTemplateSource)
        ? bodyTemplateSource
        : null);
    if (sourceCandidate) {
      try {
        const dynamicRendered = await renderDynamicReactTemplateSource(sourceCandidate, subject, safeContext);
        return {
          templateType: template.templateType,
          subject,
          textBody: dynamicRendered.textBody,
          htmlBody: dynamicRendered.html,
        };
      } catch (error) {
        if (sourceFromContext || isReactTemplateSource(bodyTemplateSource)) {
          throw error;
        }
      }
    }

    const templateKey = resolveTemplateKey(template, safeContext);
    const rendered = await renderReactEmailByKey(templateKey, subject, textBody, safeContext);
    return {
      templateType: template.templateType,
      subject,
      textBody: rendered.textBody,
      htmlBody: rendered.html,
    };
  }

  return {
    templateType: template.templateType,
    subject,
    textBody,
    htmlBody: null,
  };
};

export const renderReactEmailTemplateSource = async ({
  source,
  subject,
  context,
}: RenderReactEmailTemplateSourceParams): Promise<RenderedEmailTemplate> => {
  const safeSource = source.trim();
  const safeSubject = subject.trim();
  const safeContext = context ?? {};

  if (!safeSource) {
    throw new Error('React template source is required');
  }

  const dynamicRendered = await renderDynamicReactTemplateSource(safeSource, safeSubject, safeContext);
  return {
    templateType: 'react_email',
    subject: safeSubject,
    textBody: dynamicRendered.textBody,
    htmlBody: dynamicRendered.html,
  };
};

export const interpolateEmailTemplateText = (value: string, context: EmailTemplateContext): string =>
  interpolateTemplate(value, context);
