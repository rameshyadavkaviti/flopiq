export const resolve = (specifier, context, nextResolve) => {
  if (
    context.parentURL?.includes('/packages/poker-core/src/') &&
    specifier.startsWith('./') &&
    specifier.endsWith('.js')
  ) {
    return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
  }

  return nextResolve(specifier, context);
};
