import 'dotenv/config';
import sequelize from '../config/database.js';
import {
  runGetYourGuideOutboundSelfTest,
  type GygOutboundMode,
  type GygOutboundSelfTestOptions,
} from '../services/getYourGuideOutboundService.js';

const parseArgs = (argv: string[]): Record<string, string> => {
  const result: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const equalsIndex = token.indexOf('=');
    if (equalsIndex > 2) {
      result[token.slice(2, equalsIndex)] = token.slice(equalsIndex + 1);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = 'true';
    }
  }

  return result;
};

const parseMode = (value: string | undefined): GygOutboundMode => {
  if (value === 'prod' || value === 'production') {
    return 'prod';
  }
  return 'test';
};

const readNumber = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const readBoolean = (value: string | undefined): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n'].includes(normalized)) {
    return false;
  }
  return undefined;
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const options: GygOutboundSelfTestOptions = {
    mode: parseMode(args.mode),
    productId: args.productId,
    externalProductId: args.externalProductId,
    supplierExternalId: args.supplierExternalId,
    gygOptionId: readNumber(args.gygOptionId),
    gygBookingReference: args.gygBookingReference,
    ticketCode: args.ticketCode,
    includeAdditionalEndpoints: readBoolean(args.includeAdditionalEndpoints),
  };

  await sequelize.authenticate();
  const result = await runGetYourGuideOutboundSelfTest(options);

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.success ? 0 : 1;
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
