import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';

const firstNonEmpty = (...values) => values.find(
  (value) => typeof value === 'string' && value.trim().length > 0,
);

const resolveConfiguredPath = ({ value, fallback, cwd }) => path.resolve(
  cwd,
  firstNonEmpty(value) ?? fallback,
);

export const resolveUiServerRuntimePaths = ({
  env = process.env,
  moduleDirectory,
  cwd = process.cwd(),
} = {}) => {
  if (!moduleDirectory) {
    throw new TypeError('moduleDirectory is required');
  }

  return Object.freeze({
    buildPath: resolveConfiguredPath({
      value: env.UI_BUILD_PATH,
      fallback: path.join(moduleDirectory, '..', 'ui', 'build'),
      cwd,
    }),
    tlsKeyPath: resolveConfiguredPath({
      value: env.UI_TLS_KEY_PATH,
      fallback: path.join(moduleDirectory, '..', 'be', 'src', 'ssl', 'cf-origin.key'),
      cwd,
    }),
    tlsCertPath: resolveConfiguredPath({
      value: env.UI_TLS_CERT_PATH,
      fallback: path.join(moduleDirectory, '..', 'be', 'src', 'ssl', 'cf-origin.pem'),
      cwd,
    }),
  });
};

export const resolveExpectedUiRelease = (env = process.env) => {
  const value = firstNonEmpty(
    env.UI_EXPECTED_RELEASE,
    env.REACT_APP_RELEASE,
    env.REACT_APP_BUILD_VERSION,
    env.REACT_APP_GIT_SHA,
    env.REACT_APP_BUILD_ID,
    env.APP_VERSION,
    env.GIT_COMMIT_SHA,
    env.GIT_SHA,
    env.COMMIT_SHA,
  );
  return value?.trim() ?? null;
};

const readRequiredFile = (filePath, label) => {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    const contents = fs.readFileSync(filePath);
    if (contents.length === 0) throw new Error('file is empty');
    return contents;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is missing or unreadable: ${reason}`, { cause: error });
  }
};

export const loadAndValidateTlsCredentials = ({ keyPath, certPath }) => {
  const key = readRequiredFile(keyPath, 'UI TLS private key');
  const cert = readRequiredFile(certPath, 'UI TLS certificate');

  try {
    // Parsing both values together catches malformed files and mismatched keys
    // before the public listener is opened.
    tls.createSecureContext({ key, cert });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`UI TLS credentials are invalid: ${reason}`, { cause: error });
  }

  return { key, cert };
};
