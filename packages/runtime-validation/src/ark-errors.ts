export type ArkErrorsLike = {
  summary: string;
};

export function formatArkErrors(errors: ArkErrorsLike): string {
  return errors.summary;
}
