type NightReportSaveSequence = {
  alreadySubmitted: boolean;
  update: () => Promise<unknown>;
  submit: () => Promise<unknown>;
  refresh: () => Promise<unknown>;
};

export const executeNightReportSaveSequence = async ({
  alreadySubmitted,
  update,
  submit,
  refresh,
}: NightReportSaveSequence): Promise<void> => {
  await update();
  if (!alreadySubmitted) {
    await submit();
  }
  await refresh();
};
